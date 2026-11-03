import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Inbox, Search } from 'lucide-react';
import { useLive } from '../runtime';
import { Badge, Button, EmptyState, ErrorState, RelTime, StatusBadge, TableSkeleton, Tabs, useDebounced } from '../components';
import { DEMAND_STATUS, INTENT_LABEL } from '../../core/status';
import type { DemandStatus, Intent } from '../../core/types';
import { normalize } from '../../core/text';
import { CITY_NAMES } from '../../core/catalog';

const VIEWS: { value: string; label: string; statuses: DemandStatus[] | null }[] = [
  { value: 'todo', label: 'À traiter', statuses: ['NEW', 'IN_REVIEW'] },
  { value: 'distributed', label: 'Transmises', statuses: ['DISTRIBUTED'] },
  { value: 'accepted', label: 'Prises en charge', statuses: ['ACCEPTED'] },
  { value: 'closed', label: 'Clôturées / rejetées', statuses: ['CLOSED', 'REJECTED'] },
  { value: 'all', label: 'Toutes', statuses: null },
];

export function DemandsList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('vue') ?? 'todo';
  const q = params.get('q') ?? '';
  const intent = (params.get('type') ?? '') as Intent | '';
  const city = params.get('ville') ?? '';
  const company = params.get('entreprise') ?? '';
  const dq = useDebounced(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const live = useLive(async (app) => {
    const [demands, companies, distributions] = await Promise.all([app.repo.listDemands(), app.repo.listCompanies(), app.repo.listDistributions()]);
    return { demands, companies, distributions };
  });

  const rows = useMemo(() => {
    if (!live.data) return [];
    const { demands, companies, distributions } = live.data;
    const nq = normalize(dq);
    return demands
      .map((d) => {
        const requested = companies.find((c) => c.id === d.requestedCompanyId);
        const dist = distributions.filter((x) => x.demandId === d.id);
        return { d, requested, sent: dist.filter((x) => x.deliveryStatus !== 'FAILED').length, failed: dist.some((x) => x.deliveryStatus === 'FAILED') };
      })
      .filter(({ d, requested }) => {
        if (intent && d.intent !== intent) return false;
        if (city && d.city !== city) return false;
        if (company && d.requestedCompanyId !== company) return false;
        if (nq) {
          const hay = normalize([String(d.number), d.customerName, d.customerPhone, d.product, d.specification, d.question, d.reason, requested?.name, d.city].filter(Boolean).join(' '));
          if (!hay.includes(nq)) return false;
        }
        return true;
      })
      .sort((a, b) => b.d.createdAt.localeCompare(a.d.createdAt));
  }, [live.data, dq, intent, city, company]);

  const current = VIEWS.find((v) => v.value === view) ?? VIEWS[0];
  const visible = rows.filter((r) => !current.statuses || current.statuses.includes(r.d.status));
  const filtersActive = Boolean(q || intent || city || company);

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Demandes</h1>
          <div className="desc">Demandes qualifiées issues des conversations WhatsApp.</div>
        </div>
      </div>
      <Tabs
        value={current.value}
        onChange={(v) => set('vue', v === 'todo' ? '' : v)}
        tabs={VIEWS.map((v) => ({ value: v.value, label: v.label, count: rows.filter((r) => !v.statuses || v.statuses.includes(r.d.status)).length }))}
      />
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder="N°, client, produit, entreprise…" value={q} onChange={(e) => set('q', e.target.value)} aria-label="Rechercher une demande" />
          </div>
          <select className="select" value={intent} onChange={(e) => set('type', e.target.value)} aria-label="Type">
            <option value="">Tous les types</option>
            {(Object.keys(INTENT_LABEL) as Intent[]).map((k) => (
              <option key={k} value={k}>
                {INTENT_LABEL[k].label}
              </option>
            ))}
          </select>
          <select className="select" value={city} onChange={(e) => set('ville', e.target.value)} aria-label="Ville">
            <option value="">Toutes les villes</option>
            {CITY_NAMES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="select" value={company} onChange={(e) => set('entreprise', e.target.value)} aria-label="Entreprise demandée">
            <option value="">Toutes les entreprises</option>
            {live.data?.companies
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={() => setParams(view !== 'todo' ? { vue: view } : {}, { replace: true })}>
              Effacer les filtres
            </Button>
          )}
          <span className="subtle small" style={{ marginLeft: 'auto' }}>
            {visible.length} résultat{visible.length > 1 ? 's' : ''}
          </span>
        </div>
        {live.loading ? (
          <TableSkeleton />
        ) : live.error ? (
          <ErrorState error={live.error} onRetry={live.reload} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Inbox size={20} />} title={filtersActive ? 'Aucune demande ne correspond' : 'Rien à traiter'}>
            {filtersActive ? 'Modifiez ou effacez les filtres.' : 'Les nouvelles demandes qualifiées apparaîtront ici dès qu’une conversation WhatsApp sera terminée.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Client</th>
                  <th>Besoin</th>
                  <th>Entreprise demandée</th>
                  <th>Ville</th>
                  <th>Statut</th>
                  <th className="num">Envois</th>
                  <th>Reçue</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ d, requested, sent, failed }) => (
                  <tr key={d.id} className="clickable" onClick={() => navigate(`/admin/demandes/${d.id}`)}>
                    <td className="mono">#{d.number}</td>
                    <td>
                      <span className="primary-cell">{d.customerName}</span>
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      <div className="ellipsis">{[d.product, d.specification].filter(Boolean).join(' ') || d.question || d.reason}</div>
                      <span className="sub">
                        {INTENT_LABEL[d.intent].label}
                        {d.quantity ? ` · qté ${d.quantity}` : ''}
                      </span>
                    </td>
                    <td>
                      {requested?.name ?? <span className="subtle">Non identifiée</span>}
                      {requested && !['ACTIVE', 'TRIAL'].includes(requested.subscription.status) && <span className="sub">non abonnée</span>}
                    </td>
                    <td>{d.city ?? '—'}</td>
                    <td>
                      <StatusBadge map={DEMAND_STATUS} value={d.status} />
                    </td>
                    <td className="num">
                      {failed ? (
                        <Badge tone="danger" title="Un envoi a échoué">
                          {sent} · échec
                        </Badge>
                      ) : (
                        sent || <span className="subtle">—</span>
                      )}
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
      </div>
    </div>
  );
}
