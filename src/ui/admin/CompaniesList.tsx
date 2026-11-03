import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Building2, Plus, Search } from 'lucide-react';
import { useLive } from '../runtime';
import { Avatar, Badge, Button, EmptyState, ErrorState, StatusBadge, TableSkeleton, fmt, useDebounced } from '../components';
import { SUBSCRIPTION_STATUS } from '../../core/status';
import { CITY_NAMES, categoryLabel } from '../../core/catalog';
import { normalize } from '../../core/text';
import type { SubscriptionStatus } from '../../core/types';

export function CompaniesList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const city = params.get('ville') ?? '';
  const sector = params.get('secteur') ?? '';
  const sub = params.get('abonnement') ?? '';
  const dq = useDebounced(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const live = useLive(async (app) => {
    const [companies, categories, demands, distributions, plans] = await Promise.all([app.repo.listCompanies(), app.repo.listCategories(), app.repo.listDemands(), app.repo.listDistributions(), app.repo.listPlans()]);
    return { companies, categories, demands, distributions, plans };
  });

  const rows = useMemo(() => {
    if (!live.data) return [];
    const { companies, demands, distributions } = live.data;
    const nq = normalize(dq);
    return companies
      .filter((c) => !city || c.city === city || c.coveredCities.includes(city))
      .filter((c) => !sector || c.sector === sector || c.acceptedCategories.includes(sector))
      .filter((c) => !sub || c.subscription.status === sub)
      .filter((c) => !nq || normalize([c.name, c.activity, ...c.products].join(' ')).includes(nq))
      .map((c) => {
        const requested = demands.filter((d) => d.requestedCompanyId === c.id).length;
        const received = distributions.filter((d) => d.companyId === c.id && d.deliveryStatus !== 'FAILED');
        const engaged = received.filter((d) => d.outcome === 'CONTACTED' || d.outcome === 'WON').length;
        return { c, requested, received: received.length, engaged };
      })
      .sort((a, b) => b.requested - a.requested || a.c.name.localeCompare(b.c.name));
  }, [live.data, dq, city, sector, sub]);

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Entreprises</h1>
          <div className="desc">Fiches Telecontact, préférences de réception et abonnements.</div>
        </div>
        <div className="actions">
          <Link to="/admin/entreprises/nouvelle" className="btn primary">
            <Plus size={15} /> Nouvelle entreprise
          </Link>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder="Nom, activité, produit…" value={q} onChange={(e) => set('q', e.target.value)} aria-label="Rechercher une entreprise" />
          </div>
          <select className="select" value={city} onChange={(e) => set('ville', e.target.value)} aria-label="Ville">
            <option value="">Toutes les villes</option>
            {CITY_NAMES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="select" value={sector} onChange={(e) => set('secteur', e.target.value)} aria-label="Secteur">
            <option value="">Tous les secteurs</option>
            {live.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select className="select" value={sub} onChange={(e) => set('abonnement', e.target.value)} aria-label="Abonnement">
            <option value="">Tous les abonnements</option>
            {(Object.keys(SUBSCRIPTION_STATUS) as SubscriptionStatus[]).map((s) => (
              <option key={s} value={s}>
                {SUBSCRIPTION_STATUS[s].label}
              </option>
            ))}
          </select>
          {(q || city || sector || sub) && (
            <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
              Effacer les filtres
            </Button>
          )}
          <span className="subtle small" style={{ marginLeft: 'auto' }}>
            {rows.length} entreprise{rows.length > 1 ? 's' : ''}
          </span>
        </div>
        {live.loading ? (
          <TableSkeleton />
        ) : live.error ? (
          <ErrorState error={live.error} onRetry={live.reload} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Building2 size={20} />} title="Aucune entreprise" action={<Link to="/admin/entreprises/nouvelle" className="btn">Créer une entreprise</Link>}>
            Aucune fiche ne correspond à ces critères.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Secteur</th>
                  <th>Abonnement</th>
                  <th className="num">Demandée</th>
                  <th className="num">Reçues</th>
                  <th className="num">Prises en charge</th>
                  <th>Mise à jour</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, requested, received, engaged }) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/admin/entreprises/${c.id}`)}>
                    <td>
                      <div className="row">
                        <Avatar name={c.name} company />
                        <div>
                          <span className="primary-cell">{c.name}</span>
                          <span className="sub">
                            {c.city}
                            {c.coveredCities.length > 0 && ` + ${c.coveredCities.length} ville${c.coveredCities.length > 1 ? 's' : ''}`}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="small">{categoryLabel(live.data!.categories, c.sector)}</td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        <StatusBadge map={SUBSCRIPTION_STATUS} value={c.subscription.status} />
                        {c.subscription.planId && ['ACTIVE', 'TRIAL', 'PAUSED'].includes(c.subscription.status) && (
                          <span className="subtle small">{live.data!.plans.find((p) => p.id === c.subscription.planId)?.name}</span>
                        )}
                        {(c.subscription.status === 'NONE' || c.subscription.status === 'CANCELLED') && !c.freeOpportunityUsedAt && <Badge tone="warning">Offre gratuite dispo.</Badge>}
                        {c.subscription.requestedAt && <Badge tone="accent">Demande d’abonnement</Badge>}
                      </div>
                    </td>
                    <td className="num">{requested}</td>
                    <td className="num">{received}</td>
                    <td className="num">{received ? `${engaged} · ${fmt.pct(engaged / received)}` : '—'}</td>
                    <td className="subtle small">{fmt.date(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
