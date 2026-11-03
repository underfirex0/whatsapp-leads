import type { Company, Demand, Distribution, DistributionMode, Plan, Settings } from '../types';
import { PRODUCTS } from '../catalog';
import { normalize, tokens } from '../text';

/**
 * Rules-based, explainable matching engine.
 *
 * Every point added or removed is attached to a human-readable reason, so the
 * administrator understands why a company is (or is not) recommended.
 * Pure function: no storage, no UI.
 */

export type MatchDemand = Pick<
  Demand,
  'id' | 'requestedCompanyId' | 'intent' | 'category' | 'product' | 'specification' | 'city' | 'question' | 'reason' | 'details'
>;

export interface MatchReason {
  kind: 'plus' | 'minus' | 'block' | 'info';
  label: string;
  points?: number;
}

export interface MatchCandidate {
  companyId: string;
  companyName: string;
  city: string;
  score: number;
  eligible: boolean;
  isRequested: boolean;
  alreadySent: boolean;
  mode: DistributionMode | null;
  /** Auto-delivery allowed by the company's plan. */
  autoDistribution: boolean;
  reasons: MatchReason[];
}

export interface MatchRecommendation {
  action: 'SEND_REQUESTED' | 'SEND_ALTERNATIVES' | 'MANUAL_REVIEW' | 'NONE';
  companyIds: string[];
  summary: string;
}

export interface MatchResult {
  demandCategory: string | null;
  demandCity: string | null;
  candidates: MatchCandidate[];
  recommendation: MatchRecommendation;
}

export interface MatchInput {
  demand: MatchDemand;
  companies: Company[];
  plans: Plan[];
  distributions: Distribution[];
  settings: Pick<Settings, 'maxCompaniesPerDemand'>;
  now: Date;
}

const W = {
  requested: 40,
  category: 30,
  product: 25,
  sameCity: 15,
  coveredCity: 10,
  subscribed: 20,
  trial: 15,
};

/** Category inferred from the product label when the conversation did not set one. */
export function inferCategory(demand: MatchDemand): string | null {
  if (demand.category) return demand.category;
  const text = normalize([demand.product, demand.specification, demand.question, demand.reason, demand.details].filter(Boolean).join(' '));
  if (!text) return null;
  return PRODUCTS.find((p) => p.patterns.some((re) => re.test(text)))?.category ?? null;
}

function productOverlap(demand: MatchDemand, company: Company): string | null {
  const wanted = new Set(tokens([demand.product, demand.specification].filter(Boolean).join(' ')).filter((t) => t.length > 3));
  if (wanted.size === 0) return null;
  for (const p of company.products) {
    const pt = tokens(p);
    // Compare stems so "climatiseurs" matches "climatiseur".
    if (pt.some((t) => [...wanted].some((w) => t.slice(0, 6) === w.slice(0, 6)))) return p;
  }
  return null;
}

function monthlyCount(companyId: string, distributions: Distribution[], now: Date): number {
  const y = now.getFullYear();
  const m = now.getMonth();
  return distributions.filter((d) => {
    if (d.companyId !== companyId || d.deliveryStatus === 'FAILED') return false;
    const t = new Date(d.sentAt);
    return t.getFullYear() === y && t.getMonth() === m;
  }).length;
}

export function matchDemand(input: MatchInput): MatchResult {
  const { demand, companies, plans, distributions, settings, now } = input;
  const category = inferCategory(demand);
  const requested = companies.find((c) => c.id === demand.requestedCompanyId) ?? null;
  const city = demand.city ?? requested?.city ?? null;
  const sentTo = new Set(distributions.filter((d) => d.demandId === demand.id && d.deliveryStatus !== 'FAILED').map((d) => d.companyId));

  const candidates: MatchCandidate[] = [];

  for (const company of companies) {
    const isRequested = company.id === demand.requestedCompanyId;
    const reasons: MatchReason[] = [];
    let score = 0;
    let blocked = false;
    const block = (label: string) => {
      blocked = true;
      reasons.push({ kind: 'block', label });
    };

    if (isRequested) {
      score += W.requested;
      reasons.push({ kind: 'plus', label: 'Entreprise demandée par le client', points: W.requested });
    }

    // ── Relevance: category & product ──
    const categoryMatch = category !== null && (company.acceptedCategories.includes(category) || company.sector === category);
    const productHit = productOverlap(demand, company);
    if (categoryMatch) {
      score += W.category;
      reasons.push({ kind: 'plus', label: 'Catégorie acceptée', points: W.category });
    }
    if (productHit) {
      score += W.product;
      reasons.push({ kind: 'plus', label: `Propose « ${productHit} »`, points: W.product });
    }
    const relevant = categoryMatch || Boolean(productHit);
    if (!relevant) {
      if (!isRequested) continue; // Irrelevant alternatives are not listed at all.
      if (category) block('Activité déclarée ne correspond pas au besoin');
      else reasons.push({ kind: 'info', label: 'Besoin non catégorisé — choix explicite du client' });
    }

    // ── Geography ──
    if (city) {
      if (normalize(company.city) === normalize(city)) {
        score += W.sameCity;
        reasons.push({ kind: 'plus', label: `Basée à ${city}`, points: W.sameCity });
      } else if (company.coveredCities.some((c) => normalize(c) === normalize(city))) {
        score += W.coveredCity;
        reasons.push({ kind: 'plus', label: `Couvre ${city}`, points: W.coveredCity });
      } else if (isRequested) {
        reasons.push({ kind: 'minus', label: `Ne déclare pas couvrir ${city}` });
      } else {
        block(`Ne couvre pas ${city}`);
      }
    }

    // ── Preferences ──
    if (!company.acceptedIntents.includes(demand.intent)) {
      block(`N’accepte pas les demandes « ${INTENT_SHORT[demand.intent]} »`);
    }

    // ── Subscription & eligibility ──
    const plan = plans.find((p) => p.id === company.subscription.planId) ?? null;
    let mode: DistributionMode | null = null;
    let auto = false;
    const sub = company.subscription.status;
    if (sub === 'ACTIVE' || sub === 'TRIAL') {
      mode = 'SUBSCRIPTION';
      auto = Boolean(plan?.autoDistribution);
      const pts = sub === 'ACTIVE' ? W.subscribed : W.trial;
      score += pts;
      reasons.push({ kind: 'plus', label: sub === 'ACTIVE' ? `Abonnée — ${plan?.name ?? 'plan'}` : `En essai — ${plan?.name ?? 'plan'}`, points: pts });
      const quota = plan?.monthlyQuota ?? null;
      if (quota !== null) {
        const used = monthlyCount(company.id, distributions, now);
        if (used >= quota) block(`Quota mensuel atteint (${used}/${quota})`);
        else reasons.push({ kind: 'info', label: `Quota : ${used}/${quota} ce mois-ci` });
      }
    } else if (sub === 'PAUSED') {
      block('Abonnement en pause');
    } else if (company.freeOpportunityUsedAt) {
      block('Opportunité gratuite déjà utilisée — abonnement requis');
    } else {
      mode = 'FREE_OPPORTUNITY';
      reasons.push({ kind: 'info', label: 'Non abonnée — opportunité gratuite disponible' });
    }

    if (company.rating) {
      const pts = Math.round(company.rating);
      score += pts;
      reasons.push({ kind: 'plus', label: `Note clients ${company.rating.toFixed(1)}`, points: pts });
    }

    const alreadySent = sentTo.has(company.id);
    if (alreadySent) reasons.push({ kind: 'info', label: 'Demande déjà transmise' });

    candidates.push({
      companyId: company.id,
      companyName: company.name,
      city: company.city,
      score: Math.min(100, score),
      eligible: !blocked,
      isRequested,
      alreadySent,
      mode: blocked ? null : mode,
      autoDistribution: !blocked && auto,
      reasons,
    });
  }

  candidates.sort((a, b) => {
    if (a.isRequested !== b.isRequested) return a.isRequested ? -1 : 1;
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // Subscribers before free opportunities at equal relevance.
    if (a.mode !== b.mode) return a.mode === 'SUBSCRIPTION' ? -1 : b.mode === 'SUBSCRIPTION' ? 1 : 0;
    return b.score - a.score;
  });

  return { demandCategory: category, demandCity: city, candidates, recommendation: recommend(candidates, settings.maxCompaniesPerDemand) };
}

function recommend(candidates: MatchCandidate[], max: number): MatchRecommendation {
  const requested = candidates.find((c) => c.isRequested);
  if (requested?.eligible && !requested.alreadySent) {
    return {
      action: 'SEND_REQUESTED',
      companyIds: [requested.companyId],
      summary:
        requested.mode === 'FREE_OPPORTUNITY'
          ? `${requested.companyName} est éligible : transmettre comme opportunité gratuite.`
          : `${requested.companyName} est abonnée et éligible.`,
    };
  }
  const alternatives = candidates.filter((c) => !c.isRequested && c.eligible && !c.alreadySent).slice(0, max);
  if (requested?.alreadySent && alternatives.length === 0) {
    return { action: 'NONE', companyIds: [], summary: 'Déjà transmise à l’entreprise demandée.' };
  }
  if (alternatives.length > 0) {
    const why = requested ? `${requested.companyName} n’est pas éligible` : 'Entreprise demandée inconnue';
    return {
      action: 'SEND_ALTERNATIVES',
      companyIds: alternatives.map((c) => c.companyId),
      summary: `${why} : ${alternatives.length} professionnel${alternatives.length > 1 ? 's' : ''} pertinent${alternatives.length > 1 ? 's' : ''} proposé${alternatives.length > 1 ? 's' : ''}.`,
    };
  }
  return { action: 'MANUAL_REVIEW', companyIds: [], summary: 'Aucune entreprise éligible — revue manuelle nécessaire.' };
}

export const INTENT_SHORT: Record<Demand['intent'], string> = {
  PRICE: 'Demande de prix',
  INFO: 'Demande d’information',
  CALLBACK: 'Demande de rappel',
};
