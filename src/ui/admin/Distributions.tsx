import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { RefreshCw, Search, Send } from 'lucide-react';
import { useAction, useLive } from '../runtime';
import { Button, EmptyState, ErrorState, RelTime, StatusBadge, TableSkeleton, Tabs, useDebounced } from '../components';
import { DELIVERY_STATUS, DISTRIBUTION_MODE, OUTCOME } from '../../core/status';
import { formatPhone } from '../../core/phone';
import { normalize } from '../../core/text';

export function DistributionsLog() {
  const [params, setParams] = useSearchParams();
  const view = params.get('vue') ?? 'all';
  const q = params.get('q') ?? '';
  const dq = useDebounced(q);
  const live = useLive(async (app) => {
    const [distributions, demands, companies] = await Promise.all([app.repo.listDistributions(), app.repo.listDemands(), app.repo.listCompanies()]);
    return { distributions, demands, companies };
  });
  const resend = useAction((app, id: string) => app.resendDistribution(id), (d) => (d.deliveryStatus === 'FAILED' ? 'Nouvel échec' : 'Renvoyée avec succès'));

  const rows = useMemo(() => {
    if (!live.data) return [];
    const nq = normalize(dq);
    return live.data.distributions
      .map((d) => ({ d, demand: live.data!.demands.find((x) => x.id === d.demandId), company: live.data!.companies.find((x) => x.id === d.companyId) }))
      .filter((r) => !nq || normalize([r.company?.name, r.demand?.customerName, String(r.demand?.number), r.d.destinationNumber].join(' ')).includes(nq))
      .sort((a, b) => b.d.sentAt.localeCompare(a.d.sentAt));
  }, [live.data, dq]);
  const filters: Record<string, (r: (typeof rows)[number]) => boolean> = {
    all: () => true,
    auto: (r) => r.d.adminAction === 'auto',
    manual: (r) => r.d.adminAction !== 'auto',
    free: (r) => r.d.mode === 'FREE_OPPORTUNITY',
    failed: (r) => r.d.deliveryStatus === 'FAILED',
  };
  const visible = rows.filter(filters[view] ?? filters.all);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Distributions</h1>
          <div className="desc">Toutes les notifications WhatsApp envoyées aux entreprises (simulées).</div>
        </div>
      </div>
      <Tabs
        value={view}
        onChange={(v) => set('vue', v === 'all' ? '' : v)}
        tabs={[
          { value: 'all', label: 'Toutes', count: rows.length },
          { value: 'auto', label: 'Automatiques', count: rows.filter(filters.auto).length },
          { value: 'manual', label: 'Manuelles', count: rows.filter(filters.manual).length },
          { value: 'free', label: 'Opportunités gratuites', count: rows.filter(filters.free).length },
          { value: 'failed', label: 'Échecs', count: rows.filter(filters.failed).length },
        ]}
      />
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder="Entreprise, client, n° de demande…" value={q} onChange={(e) => set('q', e.target.value)} aria-label="Rechercher" />
          </div>
          <span className="subtle small" style={{ marginLeft: 'auto' }}>
            {visible.length} envoi{visible.length > 1 ? 's' : ''}
          </span>
        </div>
        {live.loading ? (
          <TableSkeleton />
        ) : live.error ? (
          <ErrorState error={live.error} onRetry={live.reload} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Send size={18} />} title="Aucun envoi">
            Rien dans cette vue.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Demande</th>
                  <th>Entreprise</th>
                  <th>Destination</th>
                  <th>Mode</th>
                  <th>Action</th>
                  <th>Livraison</th>
                  <th>Suivi</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map(({ d, demand, company }) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/admin/demandes/${d.demandId}`} className="primary-cell mono">
                        #{demand?.number}
                      </Link>
                      <span className="sub">{demand?.customerName}</span>
                    </td>
                    <td>
                      <Link to={`/admin/entreprises/${d.companyId}`}>{company?.name}</Link>
                    </td>
                    <td className="mono small">{formatPhone(d.destinationNumber)}</td>
                    <td>
                      <StatusBadge map={DISTRIBUTION_MODE} value={d.mode} />
                    </td>
                    <td className="small">
                      {d.adminAction === 'auto' ? 'Automatique' : d.adminAction === 'resend' ? 'Renvoi' : 'Envoi manuel'}
                      <span className="sub">{d.actor}</span>
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
                    <td>
                      {d.deliveryStatus === 'FAILED' && (
                        <Button size="sm" icon={<RefreshCw size={13} />} loading={resend.pending} onClick={() => resend.run(d.id)}>
                          Renvoyer
                        </Button>
                      )}
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
