import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, Ban, Check, ChevronRight, CircleSlash, MessageSquareText, Minus, Pencil, PauseCircle, RefreshCw, RotateCcw, Send, Sparkles, X, Archive } from 'lucide-react';
import { useAction, useLive } from '../runtime';
import { Avatar, Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Notice, PageSkeleton, RelTime, ScoreMeter, StatusBadge, fmt } from '../components';
import { DEMAND_STATUS, DELIVERY_STATUS, DISTRIBUTION_MODE, INTENT_LABEL, OUTCOME, SUBSCRIPTION_STATUS, canTransition } from '../../core/status';
import { CALLBACK_LABELS } from '../../core/conversation/copy';
import { categoryLabel, CITY_NAMES } from '../../core/catalog';
import { formatPhone } from '../../core/phone';
import type { CallbackTime, Demand, DemandStatus } from '../../core/types';
import type { MatchCandidate } from '../../core/matching/matching';
import { Timeline } from './Timeline';

export function DemandDetail() {
  const { id = '' } = useParams();
  const live = useLive(
    async (app) => {
      const demand = await app.repo.getDemand(id);
      if (!demand) return null;
      const [companies, categories, conversation, messages, distributions, activity, match, contact, settings] = await Promise.all([
        app.repo.listCompanies(),
        app.repo.listCategories(),
        app.repo.getConversation(demand.conversationId),
        app.repo.listMessages(demand.conversationId),
        app.repo.listDistributions({ demandId: id }),
        app.repo.listActivity({ demandId: id }),
        app.getMatches(id),
        app.repo.getContact(demand.contactId),
        app.repo.getSettings(),
      ]);
      const convActivity = await app.repo.listActivity({ conversationId: demand.conversationId });
      return { demand, companies, categories, conversation, messages, distributions, activity: [...convActivity.filter((a) => !a.demandId), ...activity], match, contact, settings };
    },
    [id],
  );

  if (live.loading) return <PageSkeleton />;
  if (live.error) return <ErrorState error={live.error} onRetry={live.reload} />;
  if (!live.data) {
    return (
      <div className="page">
        <EmptyState title="Demande introuvable" action={<Link className="btn" to="/admin/demandes">Retour aux demandes</Link>}>
          Elle a peut-être été supprimée lors d’une réinitialisation.
        </EmptyState>
      </div>
    );
  }
  const { demand, companies, categories, conversation, messages, distributions, activity, match, contact, settings } = live.data;
  const requested = companies.find((c) => c.id === demand.requestedCompanyId) ?? null;
  const sentCount = distributions.filter((d) => d.deliveryStatus !== 'FAILED').length;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/admin/demandes">Demandes</Link>
        <ChevronRight size={13} />
        <span>#{demand.number}</span>
      </div>
      <div className="page-h">
        <div>
          <div className="row wrap">
            <h1>Demande #{demand.number}</h1>
            <StatusBadge map={DEMAND_STATUS} value={demand.status} />
            <Badge tone="outline">{INTENT_LABEL[demand.intent].label}</Badge>
          </div>
          <div className="desc">
            Reçue <RelTime iso={demand.createdAt} /> · Source Telecontact · fiche {requested?.ficheId ?? '—'}
            {demand.statusNote && <> · <i>{demand.statusNote}</i></>}
          </div>
        </div>
        <div className="actions">
          <StatusActions demand={demand} />
        </div>
      </div>

      <div className="journey-steps" style={{ marginBottom: 16 }}>
        <Link to={`/admin/conversations/${demand.conversationId}`}>
          <MessageSquareText size={14} /> Conversation
        </Link>
        <ChevronRight size={13} className="sep" />
        <span className="step current">Demande #{demand.number}</span>
        <ChevronRight size={13} className="sep" />
        <a href="#matching">Matching · {match.candidates.filter((c) => c.eligible).length} éligibles</a>
        <ChevronRight size={13} className="sep" />
        {requested ? <Link to={`/admin/entreprises/${requested.id}`}>{requested.name}</Link> : <span className="step">Entreprise ?</span>}
        <ChevronRight size={13} className="sep" />
        <a href="#distribution">Distribution · {sentCount} envoi{sentCount > 1 ? 's' : ''}</a>
      </div>

      <div className="detail">
        <div className="col">
          <DemandSummary demand={demand} categoryText={categoryLabel(categories, demand.category ?? match.demandCategory)} categories={categories} companies={companies} />
          <MatchingPanel demandId={demand.id} demand={demand} match={match} max={settings.maxCompaniesPerDemand} sentCount={sentCount} />
          <DistributionHistory distributions={distributions} companies={companies} />
        </div>

        <div className="col">
          <section className="card">
            <div className="card-h">
              <h3>Client</h3>
            </div>
            <div className="card-b">
              <div className="row" style={{ marginBottom: 12 }}>
                <Avatar name={demand.customerName} lg />
                <div>
                  <div className="strong">{demand.customerName}</div>
                  <div className="muted small">{formatPhone(demand.customerPhone)}</div>
                </div>
              </div>
              <dl className="kv">
                <dt>WhatsApp</dt>
                <dd>{formatPhone(conversation?.waNumber)}</dd>
                <dt>Consentement</dt>
                <dd>
                  <Badge tone="success">
                    <Check size={12} /> Accepté
                  </Badge>{' '}
                  <span className="subtle small">{fmt.dateTime(conversation?.consentAt)}</span>
                </dd>
                <dt>Langue</dt>
                <dd>{conversation?.lang === 'ar' ? 'Arabe' : 'Français'}</dd>
                <dt>Demandes</dt>
                <dd>{contact ? <ContactHistory contactId={contact.id} currentId={demand.id} /> : '—'}</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>Entreprise demandée</h3>
            </div>
            <div className="card-b">
              {requested ? (
                <>
                  <Link to={`/admin/entreprises/${requested.id}`} className="row" style={{ marginBottom: 10 }}>
                    <Avatar name={requested.name} company lg />
                    <div className="grow">
                      <div className="strong">{requested.name}</div>
                      <div className="muted small">
                        {requested.activity} · {requested.city}
                      </div>
                    </div>
                    <ArrowRight size={15} className="subtle" />
                  </Link>
                  <div className="row wrap">
                    <StatusBadge map={SUBSCRIPTION_STATUS} value={requested.subscription.status} />
                    {requested.subscription.status === 'NONE' || requested.subscription.status === 'CANCELLED' ? (
                      requested.freeOpportunityUsedAt ? <Badge tone="neutral">Opportunité gratuite utilisée</Badge> : <Badge tone="warning">Opportunité gratuite disponible</Badge>
                    ) : null}
                  </div>
                  <div className="subtle small" style={{ marginTop: 8 }}>
                    Identifiée par {conversation?.resolution === 'referral' ? 'la référence du clic sur la fiche' : conversation?.resolution === 'template' ? 'le message pré-rempli' : '—'} ({requested.ficheId})
                  </div>
                </>
              ) : (
                <Notice tone="warning">Entreprise non identifiée. Modifiez la demande pour l’associer.</Notice>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>Conversation</h3>
              <div className="right">
                <Link to={`/admin/conversations/${demand.conversationId}`} className="btn sm ghost">
                  Ouvrir <ArrowRight size={13} />
                </Link>
              </div>
            </div>
            <div className="card-b col" style={{ gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {messages
                .filter((m) => m.direction === 'IN')
                .map((m) => (
                  <div key={m.id} className="small">
                    <span className="subtle mono">{fmt.time(m.createdAt)}</span> <span>{m.body}</span>
                  </div>
                ))}
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>Historique</h3>
            </div>
            <div className="card-b">
              <Timeline entries={activity} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ContactHistory({ contactId, currentId }: { contactId: string; currentId: string }) {
  const live = useLive(async (app) => (await app.repo.listDemands()).filter((d) => d.contactId === contactId), [contactId]);
  const others = (live.data ?? []).filter((d) => d.id !== currentId);
  if (!live.data) return <span className="subtle">…</span>;
  if (others.length === 0) return <span className="subtle">Première demande</span>;
  return (
    <span className="row wrap" style={{ gap: 4 }}>
      {others.map((d) => (
        <Link key={d.id} to={`/admin/demandes/${d.id}`} className="badge outline">
          #{d.number}
        </Link>
      ))}
    </span>
  );
}

// ───────────────────────── Status actions ─────────────────────────

function StatusActions({ demand }: { demand: Demand }) {
  const [dialog, setDialog] = useState<null | { to: DemandStatus; title: string; needNote: boolean; danger?: boolean }>(null);
  const [note, setNote] = useState('');
  const action = useAction((app, to: DemandStatus, n: string | null) => app.setDemandStatus(demand.id, to, n), (d) => `Statut : ${DEMAND_STATUS[d.status].label}`);
  const can = (to: DemandStatus) => canTransition(demand.status, to);
  const open = (to: DemandStatus, title: string, needNote = false, danger = false) => {
    setNote('');
    setDialog({ to, title, needNote, danger });
  };
  return (
    <>
      {can('IN_REVIEW') && (
        <Button icon={<PauseCircle size={15} />} onClick={() => open('IN_REVIEW', 'Mettre en revue manuelle', true)}>
          Mettre en revue
        </Button>
      )}
      {can('ACCEPTED') && (
        <Button icon={<Check size={15} />} onClick={() => open('ACCEPTED', 'Marquer comme prise en charge')}>
          Prise en charge
        </Button>
      )}
      {can('CLOSED') && (
        <Button icon={<Archive size={15} />} onClick={() => open('CLOSED', 'Clôturer la demande', true)}>
          Clôturer
        </Button>
      )}
      {can('REJECTED') && (
        <Button variant="danger" icon={<Ban size={15} />} onClick={() => open('REJECTED', 'Rejeter la demande', true, true)}>
          Rejeter
        </Button>
      )}
      {(demand.status === 'CLOSED' || demand.status === 'REJECTED') && (
        <Button icon={<RotateCcw size={15} />} onClick={() => open('NEW', 'Rouvrir la demande')}>
          Rouvrir
        </Button>
      )}
      <ConfirmDialog
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={dialog?.title ?? ''}
        description={dialog?.to === 'REJECTED' ? 'La demande ne pourra plus être distribuée tant qu’elle n’est pas rouverte.' : undefined}
        confirmLabel={dialog?.title.split(' ')[0] ?? 'Confirmer'}
        danger={dialog?.danger}
        loading={action.pending}
        onConfirm={async () => {
          if (!dialog) return;
          if (dialog.needNote && dialog.to === 'REJECTED' && !note.trim()) return;
          const ok = await action.run(dialog.to, note.trim() || null);
          if (ok) setDialog(null);
        }}
      >
        {dialog?.needNote && (
          <Field label={dialog.to === 'REJECTED' ? 'Motif (obligatoire)' : 'Note (facultatif)'} error={dialog.to === 'REJECTED' && !note.trim() ? 'Indiquez un motif' : undefined}>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={dialog.to === 'REJECTED' ? 'Spam, doublon, hors périmètre…' : ''} />
          </Field>
        )}
      </ConfirmDialog>
    </>
  );
}

// ───────────────────────── Summary + edit ─────────────────────────

function DemandSummary({ demand, categoryText, categories, companies }: { demand: Demand; categoryText: string; categories: { id: string; label: string }[]; companies: { id: string; name: string; city: string }[] }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(demand);
  useEffect(() => setForm(demand), [demand]);
  const save = useAction(
    (app) =>
      app.updateDemand(demand.id, {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        product: form.product || null,
        specification: form.specification || null,
        quantity: form.quantity,
        city: form.city || null,
        details: form.details || null,
        question: form.question || null,
        reason: form.reason || null,
        category: form.category || null,
        callbackTime: form.callbackTime,
        requestedCompanyId: form.requestedCompanyId,
      }),
    'Demande mise à jour',
  );
  const locked = demand.status === 'CLOSED' || demand.status === 'REJECTED';
  const set = <K extends keyof Demand>(k: K, v: Demand[K]) => setForm((f) => ({ ...f, [k]: v }));

  const need = [demand.product, demand.specification].filter(Boolean).join(' ');
  return (
    <section className="card">
      <div className="card-h">
        <h3>Demande qualifiée</h3>
        <div className="right">
          {!editing ? (
            <Button size="sm" variant="ghost" icon={<Pencil size={13} />} disabled={locked} onClick={() => setEditing(true)} title={locked ? 'Rouvrez la demande pour la modifier' : undefined}>
              Modifier
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => { setForm(demand); setEditing(false); }}>
                Annuler
              </Button>
              <Button size="sm" variant="primary" loading={save.pending} onClick={async () => (await save.run()) && setEditing(false)}>
                Enregistrer
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="card-b">
        {!editing ? (
          <dl className="kv">
            <dt>Type</dt>
            <dd>{INTENT_LABEL[demand.intent].label}</dd>
            <dt>Catégorie</dt>
            <dd>
              {categoryText}
              {!demand.category && categoryText !== '—' && <span className="subtle small"> (déduite)</span>}
            </dd>
            {demand.intent === 'PRICE' && (
              <>
                <dt>Produit</dt>
                <dd className="strong">{need || '—'}</dd>
                <dt>Quantité</dt>
                <dd>{demand.quantity ?? '—'}</dd>
              </>
            )}
            {demand.intent !== 'PRICE' && need && (
              <>
                <dt>Produit détecté</dt>
                <dd>{need}</dd>
              </>
            )}
            {demand.question && (
              <>
                <dt>Question</dt>
                <dd className="strong">{demand.question}</dd>
              </>
            )}
            {demand.reason && (
              <>
                <dt>Motif du rappel</dt>
                <dd className="strong">{demand.reason}</dd>
              </>
            )}
            {demand.callbackTime && (
              <>
                <dt>Créneau</dt>
                <dd>{CALLBACK_LABELS[demand.callbackTime]}</dd>
              </>
            )}
            <dt>Ville</dt>
            <dd>{demand.city ?? '—'}</dd>
            <dt>Précisions</dt>
            <dd>{demand.details || <span className="subtle">—</span>}</dd>
          </dl>
        ) : (
          <div className="grid-2">
            <Field label="Nom du client">
              <input className="input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
            </Field>
            <Field label="Téléphone" hint="Format marocain, ex. 06 61 23 45 67">
              <input className="input" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
            </Field>
            <Field label="Produit / service">
              <input className="input" value={form.product ?? ''} onChange={(e) => set('product', e.target.value)} />
            </Field>
            <Field label="Spécification">
              <input className="input" value={form.specification ?? ''} onChange={(e) => set('specification', e.target.value)} />
            </Field>
            <Field label="Quantité">
              <input className="input" type="number" min={1} value={form.quantity ?? ''} onChange={(e) => set('quantity', e.target.value ? Number(e.target.value) : null)} />
            </Field>
            <Field label="Ville">
              <input className="input" list="cities" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
              <datalist id="cities">
                {CITY_NAMES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Catégorie">
              <select className="select" value={form.category ?? ''} onChange={(e) => set('category', e.target.value || null)}>
                <option value="">Non catégorisée</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Entreprise demandée">
              <select className="select" value={form.requestedCompanyId ?? ''} onChange={(e) => set('requestedCompanyId', e.target.value || null)}>
                <option value="">Non identifiée</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.city}
                  </option>
                ))}
              </select>
            </Field>
            {demand.intent === 'INFO' && (
              <Field label="Question">
                <input className="input" value={form.question ?? ''} onChange={(e) => set('question', e.target.value)} />
              </Field>
            )}
            {demand.intent === 'CALLBACK' && (
              <>
                <Field label="Motif">
                  <input className="input" value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} />
                </Field>
                <Field label="Créneau">
                  <select className="select" value={form.callbackTime ?? ''} onChange={(e) => set('callbackTime', (e.target.value || null) as CallbackTime | null)}>
                    <option value="">—</option>
                    {(Object.keys(CALLBACK_LABELS) as CallbackTime[]).map((k) => (
                      <option key={k} value={k}>
                        {CALLBACK_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Précisions">
                <textarea className="textarea" value={form.details ?? ''} onChange={(e) => set('details', e.target.value)} />
              </Field>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ───────────────────────── Matching ─────────────────────────

function MatchingPanel({ demandId, demand, match, max, sentCount }: { demandId: string; demand: Demand; match: Awaited<ReturnType<import('../../core/services/app').AppService['getMatches']>>; max: number; sentCount: number }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const rec = match.recommendation;
  useEffect(() => setSelected(rec.companyIds), [rec.companyIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const distribute = useAction((app, ids: string[]) => app.distribute(demandId, ids), (r) => {
    const ok = r.filter((d) => d.deliveryStatus !== 'FAILED').length;
    return ok === r.length ? `Demande transmise à ${ok} entreprise${ok > 1 ? 's' : ''}` : `${ok}/${r.length} envois réussis — voir l’historique`;
  });
  const locked = demand.status === 'CLOSED' || demand.status === 'REJECTED';
  const remaining = Math.max(0, max - sentCount);
  const eligible = match.candidates.filter((c) => c.eligible);
  const ineligible = match.candidates.filter((c) => !c.eligible);
  const visible = showAll ? match.candidates : [...eligible, ...ineligible.filter((c) => c.isRequested)];
  const chosen = match.candidates.filter((c) => selected.includes(c.companyId));
  const preview = useLive((app) => Promise.resolve(app.buildNotification(demand)), [demand]);

  const toggle = (c: MatchCandidate) => {
    if (!c.eligible || c.alreadySent || locked) return;
    setSelected((s) => (s.includes(c.companyId) ? s.filter((x) => x !== c.companyId) : s.length >= remaining ? s : [...s, c.companyId]));
  };

  return (
    <section className="card" id="matching">
      <div className="card-h">
        <Sparkles size={15} className="subtle" />
        <h3>Entreprises suggérées</h3>
        <span className="sub">
          {eligible.length} éligible{eligible.length > 1 ? 's' : ''} · catégorie {match.demandCategory ?? 'inconnue'} · {match.demandCity ?? 'ville inconnue'}
        </span>
        <div className="right">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Masquer les non éligibles' : `Voir les non éligibles (${ineligible.filter((c) => !c.isRequested).length})`}
          </Button>
        </div>
      </div>
      <div style={{ padding: '12px 16px 0' }}>
        <Notice tone={rec.action === 'MANUAL_REVIEW' ? 'warning' : rec.action === 'NONE' ? 'success' : 'accent'} title="Recommandation">
          {rec.summary}
        </Notice>
      </div>
      <div style={{ marginTop: 8 }}>
        {visible.length === 0 ? (
          <EmptyState title="Aucune entreprise pertinente">Aucune entreprise ne propose cette catégorie. Corrigez la catégorie de la demande ou ajoutez une entreprise.</EmptyState>
        ) : (
          visible.map((c) => (
            <label key={c.companyId} className={`candidate ${c.eligible ? '' : 'ineligible'}`}>
              <input
                type="checkbox"
                checked={selected.includes(c.companyId) || c.alreadySent}
                disabled={!c.eligible || c.alreadySent || locked || (!selected.includes(c.companyId) && selected.length >= remaining)}
                onChange={() => toggle(c)}
                aria-label={`Sélectionner ${c.companyName}`}
              />
              <div className="grow">
                <div className="row wrap">
                  <Link to={`/admin/entreprises/${c.companyId}`} className="strong name" onClick={(e) => e.stopPropagation()}>
                    {c.companyName}
                  </Link>
                  <span className="subtle small">{c.city}</span>
                  {c.isRequested && <Badge tone="accent">Demandée</Badge>}
                  {c.mode && <Badge tone={DISTRIBUTION_MODE[c.mode].tone}>{DISTRIBUTION_MODE[c.mode].label}</Badge>}
                  {c.autoDistribution && <Badge tone="outline">Auto</Badge>}
                  {c.alreadySent && <Badge tone="success">Transmise</Badge>}
                  {!c.eligible && <Badge tone="danger">Non éligible</Badge>}
                </div>
                <ul className="reasons">
                  {c.reasons.map((r, i) => (
                    <li key={i} className={r.kind}>
                      {r.kind === 'plus' ? <Check size={12} /> : r.kind === 'block' ? <CircleSlash size={12} /> : r.kind === 'minus' ? <Minus size={12} /> : null}
                      {r.label}
                      {r.points ? <span className="pts">+{r.points}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
              <ScoreMeter score={c.score} />
            </label>
          ))
        )}
      </div>
      <div className="card-b row" style={{ borderTop: '1px solid var(--border)', justifyContent: 'space-between' }}>
        <span className="subtle small">
          {locked ? 'Demande clôturée : distribution désactivée.' : `${sentCount}/${max} envois utilisés · ${selected.length} sélectionnée${selected.length > 1 ? 's' : ''}`}
        </span>
        <Button variant="primary" icon={<Send size={14} />} disabled={selected.length === 0 || locked} onClick={() => setConfirm(true)}>
          Envoyer la demande
        </Button>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        wide
        title={`Envoyer la demande #${demand.number}`}
        description="Simulation : la notification ci-dessous est « envoyée » sur le numéro WhatsApp de réception de chaque entreprise. Aucun message réel ne part."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Annuler</Button>
            <Button
              variant="primary"
              icon={<Send size={14} />}
              loading={distribute.pending}
              onClick={async () => {
                const r = await distribute.run(selected);
                if (r) {
                  setConfirm(false);
                  setSelected([]);
                }
              }}
            >
              Envoyer à {chosen.length} entreprise{chosen.length > 1 ? 's' : ''}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 6 }}>
          {chosen.map((c) => (
            <div key={c.companyId} className="row small">
              <Avatar name={c.companyName} company />
              <span className="strong">{c.companyName}</span>
              {c.mode && <Badge tone={DISTRIBUTION_MODE[c.mode].tone}>{DISTRIBUTION_MODE[c.mode].label}</Badge>}
              <CompanyNumber id={c.companyId} />
            </div>
          ))}
        </div>
        {chosen.some((c) => c.mode === 'FREE_OPPORTUNITY') && (
          <Notice tone="warning">L’envoi consommera l’opportunité gratuite de l’entreprise non abonnée. Les suivantes nécessiteront un abonnement.</Notice>
        )}
        <div>
          <div className="label" style={{ marginBottom: 6 }}>
            Aperçu du message
          </div>
          <div className="pre">{preview.data}</div>
        </div>
      </Dialog>
    </section>
  );
}

function CompanyNumber({ id }: { id: string }) {
  const live = useLive(async (app) => (await app.repo.getCompany(id))?.whatsappNumber ?? null, [id]);
  return <span className="mono subtle" style={{ marginLeft: 'auto' }}>{formatPhone(live.data)}</span>;
}

// ───────────────────────── Distribution history ─────────────────────────

function DistributionHistory({ distributions, companies }: { distributions: import('../../core/types').Distribution[]; companies: { id: string; name: string }[] }) {
  const resend = useAction((app, id: string) => app.resendDistribution(id), (d) => (d.deliveryStatus === 'FAILED' ? 'Nouvel échec d’envoi' : 'Renvoyée avec succès'));
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(() => [...distributions].sort((a, b) => b.sentAt.localeCompare(a.sentAt)), [distributions]);
  const openDist = sorted.find((d) => d.id === open);
  return (
    <section className="card" id="distribution">
      <div className="card-h">
        <h3>Historique de distribution</h3>
        <span className="sub">{distributions.length} envoi{distributions.length > 1 ? 's' : ''}</span>
      </div>
      {sorted.length === 0 ? (
        <EmptyState icon={<Send size={18} />} title="Pas encore transmise">
          Sélectionnez une ou plusieurs entreprises ci-dessus pour simuler l’envoi WhatsApp.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Destination</th>
                <th>Mode</th>
                <th>Livraison</th>
                <th>Suivi entreprise</th>
                <th>Envoyée</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/admin/entreprises/${d.companyId}`} className="primary-cell">
                      {companies.find((c) => c.id === d.companyId)?.name}
                    </Link>
                    <span className="sub">
                      {d.adminAction === 'auto' ? 'Automatique' : d.adminAction === 'resend' ? 'Renvoi' : 'Manuel'} · {d.actor}
                    </span>
                  </td>
                  <td className="mono small">{formatPhone(d.destinationNumber)}</td>
                  <td>
                    <StatusBadge map={DISTRIBUTION_MODE} value={d.mode} />
                  </td>
                  <td>
                    <StatusBadge map={DELIVERY_STATUS} value={d.deliveryStatus} />
                    {d.error && <span className="sub" style={{ color: 'var(--danger)' }}>{d.error}</span>}
                  </td>
                  <td>
                    <StatusBadge map={OUTCOME} value={d.outcome} />
                  </td>
                  <td className="subtle small">
                    <RelTime iso={d.sentAt} />
                  </td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(d.id)}>
                        Message
                      </Button>
                      {d.deliveryStatus === 'FAILED' && (
                        <Button size="sm" icon={<RefreshCw size={13} />} loading={resend.pending} onClick={() => resend.run(d.id)}>
                          Renvoyer
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={Boolean(openDist)}
        onClose={() => setOpen(null)}
        title="Notification WhatsApp envoyée"
        description={openDist ? `${formatPhone(openDist.destinationNumber)} · ${fmt.dateTime(openDist.sentAt)} · id ${openDist.externalId}` : ''}
        footer={
          <Button onClick={() => setOpen(null)} icon={<X size={14} />}>
            Fermer
          </Button>
        }
      >
        <div className="pre">{openDist?.messageBody}</div>
      </Dialog>
    </section>
  );
}
