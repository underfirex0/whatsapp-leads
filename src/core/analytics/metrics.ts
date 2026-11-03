import type { Database, DemandStatus, Intent } from '../types';
import { DAY } from '../clock';

/**
 * Analytics computed exclusively from stored records — no hard-coded numbers.
 * Pure function, so it can later be replaced by SQL views without UI changes.
 */

export type MetricsSource = Pick<
  Database,
  'tracking' | 'conversations' | 'demands' | 'distributions' | 'companies' | 'plans' | 'categories'
>;

export interface CountRow {
  key: string;
  label: string;
  count: number;
}

export interface Metrics {
  range: { from: string; to: string; days: number };
  ficheViews: number;
  waClicks: number;
  conversations: number;
  conversationsCompleted: number;
  conversationsRefused: number;
  conversationsAbandoned: number;
  conversationsActive: number;
  consentDecided: number;
  consentAccepted: number;
  consentRate: number | null;
  demands: number;
  demandsByStatus: Record<DemandStatus, number>;
  demandsByIntent: Record<Intent, number>;
  demandsDistributed: number;
  distributions: number;
  distributionsDelivered: number;
  distributionsFailed: number;
  companiesContacted: number;
  companiesEngaged: number;
  demandsAcceptedByCompanies: number;
  clickToDemandRate: number | null;
  demandToDistributionRate: number | null;
  funnel: { key: string; label: string; value: number }[];
  byCity: CountRow[];
  byCategory: CountRow[];
  topRequested: (CountRow & { clicks: number; subscribed: boolean })[];
  daily: { date: string; clicks: number; demands: number }[];
  subscriptions: {
    byStatus: CountRow[];
    byPlan: (CountRow & { delivered: number })[];
    freeOpportunitiesSent: number;
    convertedAfterFree: number;
    freeConversionRate: number | null;
    deliveredToSubscribers: number;
    deliveredAsFree: number;
  };
}

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

function inRange(iso: string, from: number, to: number) {
  const t = Date.parse(iso);
  return t >= from && t <= to;
}

function countBy<T>(rows: T[], key: (r: T) => string | null, label: (k: string) => string): CountRow[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([k, count]) => ({ key: k, label: label(k), count })).sort((a, b) => b.count - a.count);
}

export function computeMetrics(db: MetricsSource, now: Date, days = 30): Metrics {
  const to = now.getTime();
  const from = to - days * DAY;

  const tracking = db.tracking.filter((t) => inRange(t.at, from, to));
  const conversations = db.conversations.filter((c) => inRange(c.createdAt, from, to));
  const demands = db.demands.filter((d) => inRange(d.createdAt, from, to));
  const demandIds = new Set(demands.map((d) => d.id));
  const distributions = db.distributions.filter((d) => demandIds.has(d.demandId));
  const delivered = distributions.filter((d) => d.deliveryStatus !== 'FAILED');

  const ficheViews = tracking.filter((t) => t.type === 'FICHE_VIEW').length;
  const waClicks = tracking.filter((t) => t.type === 'WA_CLICK').length;
  const consentDecided = conversations.filter((c) => c.consent !== null).length;
  const consentAccepted = conversations.filter((c) => c.consent === true).length;

  const demandsByStatus = { NEW: 0, IN_REVIEW: 0, DISTRIBUTED: 0, ACCEPTED: 0, CLOSED: 0, REJECTED: 0 } as Record<DemandStatus, number>;
  const demandsByIntent = { PRICE: 0, INFO: 0, CALLBACK: 0 } as Record<Intent, number>;
  for (const d of demands) {
    demandsByStatus[d.status] += 1;
    demandsByIntent[d.intent] += 1;
  }

  const distributedDemandIds = new Set(delivered.map((d) => d.demandId));
  const engaged = delivered.filter((d) => ['CONTACTED', 'WON'].includes(d.outcome));
  const acceptedDemandIds = new Set(engaged.map((d) => d.demandId));

  const companyName = (id: string) => db.companies.find((c) => c.id === id)?.name ?? 'Inconnue';
  const categoryLabel = (id: string) => db.categories.find((c) => c.id === id)?.label ?? id;

  const requested = countBy(demands, (d) => d.requestedCompanyId, companyName);
  const clicksByCompany = new Map<string, number>();
  for (const t of tracking) if (t.type === 'WA_CLICK') clicksByCompany.set(t.companyId, (clicksByCompany.get(t.companyId) ?? 0) + 1);
  const topRequested = requested.slice(0, 8).map((r) => {
    const company = db.companies.find((c) => c.id === r.key);
    return {
      ...r,
      clicks: clicksByCompany.get(r.key) ?? 0,
      subscribed: company ? ['ACTIVE', 'TRIAL'].includes(company.subscription.status) : false,
    };
  });

  const daily: Metrics['daily'] = [];
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let t = start.getTime(); t <= to; t += DAY) {
    const dayEnd = t + DAY;
    daily.push({
      date: new Date(t).toISOString().slice(0, 10),
      clicks: tracking.filter((e) => e.type === 'WA_CLICK' && Date.parse(e.at) >= t && Date.parse(e.at) < dayEnd).length,
      demands: demands.filter((d) => Date.parse(d.createdAt) >= t && Date.parse(d.createdAt) < dayEnd).length,
    });
  }

  // Subscription performance uses all companies (current state), deliveries in range.
  const statusLabels: Record<string, string> = { NONE: 'Non abonnée', TRIAL: 'Essai', ACTIVE: 'Abonnée', PAUSED: 'En pause', CANCELLED: 'Résiliée' };
  const byStatus = countBy(db.companies, (c) => c.subscription.status, (k) => statusLabels[k] ?? k);
  const byPlan = db.plans.map((p) => {
    const ids = new Set(db.companies.filter((c) => c.subscription.planId === p.id && ['ACTIVE', 'TRIAL'].includes(c.subscription.status)).map((c) => c.id));
    return { key: p.id, label: p.name, count: ids.size, delivered: delivered.filter((d) => ids.has(d.companyId)).length };
  });
  const freeSent = db.distributions.filter((d) => d.mode === 'FREE_OPPORTUNITY' && d.deliveryStatus !== 'FAILED');
  const freeCompanies = new Set(freeSent.map((d) => d.companyId));
  const converted = db.companies.filter(
    (c) =>
      freeCompanies.has(c.id) &&
      ['ACTIVE', 'TRIAL'].includes(c.subscription.status) &&
      c.subscription.startedAt &&
      c.freeOpportunityUsedAt &&
      c.subscription.startedAt >= c.freeOpportunityUsedAt,
  ).length;

  return {
    range: { from: new Date(from).toISOString(), to: now.toISOString(), days },
    ficheViews,
    waClicks,
    conversations: conversations.length,
    conversationsCompleted: conversations.filter((c) => c.status === 'COMPLETED').length,
    conversationsRefused: conversations.filter((c) => c.status === 'REFUSED').length,
    conversationsAbandoned: conversations.filter((c) => c.status === 'ABANDONED').length,
    conversationsActive: conversations.filter((c) => c.status === 'ACTIVE').length,
    consentDecided,
    consentAccepted,
    consentRate: rate(consentAccepted, consentDecided),
    demands: demands.length,
    demandsByStatus,
    demandsByIntent,
    demandsDistributed: distributedDemandIds.size,
    distributions: distributions.length,
    distributionsDelivered: delivered.length,
    distributionsFailed: distributions.length - delivered.length,
    companiesContacted: new Set(delivered.map((d) => d.companyId)).size,
    companiesEngaged: new Set(engaged.map((d) => d.companyId)).size,
    demandsAcceptedByCompanies: acceptedDemandIds.size,
    clickToDemandRate: rate(demands.length, waClicks),
    demandToDistributionRate: rate(distributedDemandIds.size, demands.length),
    funnel: [
      { key: 'views', label: 'Vues de fiches', value: ficheViews },
      { key: 'clicks', label: 'Clics WhatsApp', value: waClicks },
      { key: 'conversations', label: 'Conversations', value: conversations.length },
      { key: 'consent', label: 'Consentements', value: consentAccepted },
      { key: 'demands', label: 'Demandes qualifiées', value: demands.length },
      { key: 'distributed', label: 'Demandes transmises', value: distributedDemandIds.size },
      { key: 'accepted', label: 'Prises en charge', value: acceptedDemandIds.size },
    ],
    byCity: countBy(demands, (d) => d.city, (k) => k),
    byCategory: countBy(demands, (d) => d.category, categoryLabel),
    topRequested,
    daily,
    subscriptions: {
      byStatus,
      byPlan,
      freeOpportunitiesSent: freeSent.length,
      convertedAfterFree: converted,
      freeConversionRate: rate(converted, freeCompanies.size),
      deliveredToSubscribers: delivered.filter((d) => d.mode === 'SUBSCRIPTION').length,
      deliveredAsFree: delivered.filter((d) => d.mode === 'FREE_OPPORTUNITY').length,
    },
  };
}
