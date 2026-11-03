import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus } from 'lucide-react';
import { useAction, useApp, useLive } from '../runtime';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, PageSkeleton, RelTime, StatusBadge, Switch } from '../components';
import { SUBSCRIPTION_STATUS } from '../../core/status';
import type { Plan } from '../../core/types';

export function Subscriptions() {
  const app = useApp();
  const live = useLive(async (a) => {
    const [plans, companies, distributions] = await Promise.all([a.repo.listPlans(), a.repo.listCompanies(), a.repo.listDistributions()]);
    return { plans, companies, distributions };
  });
  const [editing, setEditing] = useState<Plan | null>(null);
  const approve = useAction((a, companyId: string, planId: string) => a.setSubscription(companyId, 'TRIAL', planId), 'Essai activé (simulation)');

  if (live.loading) return <PageSkeleton />;
  if (live.error || !live.data) return <ErrorState error={live.error ?? new Error('—')} onRetry={live.reload} />;
  const { plans, companies, distributions } = live.data;
  const requests = companies.filter((c) => c.subscription.requestedAt);
  const prospects = companies
    .filter((c) => !['ACTIVE', 'TRIAL'].includes(c.subscription.status) && c.freeOpportunityUsedAt)
    .map((c) => ({ c, free: distributions.find((d) => d.companyId === c.id && d.mode === 'FREE_OPPORTUNITY') }));

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Abonnements</h1>
          <div className="desc">Plans configurables et cycle commercial : opportunité gratuite → abonnement.</div>
        </div>
        <div className="actions">
          <Button
            icon={<Plus size={15} />}
            onClick={() => setEditing({ id: `plan_${Date.now().toString(36)}`, name: '', priceLabel: 'À définir', monthlyQuota: 10, maxCities: 1, autoDistribution: true, description: '', active: true })}
          >
            Nouveau plan
          </Button>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, plans.length)}, minmax(0, 1fr))`, marginBottom: 16 }}>
        {plans.map((p) => {
          const subs = companies.filter((c) => c.subscription.planId === p.id && ['ACTIVE', 'TRIAL'].includes(c.subscription.status));
          return (
            <section key={p.id} className="card" style={{ opacity: p.active ? 1 : 0.6 }}>
              <div className="card-h">
                <h3>{p.name}</h3>
                {!p.active && <Badge>Inactif</Badge>}
                <div className="right">
                  <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} aria-label={`Modifier ${p.name}`} onClick={() => setEditing(p)} />
                </div>
              </div>
              <div className="card-b col" style={{ gap: 6 }}>
                <div className="strong">{p.priceLabel}</div>
                <div className="muted small">{p.description}</div>
                <div className="divider" style={{ margin: '6px 0' }} />
                <div className="small">Quota : {p.monthlyQuota === null ? 'illimité' : `${p.monthlyQuota} demandes / mois`}</div>
                <div className="small">Villes : {p.maxCities === null ? 'illimitées' : p.maxCities}</div>
                <div className="small">Distribution : {p.autoDistribution ? 'automatique' : 'validée par Telecontact'}</div>
                <div className="small strong" style={{ marginTop: 4 }}>
                  {subs.length} entreprise{subs.length > 1 ? 's' : ''}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-h">
            <h3>Demandes d’abonnement</h3>
            <span className="sub">depuis les espaces entreprise</span>
          </div>
          {requests.length === 0 ? (
            <EmptyState title="Aucune demande en attente" />
          ) : (
            <table className="table">
              <tbody>
                {requests.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/entreprises/${c.id}`} className="primary-cell">
                        {c.name}
                      </Link>
                      <span className="sub">
                        Plan {plans.find((p) => p.id === c.subscription.requestedPlanId)?.name} · <RelTime iso={c.subscription.requestedAt} />
                      </span>
                    </td>
                    <td className="num">
                      <Button size="sm" variant="primary" loading={approve.pending} onClick={() => approve.run(c.id, c.subscription.requestedPlanId ?? plans[0].id)}>
                        Activer l’essai
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-h">
            <h3>Prospects à relancer</h3>
            <span className="sub">opportunité gratuite reçue, pas encore abonnés</span>
          </div>
          {prospects.length === 0 ? (
            <EmptyState title="Aucun prospect" />
          ) : (
            <table className="table">
              <tbody>
                {prospects.map(({ c, free }) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/entreprises/${c.id}`} className="primary-cell">
                        {c.name}
                      </Link>
                      <span className="sub">
                        Offre gratuite <RelTime iso={c.freeOpportunityUsedAt} />
                      </span>
                    </td>
                    <td>
                      <StatusBadge map={SUBSCRIPTION_STATUS} value={c.subscription.status} />
                    </td>
                    <td className="small">{free ? <Link to={`/admin/demandes/${free.demandId}`}>Voir la demande offerte</Link> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <PlanDialog plan={editing} onClose={() => setEditing(null)} save={(p) => app.savePlan(p)} />
    </div>
  );
}

function PlanDialog({ plan, onClose, save }: { plan: Plan | null; onClose: () => void; save: (p: Plan) => Promise<Plan> }) {
  const [p, setP] = useState<Plan | null>(plan);
  const [key, setKey] = useState(plan?.id);
  if (plan?.id !== key) {
    setKey(plan?.id);
    setP(plan);
  }
  const action = useAction(async (_a, x: Plan) => save(x), 'Plan enregistré');
  if (!p) return null;
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setP((x) => (x ? { ...x, [k]: v } : x));
  return (
    <Dialog
      open={Boolean(plan)}
      onClose={onClose}
      title={plan?.name ? `Plan ${plan.name}` : 'Nouveau plan'}
      description="Les plans sont de la configuration : prix et quotas ne sont pas des règles figées."
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={action.pending} onClick={async () => (await action.run(p)) && onClose()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="Nom">
          <input className="input" value={p.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Tarif affiché">
          <input className="input" value={p.priceLabel} onChange={(e) => set('priceLabel', e.target.value)} />
        </Field>
        <Field label="Quota mensuel" hint="Vide = illimité">
          <input className="input" type="number" min={1} value={p.monthlyQuota ?? ''} onChange={(e) => set('monthlyQuota', e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Villes max." hint="Vide = illimité">
          <input className="input" type="number" min={1} value={p.maxCities ?? ''} onChange={(e) => set('maxCities', e.target.value ? Number(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={p.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="row">
        <Switch checked={p.autoDistribution} onChange={(v) => set('autoDistribution', v)} label="Distribution automatique" />
        <span className="small">Distribution automatique des demandes éligibles</span>
      </div>
      <div className="row">
        <Switch checked={p.active} onChange={(v) => set('active', v)} label="Plan actif" />
        <span className="small">Proposé aux entreprises</span>
      </div>
    </Dialog>
  );
}
