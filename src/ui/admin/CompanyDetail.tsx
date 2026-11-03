import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronRight, ExternalLink, Pencil, StickyNote, Building2, Gift } from 'lucide-react';
import { useAction, useApp, useLive } from '../runtime';
import { Avatar, Badge, Button, Dialog, EmptyState, ErrorState, Field, Notice, PageSkeleton, RelTime, StatusBadge, Tabs, fmt } from '../components';
import { DEMAND_STATUS, DELIVERY_STATUS, DISTRIBUTION_MODE, INTENT_LABEL, OUTCOME, SUBSCRIPTION_STATUS } from '../../core/status';
import { categoryLabel } from '../../core/catalog';
import { formatPhone } from '../../core/phone';
import type { Company, SubscriptionStatus } from '../../core/types';
import { CompanyForm } from './CompanyForm';
import { Timeline } from './Timeline';

export function CompanyDetail() {
  const { id = '' } = useParams();
  if (id === 'nouvelle') return <NewCompany />;
  return <ExistingCompany id={id} />;
}

function NewCompany() {
  const app = useApp();
  const navigate = useNavigate();
  const draft = useMemo(() => app.newCompanyDraft(), [app]);
  const categories = useLive((a) => a.repo.listCategories());
  const save = useAction((a, c: Company) => a.saveCompany(c), (c) => `${c.name} créée`);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="breadcrumb">
        <Link to="/admin/entreprises">Entreprises</Link>
        <ChevronRight size={13} />
        <span>Nouvelle</span>
      </div>
      <div className="page-h">
        <h1>Nouvelle entreprise</h1>
      </div>
      <section className="card">
        <div className="card-b">
          {categories.data && (
            <CompanyForm
              initial={draft}
              categories={categories.data}
              submitting={save.pending}
              submitLabel="Créer l’entreprise"
              onCancel={() => navigate('/admin/entreprises')}
              onSubmit={async (c) => {
                const saved = await save.run(c);
                if (saved) navigate(`/admin/entreprises/${saved.id}`, { replace: true });
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function ExistingCompany({ id }: { id: string }) {
  const [tab, setTab] = useState<'received' | 'requested'>('received');
  const [editing, setEditing] = useState(false);
  const live = useLive(
    async (app) => {
      const company = await app.repo.getCompany(id);
      if (!company) return null;
      const [categories, plans, demands, distributions, activity] = await Promise.all([
        app.repo.listCategories(),
        app.repo.listPlans(),
        app.repo.listDemands(),
        app.repo.listDistributions({ companyId: id }),
        app.repo.listActivity({ companyId: id }),
      ]);
      return { company, categories, plans, demands, distributions, activity };
    },
    [id],
  );
  const save = useAction((a, c: Company) => a.saveCompany(c), 'Entreprise mise à jour');

  if (live.loading) return <PageSkeleton />;
  if (live.error) return <ErrorState error={live.error} onRetry={live.reload} />;
  if (!live.data)
    return (
      <div className="page">
        <EmptyState icon={<Building2 size={20} />} title="Entreprise introuvable" action={<Link className="btn" to="/admin/entreprises">Retour</Link>} />
      </div>
    );
  const { company, categories, plans, demands, distributions, activity } = live.data;
  const requested = demands.filter((d) => d.requestedCompanyId === company.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const delivered = distributions.filter((d) => d.deliveryStatus !== 'FAILED');
  const engaged = delivered.filter((d) => d.outcome === 'CONTACTED' || d.outcome === 'WON').length;
  const won = delivered.filter((d) => d.outcome === 'WON').length;
  const servedByOthers = requested.filter((d) => !distributions.some((x) => x.demandId === d.id) && demands.length > 0);
  const plan = plans.find((p) => p.id === company.subscription.planId);
  const subscribed = ['ACTIVE', 'TRIAL'].includes(company.subscription.status);

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/admin/entreprises">Entreprises</Link>
        <ChevronRight size={13} />
        <span>{company.name}</span>
      </div>
      <div className="page-h">
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={company.name} company lg />
          <div>
            <div className="row wrap">
              <h1>{company.name}</h1>
              <StatusBadge map={SUBSCRIPTION_STATUS} value={company.subscription.status} />
              {plan && subscribed && <Badge tone="outline">{plan.name}</Badge>}
            </div>
            <div className="desc">
              {company.activity} · {categoryLabel(categories, company.sector)} · {company.city} · fiche {company.ficheId}
            </div>
          </div>
        </div>
        <div className="actions">
          <Link to={`/fiche/${company.slug}`} className="btn">
            Fiche publique <ExternalLink size={13} />
          </Link>
          <Link to={`/espace/${company.id}`} className="btn">
            Espace entreprise <ExternalLink size={13} />
          </Link>
          <Button icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
            Modifier
          </Button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">Demandes de clients</div>
          <div className="value">{requested.length}</div>
          <div className="foot">clients qui ont cherché {company.name}</div>
        </div>
        <div className="stat">
          <div className="label">Demandes reçues</div>
          <div className="value">{delivered.length}</div>
          <div className="foot">{delivered.filter((d) => d.mode === 'FREE_OPPORTUNITY').length} gratuite(s)</div>
        </div>
        <div className="stat">
          <div className="label">Prises en charge</div>
          <div className="value">{engaged}</div>
          <div className="foot">{delivered.length ? fmt.pct(engaged / delivered.length) : '—'} des demandes reçues</div>
        </div>
        <div className="stat">
          <div className="label">Affaires conclues</div>
          <div className="value">{won}</div>
          <div className="foot">déclarées par l’entreprise</div>
        </div>
      </div>

      {!subscribed && servedByOthers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="accent" title="Argument commercial" icon={<Gift size={16} />}>
            {servedByOthers.length} client{servedByOthers.length > 1 ? 's' : ''} ont cherché {company.name} sur Telecontact sans que la demande lui soit transmise
            {company.freeOpportunityUsedAt ? ' (opportunité gratuite déjà utilisée).' : '. La première peut lui être offerte.'} Un abonnement lui permettrait de les recevoir automatiquement.
          </Notice>
        </div>
      )}

      <div className="detail">
        <div className="col">
          <section className="card">
            <div style={{ padding: '0 16px' }}>
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'received', label: 'Demandes reçues', count: distributions.length },
                  { value: 'requested', label: 'Clients qui l’ont demandée', count: requested.length },
                ]}
              />
            </div>
            {tab === 'received' ? (
              distributions.length === 0 ? (
                <EmptyState title="Aucune demande reçue">Les demandes transmises à cette entreprise apparaîtront ici.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Demande</th>
                        <th>Mode</th>
                        <th>Livraison</th>
                        <th>Suivi</th>
                        <th>Envoyée</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...distributions]
                        .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
                        .map((d) => {
                          const dem = demands.find((x) => x.id === d.demandId);
                          return (
                            <tr key={d.id}>
                              <td>
                                <Link to={`/admin/demandes/${d.demandId}`} className="primary-cell">
                                  #{dem?.number} · {dem?.customerName}
                                </Link>
                                <span className="sub">{[dem?.product, dem?.specification].filter(Boolean).join(' ') || dem?.question || dem?.reason}</span>
                              </td>
                              <td>
                                <StatusBadge map={DISTRIBUTION_MODE} value={d.mode} />
                              </td>
                              <td>
                                <StatusBadge map={DELIVERY_STATUS} value={d.deliveryStatus} />
                              </td>
                              <td>
                                <StatusBadge map={OUTCOME} value={d.outcome} />
                              </td>
                              <td className="subtle small">
                                <RelTime iso={d.sentAt} />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )
            ) : requested.length === 0 ? (
              <EmptyState title="Aucune demande">Aucun visiteur n’a encore contacté cette entreprise via WhatsApp.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Demande</th>
                      <th>Type</th>
                      <th>Statut</th>
                      <th>Transmise à</th>
                      <th>Reçue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requested.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <Link to={`/admin/demandes/${d.id}`} className="primary-cell">
                            #{d.number} · {d.customerName}
                          </Link>
                          <span className="sub">{[d.product, d.specification].filter(Boolean).join(' ') || d.question || d.reason}</span>
                        </td>
                        <td className="small">{INTENT_LABEL[d.intent].short}</td>
                        <td>
                          <StatusBadge map={DEMAND_STATUS} value={d.status} />
                        </td>
                        <td className="small">
                          <DistributedTo demandId={d.id} companyId={company.id} />
                        </td>
                        <td className="subtle small">
                          <RelTime iso={d.createdAt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-h">
              <h3>Activité</h3>
            </div>
            <div className="card-b">
              <Timeline entries={activity.filter((a) => a.entity !== 'conversation')} limit={25} />
            </div>
          </section>
        </div>

        <div className="col">
          <SubscriptionCard key={company.updatedAt} company={company} plans={plans} />

          <section className="card">
            <div className="card-h">
              <h3>Réception des demandes</h3>
            </div>
            <div className="card-b">
              <dl className="kv">
                <dt>WhatsApp</dt>
                <dd className="mono">{formatPhone(company.whatsappNumber)}</dd>
                <dt>Villes</dt>
                <dd>{[company.city, ...company.coveredCities].join(', ')}</dd>
                <dt>Catégories</dt>
                <dd>{company.acceptedCategories.map((c) => categoryLabel(categories, c)).join(', ') || '—'}</dd>
                <dt>Types</dt>
                <dd>{company.acceptedIntents.map((i) => INTENT_LABEL[i].short).join(', ')}</dd>
                <dt>Produits</dt>
                <dd>{company.products.join(', ')}</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>Coordonnées</h3>
            </div>
            <div className="card-b">
              <dl className="kv">
                <dt>Téléphone</dt>
                <dd>{formatPhone(company.phone)}</dd>
                <dt>E-mail</dt>
                <dd>{company.email}</dd>
                <dt>Adresse</dt>
                <dd>{company.address}</dd>
                <dt>Site</dt>
                <dd>{company.website}</dd>
                <dt>Note</dt>
                <dd>{company.rating.toFixed(1)} / 5</dd>
              </dl>
            </div>
          </section>

          <Notes company={company} />
        </div>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title={`Modifier ${company.name}`} wide>
        <CompanyForm
          initial={company}
          categories={categories}
          submitting={save.pending}
          onCancel={() => setEditing(false)}
          onSubmit={async (c) => {
            if (await save.run(c)) setEditing(false);
          }}
        />
      </Dialog>
    </div>
  );
}

function DistributedTo({ demandId, companyId }: { demandId: string; companyId: string }) {
  const live = useLive(async (app) => {
    const [dists, companies] = await Promise.all([app.repo.listDistributions({ demandId }), app.repo.listCompanies()]);
    return dists.filter((d) => d.deliveryStatus !== 'FAILED').map((d) => ({ self: d.companyId === companyId, name: companies.find((c) => c.id === d.companyId)?.name ?? '?' }));
  }, [demandId]);
  if (!live.data) return null;
  if (live.data.length === 0) return <span className="subtle">—</span>;
  return (
    <span className="row wrap" style={{ gap: 4 }}>
      {live.data.map((x, i) => (
        <Badge key={i} tone={x.self ? 'success' : 'neutral'}>
          {x.self ? 'Elle-même' : x.name}
        </Badge>
      ))}
    </span>
  );
}

function SubscriptionCard({ company, plans }: { company: Company; plans: import('../../core/types').Plan[] }) {
  const [status, setStatus] = useState<SubscriptionStatus>(company.subscription.status);
  const [planId, setPlanId] = useState<string>(company.subscription.planId ?? company.subscription.requestedPlanId ?? plans[1]?.id ?? '');
  const change = useAction((a) => a.setSubscription(company.id, status, status === 'NONE' ? null : planId), 'Abonnement mis à jour (simulation)');
  const dirty = status !== company.subscription.status || (status !== 'NONE' && planId !== company.subscription.planId);
  const requestedPlan = plans.find((p) => p.id === company.subscription.requestedPlanId);
  return (
    <section className="card">
      <div className="card-h">
        <h3>Abonnement</h3>
        <span className="sub">simulation</span>
      </div>
      <div className="card-b col" style={{ gap: 12 }}>
        {company.subscription.requestedAt && (
          <Notice tone="accent" title="Demande d’abonnement">
            Plan {requestedPlan?.name ?? '—'} demandé <RelTime iso={company.subscription.requestedAt} /> depuis l’espace entreprise.
          </Notice>
        )}
        <dl className="kv">
          <dt>Depuis</dt>
          <dd>{fmt.date(company.subscription.startedAt)}</dd>
          <dt>Offre gratuite</dt>
          <dd>{company.freeOpportunityUsedAt ? `Utilisée le ${fmt.date(company.freeOpportunityUsedAt)}` : 'Disponible'}</dd>
        </dl>
        <div className="grid-2" style={{ gap: 8 }}>
          <Field label="Statut">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
              {(Object.keys(SUBSCRIPTION_STATUS) as SubscriptionStatus[]).map((s) => (
                <option key={s} value={s}>
                  {SUBSCRIPTION_STATUS[s].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Plan">
            <select className="select" value={planId} disabled={status === 'NONE'} onChange={(e) => setPlanId(e.target.value)}>
              {plans
                .filter((p) => p.active || p.id === planId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Button variant="primary" disabled={!dirty} loading={change.pending} onClick={() => change.run()}>
          Appliquer
        </Button>
        <span className="subtle xs">Le changement est immédiatement pris en compte par le moteur de matching.</span>
      </div>
    </section>
  );
}

function Notes({ company }: { company: Company }) {
  const [body, setBody] = useState('');
  const add = useAction((a) => a.addCompanyNote(company.id, body), 'Note ajoutée');
  return (
    <section className="card">
      <div className="card-h">
        <StickyNote size={15} className="subtle" />
        <h3>Notes internes</h3>
      </div>
      <div className="card-b col">
        <form
          className="col"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await add.run()) setBody('');
          }}
        >
          <textarea className="textarea" placeholder="Appel, relance, objection…" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 60 }} aria-label="Nouvelle note" />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" type="submit" disabled={!body.trim()} loading={add.pending}>
              Ajouter
            </Button>
          </div>
        </form>
        {company.notes.length === 0 ? (
          <span className="subtle small">Aucune note.</span>
        ) : (
          company.notes.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div className="small">{n.body}</div>
              <div className="subtle xs" style={{ marginTop: 2 }}>
                {n.author} · {fmt.dateTime(n.at)}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
