import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BadgeCheck, Building2, Check, Gift, Inbox, Phone, Search, ThumbsDown, Trophy, XCircle, ArrowLeftRight } from 'lucide-react';
import { useAction, useLive } from '../runtime';
import { Avatar, Badge, Button, EmptyState, ErrorState, Field, MultiToggle, Notice, PageSkeleton, RelTime, StatusBadge, Tabs, fmt, useDebounced } from '../components';
import { DISTRIBUTION_MODE, INTENT_LABEL, OUTCOME, SUBSCRIPTION_STATUS } from '../../core/status';
import { CALLBACK_LABELS } from '../../core/conversation/copy';
import { CITY_NAMES, categoryLabel } from '../../core/catalog';
import { formatPhone } from '../../core/phone';
import { normalize } from '../../core/text';
import type { Company, Distribution, DistributionOutcome, Intent } from '../../core/types';

/** Simulated "login" as a company. */
export function CompanyPicker() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const live = useLive(async (app) => {
    const [companies, distributions] = await Promise.all([app.repo.listCompanies(), app.repo.listDistributions()]);
    return companies.map((c) => ({ c, count: distributions.filter((d) => d.companyId === c.id && d.deliveryStatus !== 'FAILED').length }));
  });
  const rows = (live.data ?? []).filter(({ c }) => !dq || normalize(c.name + c.city).includes(normalize(dq))).sort((a, b) => b.count - a.count);
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-h">
        <div>
          <h1>Espace entreprise</h1>
          <div className="desc">Connexion simulée : choisissez l’entreprise dont vous voulez voir l’espace.</div>
        </div>
      </div>
      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder="Rechercher une entreprise" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une entreprise" />
          </div>
        </div>
        {live.loading ? (
          <div className="card-b subtle">Chargement…</div>
        ) : (
          <table className="table">
            <tbody>
              {rows.map(({ c, count }) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/espace/${c.id}`} className="row">
                      <Avatar name={c.name} company />
                      <span>
                        <span className="primary-cell">{c.name}</span>
                        <span className="sub">
                          {c.activity} · {c.city}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <StatusBadge map={SUBSCRIPTION_STATUS} value={c.subscription.status} />
                  </td>
                  <td className="num small">
                    {count} demande{count > 1 ? 's' : ''}
                  </td>
                  <td className="num">
                    <Link to={`/espace/${c.id}`} className="btn sm">
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

type WsTab = 'demandes' | 'whatsapp' | 'profil' | 'abonnement';

export function CompanyWorkspace() {
  const { companyId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('onglet') ?? 'demandes') as WsTab;
  const live = useLive(
    async (app) => {
      const company = await app.repo.getCompany(companyId);
      if (!company) return null;
      const [distributions, demands, plans, categories] = await Promise.all([app.repo.listDistributions({ companyId }), app.repo.listDemands(), app.repo.listPlans(), app.repo.listCategories()]);
      const requestedCount = demands.filter((d) => d.requestedCompanyId === companyId).length;
      return { company, distributions: distributions.sort((a, b) => b.sentAt.localeCompare(a.sentAt)), demands, plans, categories, requestedCount };
    },
    [companyId],
  );
  if (live.loading) return <PageSkeleton />;
  if (live.error) return <ErrorState error={live.error} onRetry={live.reload} />;
  if (!live.data)
    return (
      <div className="page">
        <EmptyState icon={<Building2 size={20} />} title="Entreprise introuvable" action={<Link to="/espace" className="btn">Choisir une entreprise</Link>} />
      </div>
    );
  const { company, distributions, demands, plans, categories, requestedCount } = live.data;
  const delivered = distributions.filter((d) => d.deliveryStatus !== 'FAILED');
  const unread = delivered.filter((d) => d.outcome === 'SENT').length;
  const subscribed = ['ACTIVE', 'TRIAL'].includes(company.subscription.status);
  const plan = plans.find((p) => p.id === company.subscription.planId);

  return (
    <div>
      <div className="ws-header">
        <div className="inner">
          <Avatar name={company.name} company lg />
          <div className="grow">
            <div className="row wrap">
              <h1 style={{ fontSize: 18 }}>{company.name}</h1>
              <StatusBadge map={SUBSCRIPTION_STATUS} value={company.subscription.status} />
              {subscribed && plan && <Badge tone="outline">{plan.name}</Badge>}
            </div>
            <div className="muted small">
              Espace entreprise Telecontact · demandes reçues sur WhatsApp {formatPhone(company.whatsappNumber)}
            </div>
          </div>
          <Link to="/espace" className="btn sm ghost">
            <ArrowLeftRight size={13} /> Changer d’entreprise
          </Link>
        </div>
      </div>
      <div className="ws-main">
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="label">Demandes reçues</div>
            <div className="value">{delivered.length}</div>
            <div className="foot">{unread} non lue{unread > 1 ? 's' : ''}</div>
          </div>
          <div className="stat">
            <div className="label">Clients contactés</div>
            <div className="value">{delivered.filter((d) => d.outcome === 'CONTACTED' || d.outcome === 'WON').length}</div>
          </div>
          <div className="stat">
            <div className="label">Affaires conclues</div>
            <div className="value">{delivered.filter((d) => d.outcome === 'WON').length}</div>
          </div>
          <div className="stat">
            <div className="label">Clients qui vous ont cherché</div>
            <div className="value">{requestedCount}</div>
            <div className="foot">via votre fiche Telecontact</div>
          </div>
        </div>

        {!subscribed && (
          <div className="upsell" style={{ marginBottom: 16 }}>
            <Gift size={22} color="var(--accent)" />
            <div className="grow">
              <div className="strong">
                {requestedCount} client{requestedCount > 1 ? 's' : ''} ont contacté Telecontact au sujet de {company.name}.
              </div>
              <div className="muted small">
                {company.freeOpportunityUsedAt
                  ? 'Vous avez reçu votre demande offerte. Abonnez-vous pour recevoir automatiquement les suivantes sur votre WhatsApp.'
                  : 'Nous pouvons vous transmettre une première demande gratuitement. Abonnez-vous pour recevoir automatiquement les demandes de votre activité.'}
              </div>
            </div>
            <Button variant="primary" onClick={() => setParams({ onglet: 'abonnement' })}>
              Voir les offres
            </Button>
          </div>
        )}

        <Tabs
          value={tab}
          onChange={(v) => setParams(v === 'demandes' ? {} : { onglet: v })}
          tabs={[
            { value: 'demandes', label: 'Demandes', count: delivered.length },
            { value: 'whatsapp', label: 'Notifications WhatsApp', count: distributions.length },
            { value: 'profil', label: 'Profil & préférences' },
            { value: 'abonnement', label: 'Abonnement' },
          ]}
        />

        {tab === 'demandes' && <InboxView company={company} distributions={delivered} demands={demands} />}
        {tab === 'whatsapp' && <WhatsAppNotifications company={company} distributions={distributions} />}
        {tab === 'profil' && <Preferences company={company} categories={categories} />}
        {tab === 'abonnement' && <SubscriptionView company={company} plans={plans} />}
      </div>
    </div>
  );
}

function InboxView({ company, distributions, demands }: { company: Company; distributions: Distribution[]; demands: import('../../core/types').Demand[] }) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('d') ?? distributions[0]?.id ?? null;
  const selected = distributions.find((d) => d.id === selectedId) ?? null;
  const demand = selected ? demands.find((x) => x.id === selected.demandId) ?? null : null;
  const outcome = useAction((app, id: string, o: DistributionOutcome) => app.setDistributionOutcome(id, o, company.id), (d) => `Suivi : ${OUTCOME[d.outcome].label}`);
  const markViewed = useAction((app, id: string) => app.setDistributionOutcome(id, 'VIEWED', company.id));

  // Opening an unread demand marks it as viewed (visible to Telecontact admins).
  useEffect(() => {
    if (selected && selected.outcome === 'SENT') void markViewed.run(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  if (distributions.length === 0) {
    return (
      <section className="card">
        <EmptyState icon={<Inbox size={20} />} title="Aucune demande pour l’instant">
          Les demandes qualifiées par Telecontact apparaîtront ici et sur votre WhatsApp {formatPhone(company.whatsappNumber)}.
        </EmptyState>
      </section>
    );
  }

  return (
    <div className="inbox">
      <section className="card" style={{ overflow: 'hidden' }}>
        {distributions.map((d) => {
          const dem = demands.find((x) => x.id === d.demandId);
          return (
            <button key={d.id} className={`inbox-item ${d.id === selectedId ? 'active' : ''} ${d.outcome === 'SENT' ? 'unread' : ''}`} onClick={() => setParams({ d: d.id }, { replace: true })}>
              <div className="t">
                {d.outcome === 'SENT' && <span className="unread-dot" />}
                <span className="grow ellipsis">{[dem?.product, dem?.specification].filter(Boolean).join(' ') || dem?.question || dem?.reason}</span>
                <span className="subtle xs">
                  <RelTime iso={d.sentAt} />
                </span>
              </div>
              <div className="row small muted" style={{ marginTop: 3 }}>
                <span>{dem?.customerName}</span>·<span>{dem?.city}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <StatusBadge map={OUTCOME} value={d.outcome} />
                </span>
              </div>
            </button>
          );
        })}
      </section>

      {selected && demand ? (
        <section className="card">
          <div className="card-h">
            <h3>
              Demande n°{demand.number} · {INTENT_LABEL[demand.intent].label}
            </h3>
            <div className="right">
              <StatusBadge map={DISTRIBUTION_MODE} value={selected.mode} />
            </div>
          </div>
          <div className="card-b col" style={{ gap: 16 }}>
            {selected.mode === 'FREE_OPPORTUNITY' && (
              <Notice tone="accent" icon={<Gift size={16} />} title="Demande offerte par Telecontact">
                Cette opportunité vous est transmise gratuitement pour découvrir le service.
              </Notice>
            )}
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={demand.customerName} lg />
              <div className="grow">
                <div className="strong" style={{ fontSize: 15 }}>
                  {demand.customerName}
                </div>
                <div className="muted">{formatPhone(demand.customerPhone)}</div>
              </div>
              <a className="btn" href={`tel:${demand.customerPhone}`} onClick={(e) => e.preventDefault()} title="Appel simulé">
                <Phone size={14} /> Appeler
              </a>
            </div>
            <dl className="kv">
              {(demand.product || demand.specification) && (
                <>
                  <dt>Besoin</dt>
                  <dd className="strong">{[demand.product, demand.specification].filter(Boolean).join(' ')}</dd>
                </>
              )}
              {demand.quantity && (
                <>
                  <dt>Quantité</dt>
                  <dd>{demand.quantity}</dd>
                </>
              )}
              {demand.question && (
                <>
                  <dt>Question</dt>
                  <dd>{demand.question}</dd>
                </>
              )}
              {demand.reason && (
                <>
                  <dt>Motif</dt>
                  <dd>{demand.reason}</dd>
                </>
              )}
              {demand.callbackTime && (
                <>
                  <dt>Rappel souhaité</dt>
                  <dd>{CALLBACK_LABELS[demand.callbackTime]}</dd>
                </>
              )}
              <dt>Ville</dt>
              <dd>{demand.city ?? '—'}</dd>
              {demand.details && (
                <>
                  <dt>Précisions</dt>
                  <dd>{demand.details}</dd>
                </>
              )}
              <dt>Reçue</dt>
              <dd>{fmt.dateTime(selected.sentAt)}</dd>
              <dt>Source</dt>
              <dd>{demand.requestedCompanyId === company.id ? 'Le client vous a cherché sur Telecontact' : 'Demande correspondant à votre activité'}</dd>
            </dl>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>
                Suivi de la demande
              </div>
              <div className="row wrap">
                <Button icon={<Check size={14} />} variant={selected.outcome === 'CONTACTED' ? 'primary' : 'default'} loading={outcome.pending} onClick={() => outcome.run(selected.id, 'CONTACTED')}>
                  Client contacté
                </Button>
                <Button icon={<Trophy size={14} />} variant={selected.outcome === 'WON' ? 'primary' : 'default'} onClick={() => outcome.run(selected.id, 'WON')}>
                  Affaire conclue
                </Button>
                <Button icon={<ThumbsDown size={14} />} variant={selected.outcome === 'LOST' ? 'primary' : 'default'} onClick={() => outcome.run(selected.id, 'LOST')}>
                  Sans suite
                </Button>
                <Button icon={<XCircle size={14} />} variant="danger" onClick={() => outcome.run(selected.id, 'DECLINED')} disabled={selected.outcome === 'DECLINED'}>
                  Décliner
                </Button>
              </div>
              <div className="subtle xs" style={{ marginTop: 6 }}>
                Votre suivi est partagé avec Telecontact.
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="card">
          <EmptyState title="Sélectionnez une demande" />
        </section>
      )}
    </div>
  );
}

function WhatsAppNotifications({ company, distributions }: { company: Company; distributions: Distribution[] }) {
  const sorted = useMemo(() => [...distributions].sort((a, b) => a.sentAt.localeCompare(b.sentAt)), [distributions]);
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
      <div className="phone" style={{ height: 640 }}>
        <div className="phone-screen">
          <div className="wa-head">
            <span className="avatar">T</span>
            <div className="grow">
              <b>
                Telecontact Demandes <BadgeCheck size={15} fill="#25d366" color="#fff" />
              </b>
              <span>vers {formatPhone(company.whatsappNumber)} · simulé</span>
            </div>
          </div>
          <div className="wa-body">
            <div className="wa-sys">🔒 Simulation — notifications reçues sur le WhatsApp de l’entreprise.</div>
            {sorted.length === 0 && <div className="wa-sys">Aucune notification reçue.</div>}
            {sorted.map((d) => (
              <div key={d.id} className={`bubble in ${d.deliveryStatus === 'FAILED' ? 'failed' : ''}`}>
                {d.messageBody}
                <div className="meta">{fmt.dateTime(d.sentAt)}</div>
                {d.deliveryStatus === 'FAILED' && <div className="fail">Non délivré — Telecontact va renvoyer</div>}
              </div>
            ))}
          </div>
          <div className="wa-closed">Réponses désactivées dans la simulation</div>
        </div>
      </div>
      <div className="col" style={{ maxWidth: 360 }}>
        <Notice tone="info" title="Comment ça marche">
          Chaque demande qualifiée qui vous est attribuée est envoyée en message WhatsApp sur le numéro de votre choix. Vous pouvez modifier ce numéro dans « Profil & préférences ».
        </Notice>
      </div>
    </div>
  );
}

function Preferences({ company, categories }: { company: Company; categories: import('../../core/types').Category[] }) {
  const [wa, setWa] = useState(company.whatsappNumber);
  const [cities, setCities] = useState(company.coveredCities);
  const [cats, setCats] = useState(company.acceptedCategories);
  const [intents, setIntents] = useState<Intent[]>(company.acceptedIntents);
  const save = useAction((app) => app.updateCompanyPreferences(company.id, { whatsappNumber: wa, coveredCities: cities, acceptedCategories: cats, acceptedIntents: intents }), 'Préférences enregistrées');
  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
      <section className="card">
        <div className="card-h">
          <h3>Réception des demandes</h3>
        </div>
        <div className="card-b col" style={{ gap: 16 }}>
          <Field label="Numéro WhatsApp de réception" hint="Les demandes vous sont envoyées sur ce numéro (simulation)">
            <input className="input" value={wa} onChange={(e) => setWa(e.target.value)} />
          </Field>
          <Field label={`Villes couvertes en plus de ${company.city}`}>
            <MultiToggle options={CITY_NAMES.filter((c) => c !== company.city).map((c) => ({ value: c, label: c }))} value={cities} onChange={setCities} />
          </Field>
          <Field label="Catégories de demandes acceptées">
            <MultiToggle options={categories.map((c) => ({ value: c.id, label: c.label }))} value={cats} onChange={setCats} />
          </Field>
          <Field label="Types de demandes">
            <MultiToggle options={(Object.keys(INTENT_LABEL) as Intent[]).map((k) => ({ value: k, label: INTENT_LABEL[k].label }))} value={intents} onChange={setIntents} />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" loading={save.pending} onClick={() => save.run()}>
              Enregistrer
            </Button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h">
          <h3>Profil Telecontact</h3>
        </div>
        <div className="card-b">
          <dl className="kv">
            <dt>Activité</dt>
            <dd>{company.activity}</dd>
            <dt>Secteur</dt>
            <dd>{categoryLabel(categories, company.sector)}</dd>
            <dt>Adresse</dt>
            <dd>{company.address}</dd>
            <dt>Téléphone</dt>
            <dd>{formatPhone(company.phone)}</dd>
            <dt>Produits</dt>
            <dd>{company.products.join(', ')}</dd>
          </dl>
          <div style={{ marginTop: 12 }}>
            <Link to={`/fiche/${company.slug}`} className="btn sm">
              Voir ma fiche publique
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function SubscriptionView({ company, plans }: { company: Company; plans: import('../../core/types').Plan[] }) {
  const request = useAction((app, planId: string) => app.requestSubscription(company.id, planId), 'Demande envoyée à Telecontact');
  const current = company.subscription;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Notice tone="info">
        Statut actuel : <b>{SUBSCRIPTION_STATUS[current.status].label}</b>
        {current.planId && ['ACTIVE', 'TRIAL', 'PAUSED'].includes(current.status) && <> · plan {plans.find((p) => p.id === current.planId)?.name}</>}
        {current.requestedAt && <> · demande d’abonnement envoyée {fmt.relative(current.requestedAt)}</>}
      </Notice>
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {plans
          .filter((p) => p.active)
          .map((p) => {
            const isCurrent = current.planId === p.id && ['ACTIVE', 'TRIAL'].includes(current.status);
            const isRequested = current.requestedPlanId === p.id && Boolean(current.requestedAt);
            return (
              <section key={p.id} className="card" style={isCurrent ? { borderColor: 'var(--accent)' } : undefined}>
                <div className="card-h">
                  <h3>{p.name}</h3>
                  {isCurrent && <Badge tone="accent">Votre plan</Badge>}
                </div>
                <div className="card-b col" style={{ gap: 6 }}>
                  <div className="strong">{p.priceLabel}</div>
                  <div className="muted small">{p.description}</div>
                  <div className="small">{p.monthlyQuota === null ? 'Demandes illimitées' : `Jusqu’à ${p.monthlyQuota} demandes / mois`}</div>
                  <div className="small">{p.maxCities === null ? 'Toutes les villes' : `${p.maxCities} ville${p.maxCities > 1 ? 's' : ''}`}</div>
                  <div className="small">{p.autoDistribution ? 'Réception automatique' : 'Validation par Telecontact'}</div>
                  <Button style={{ marginTop: 8 }} variant={isCurrent ? 'default' : 'primary'} disabled={isCurrent || isRequested} loading={request.pending} onClick={() => request.run(p.id)}>
                    {isCurrent ? 'Plan actuel' : isRequested ? 'Demande envoyée' : 'Demander ce plan'}
                  </Button>
                </div>
              </section>
            );
          })}
      </div>
      <span className="subtle small">Aucun paiement : la demande est transmise à l’équipe commerciale Telecontact, qui active l’abonnement depuis l’administration.</span>
    </div>
  );
}

