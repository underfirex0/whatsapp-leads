import { useEffect, useState } from 'react';
import { Database, RotateCcw } from 'lucide-react';
import { useAction, useLive, useRuntime, useToast } from '../runtime';
import { Button, ConfirmDialog, ErrorState, Field, Notice, PageSkeleton, Switch, fmt } from '../components';
import type { Settings } from '../../core/types';
import { formatPhone } from '../../core/phone';

export function SettingsPage() {
  const runtime = useRuntime();
  const toast = useToast();
  const live = useLive(async (app) => {
    const db = await app.repo.snapshot();
    return { settings: db.settings, seededAt: db.seededAt, counts: { companies: db.companies.length, conversations: db.conversations.length, messages: db.messages.length, demands: db.demands.length, distributions: db.distributions.length }, size: JSON.stringify(db).length };
  });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (live.data) setS(live.data.settings);
  }, [live.data]);
  const save = useAction((app, patch: Settings) => app.updateSettings(patch), 'Paramètres enregistrés');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (live.loading || !s) return <PageSkeleton />;
  if (live.error || !live.data) return <ErrorState error={live.error ?? new Error('—')} />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => (x ? { ...x, [k]: v } : x));
  const dirty = JSON.stringify(s) !== JSON.stringify(live.data.settings);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-h">
        <div>
          <h1>Paramètres</h1>
          <div className="desc">Règles de distribution et paramètres de simulation.</div>
        </div>
        <div className="actions">
          <Button variant="primary" disabled={!dirty} loading={save.pending} onClick={() => save.run(s)}>
            Enregistrer
          </Button>
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <section className="card">
          <div className="card-h">
            <h3>Distribution</h3>
          </div>
          <div className="card-b col" style={{ gap: 14 }}>
            <div className="row">
              <Switch checked={s.autoDistribution} onChange={(v) => set('autoDistribution', v)} label="Distribution automatique" />
              <div>
                <div className="strong small">Distribution automatique aux abonnés</div>
                <div className="subtle small">Une demande qualifiée est envoyée immédiatement aux entreprises abonnées éligibles dont le plan l’autorise. Les opportunités gratuites restent validées manuellement.</div>
              </div>
            </div>
            <div className="grid-2">
              <Field label="Entreprises max. par demande">
                <input className="input" type="number" min={1} max={10} value={s.maxCompaniesPerDemand} onChange={(e) => set('maxCompaniesPerDemand', Number(e.target.value))} />
              </Field>
              <Field label="Abandon après (minutes d’inactivité)">
                <input className="input" type="number" min={5} value={s.abandonAfterMinutes} onChange={(e) => set('abandonAfterMinutes', Number(e.target.value))} />
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h3>Simulation</h3>
          </div>
          <div className="card-b col" style={{ gap: 14 }}>
            <Notice tone="info">Aucune intégration réelle : WhatsApp, stockage et IA sont simulés dans le navigateur.</Notice>
            <div className="grid-2">
              <Field label="Numéro WhatsApp central (simulé)" hint={formatPhone(s.centralNumber)}>
                <input className="input" value={s.centralNumber} onChange={(e) => set('centralNumber', e.target.value)} />
              </Field>
              <Field label="Lien données personnelles">
                <input className="input" value={s.privacyUrl} onChange={(e) => set('privacyUrl', e.target.value)} />
              </Field>
              <Field label="Taux d’échec d’envoi simulé" hint={`${Math.round(s.simulatedFailureRate * 100)} % des messages échouent`}>
                <input type="range" min={0} max={0.5} step={0.05} value={s.simulatedFailureRate} onChange={(e) => set('simulatedFailureRate', Number(e.target.value))} />
              </Field>
              <Field label="Latence simulée des données" hint={`${s.simulatedLatencyMs} ms au premier chargement d’une vue`}>
                <input type="range" min={0} max={1200} step={60} value={s.simulatedLatencyMs} onChange={(e) => set('simulatedLatencyMs', Number(e.target.value))} />
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <Database size={15} className="subtle" />
            <h3>Données de démonstration</h3>
          </div>
          <div className="card-b col" style={{ gap: 12 }}>
            <div className="small muted">
              Générées le {fmt.dateTime(live.data.seededAt)} en rejouant 30 jours de trafic dans le vrai moteur · {live.data.counts.companies} entreprises · {live.data.counts.conversations} conversations · {live.data.counts.messages} messages · {live.data.counts.demands} demandes · {live.data.counts.distributions} distributions · {Math.round(live.data.size / 1024)} Ko dans le navigateur (localStorage).
            </div>
            <div>
              <Button variant="danger" icon={<RotateCcw size={14} />} onClick={() => setConfirm(true)}>
                Réinitialiser toutes les données
              </Button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        danger
        loading={busy}
        title="Réinitialiser la démonstration ?"
        description="Les données reviennent à leur état initial. Cette action efface vos tests."
        confirmLabel="Réinitialiser"
        onConfirm={async () => {
          setBusy(true);
          await runtime.reset();
          setBusy(false);
          setConfirm(false);
          toast({ kind: 'success', message: 'Données réinitialisées' });
        }}
      />
    </div>
  );
}
