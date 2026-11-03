import type {
  ConversationStatus,
  DeliveryStatus,
  DemandStatus,
  DistributionMode,
  DistributionOutcome,
  Intent,
  SubscriptionStatus,
} from './types';

/** Single source of truth for status labels and allowed transitions. */

export type Tone = 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger';

export const DEMAND_STATUS: Record<DemandStatus, { label: string; tone: Tone; hint: string }> = {
  NEW: { label: 'Nouvelle', tone: 'info', hint: 'Qualifiée, en attente de distribution' },
  IN_REVIEW: { label: 'À revoir', tone: 'warning', hint: 'Mise en attente pour revue manuelle' },
  DISTRIBUTED: { label: 'Transmise', tone: 'accent', hint: 'Envoyée à au moins une entreprise' },
  ACCEPTED: { label: 'Prise en charge', tone: 'success', hint: 'Une entreprise a contacté le client' },
  CLOSED: { label: 'Clôturée', tone: 'neutral', hint: 'Traitement terminé' },
  REJECTED: { label: 'Rejetée', tone: 'danger', hint: 'Non exploitable (spam, doublon, hors périmètre…)' },
};

export const DEMAND_TRANSITIONS: Record<DemandStatus, DemandStatus[]> = {
  NEW: ['IN_REVIEW', 'DISTRIBUTED', 'REJECTED', 'CLOSED'],
  IN_REVIEW: ['NEW', 'DISTRIBUTED', 'REJECTED', 'CLOSED'],
  DISTRIBUTED: ['ACCEPTED', 'CLOSED', 'IN_REVIEW'],
  ACCEPTED: ['CLOSED'],
  CLOSED: ['NEW'],
  REJECTED: ['NEW'],
};

export function canTransition(from: DemandStatus, to: DemandStatus) {
  return DEMAND_TRANSITIONS[from].includes(to);
}

export const CONVERSATION_STATUS: Record<ConversationStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'En cours', tone: 'info' },
  COMPLETED: { label: 'Qualifiée', tone: 'success' },
  REFUSED: { label: 'Refus consentement', tone: 'danger' },
  ABANDONED: { label: 'Abandonnée', tone: 'warning' },
};

export const INTENT_LABEL: Record<Intent, { label: string; short: string }> = {
  PRICE: { label: 'Demande de prix', short: 'Prix' },
  INFO: { label: 'Demande d’information', short: 'Infos' },
  CALLBACK: { label: 'Demande de rappel', short: 'Rappel' },
};

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  NONE: { label: 'Non abonnée', tone: 'neutral' },
  TRIAL: { label: 'Essai', tone: 'info' },
  ACTIVE: { label: 'Abonnée', tone: 'success' },
  PAUSED: { label: 'En pause', tone: 'warning' },
  CANCELLED: { label: 'Résiliée', tone: 'danger' },
};

export const DELIVERY_STATUS: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'En attente', tone: 'neutral' },
  SENT: { label: 'Envoyé', tone: 'info' },
  DELIVERED: { label: 'Délivré', tone: 'success' },
  READ: { label: 'Lu', tone: 'success' },
  FAILED: { label: 'Échec', tone: 'danger' },
};

export const DISTRIBUTION_MODE: Record<DistributionMode, { label: string; tone: Tone }> = {
  FREE_OPPORTUNITY: { label: 'Opportunité gratuite', tone: 'warning' },
  SUBSCRIPTION: { label: 'Abonnement', tone: 'accent' },
  MANUAL: { label: 'Manuel', tone: 'neutral' },
};

export const OUTCOME: Record<DistributionOutcome, { label: string; tone: Tone }> = {
  SENT: { label: 'Non lue', tone: 'neutral' },
  VIEWED: { label: 'Consultée', tone: 'info' },
  CONTACTED: { label: 'Client contacté', tone: 'accent' },
  WON: { label: 'Affaire conclue', tone: 'success' },
  LOST: { label: 'Sans suite', tone: 'neutral' },
  DECLINED: { label: 'Déclinée', tone: 'danger' },
};
