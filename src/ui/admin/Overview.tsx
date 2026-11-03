import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useLive } from '../runtime';
import { Badge, ErrorState, PageSkeleton, fmt } from '../components';
import { INTENT_LABEL } from '../../core/status';
import type { Intent } from '../../core/types';

/** Analytics — every number is computed from the stored demo records. */
export function Overview() {
  const [days, setDays] = useState(30);
  const live = useLive((app) => app.metrics(days), [days]);
  if (live.loading) return <PageSkeleton />;
  if (live.error || !live.data) return <ErrorState error={live.error ?? new Error('—')} onRetry={live.reload} />;
  const m = live.data;
  const maxFunnel = Math.max(1, ...m.funnel.map((f) => f.value));
  const maxDaily = Math.max(1, ...m.daily.map((d) => Math.max(d.clicks, d.demands)));
  const maxCity = Math.max(1, ...m.byCity.map((c) => c.count));
  const maxCat = Math.max(1, ...m.byCategory.map((c) => c.count));

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Vue d’ensemble</h1>
          <div className="desc">Du trafic Telecontact aux opportunités commerciales — calculé sur les données de démonstration.</div>
        </div>
        <div className="actions">
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Période">
            <option value={7}>7 derniers jours</option>
            <option value={30}>30 derniers jours</option>
            <option value={90}>90 derniers jours</option>
          </select>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Clics WhatsApp" value={fmt.num(m.waClicks)} foot={`${fmt.pct(m.ficheViews ? m.waClicks / m.ficheViews : null)} des vues de fiches`} />
        <Stat label="Conversations" value={fmt.num(m.conversations)} foot={`${m.conversationsActive} en cours · ${m.conversationsAbandoned} abandonnées`} />
        <Stat label="Taux de consentement" value={fmt.pct(m.consentRate)} foot={`${m.consentAccepted} / ${m.consentDecided} réponses`} />
        <Stat label="Demandes qualifiées" value={fmt.num(m.demands)} foot={`${fmt.pct(m.clickToDemandRate)} des clics`} />
        <Stat label="Demandes transmises" value={fmt.num(m.demandsDistributed)} foot={`${m.companiesContacted} entreprises contactées`} />
        <Stat label="Prises en charge" value={fmt.num(m.demandsAcceptedByCompanies)} foot={`${m.companiesEngaged} entreprises actives`} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', marginBottom: 16 }}>
        <section className="card">
          <div className="card-h">
            <h3>Entonnoir de conversion</h3>
            <span className="sub">conversion par rapport à l’étape précédente</span>
          </div>
          <div className="card-b funnel">
            {m.funnel.map((f, i) => {
              const prev = i > 0 ? m.funnel[i - 1].value : null;
              return (
                <div key={f.key} className="funnel-row">
                  <span className="muted">{f.label}</span>
                  <div className="funnel-bar">
                    <div style={{ width: `${(f.value / maxFunnel) * 100}%` }} />
                  </div>
                  <span className="num strong" style={{ textAlign: 'right' }}>
                    {fmt.num(f.value)}
                  </span>
                  <span className="conv">{prev ? fmt.pct(f.value / prev) : ''}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h3>Activité quotidienne</h3>
            <div className="right legend">
              <span>
                <i style={{ background: '#c4cff5' }} />
                Clics
              </span>
              <span>
                <i style={{ background: 'var(--accent)' }} />
                Demandes
              </span>
            </div>
          </div>
          <div className="card-b">
            <div className="spark" role="img" aria-label="Clics et demandes par jour">
              {m.daily.map((d) => (
                <div key={d.date} className="day" title={`${fmt.date(d.date)} — ${d.clicks} clics, ${d.demands} demandes`}>
                  <div className="c" style={{ height: `${(Math.max(0, d.clicks - d.demands) / maxDaily) * 100}%` }} />
                  <div className="d" style={{ height: `${(d.demands / maxDaily) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="row subtle xs" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span>{fmt.date(m.daily[0]?.date)}</span>
              <span>Aujourd’hui</span>
            </div>
            <div className="divider" />
            <div className="row" style={{ gap: 18 }}>
              {(Object.keys(m.demandsByIntent) as Intent[]).map((k) => (
                <div key={k}>
                  <div className="subtle xs">{INTENT_LABEL[k].label}</div>
                  <div className="strong num">{m.demandsByIntent[k]}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-h">
            <h3>Entreprises les plus demandées</h3>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th className="num">Clics</th>
                  <th className="num">Demandes</th>
                </tr>
              </thead>
              <tbody>
                {m.topRequested.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <Link to={`/admin/entreprises/${r.key}`} className="primary-cell">
                        {r.label}
                      </Link>
                      {!r.subscribed && (
                        <span className="sub" style={{ color: 'var(--warning)' }}>
                          Non abonnée — prospect
                        </span>
                      )}
                    </td>
                    <td className="num">{r.clicks}</td>
                    <td className="num strong">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h3>Demandes par ville</h3>
          </div>
          <div className="card-b bars">
            {m.byCity.slice(0, 8).map((c) => (
              <div key={c.key} className="bar-row">
                <span className="ellipsis">{c.label}</span>
                <div className="track">
                  <div style={{ width: `${(c.count / maxCity) * 100}%` }} />
                </div>
                <span className="num small" style={{ textAlign: 'right' }}>
                  {c.count}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h3>Demandes par catégorie</h3>
          </div>
          <div className="card-b bars">
            {m.byCategory.slice(0, 8).map((c) => (
              <div key={c.key} className="bar-row">
                <span className="ellipsis" title={c.label}>
                  {c.label}
                </span>
                <div className="track">
                  <div style={{ width: `${(c.count / maxCat) * 100}%` }} />
                </div>
                <span className="num small" style={{ textAlign: 'right' }}>
                  {c.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-h">
          <h3>Performance des abonnements</h3>
          <div className="right">
            <Link to="/admin/abonnements" className="btn sm ghost">
              Gérer <ArrowRight size={13} />
            </Link>
          </div>
        </div>
        <div className="card-b">
          <div className="stats" style={{ border: 0, marginBottom: 12 }}>
            <Stat label="Opportunités gratuites envoyées" value={String(m.subscriptions.freeOpportunitiesSent)} />
            <Stat label="Abonnés après opportunité gratuite" value={String(m.subscriptions.convertedAfterFree)} foot={`${fmt.pct(m.subscriptions.freeConversionRate)} de conversion`} />
            <Stat label="Livrées aux abonnés" value={String(m.subscriptions.deliveredToSubscribers)} />
            <Stat label="Livrées en opportunité gratuite" value={String(m.subscriptions.deliveredAsFree)} />
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {m.subscriptions.byStatus.map((s) => (
              <Badge key={s.key} tone="outline">
                {s.label} · {s.count}
              </Badge>
            ))}
            <span className="subtle small" style={{ marginLeft: 8 }}>
              Par plan :
            </span>
            {m.subscriptions.byPlan.map((p) => (
              <Badge key={p.key} tone="accent">
                {p.label} · {p.count} entreprises · {p.delivered} demandes
              </Badge>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
