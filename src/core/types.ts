/**
 * Domain model for the Telecontact demand-generation platform.
 *
 * Every entity is a plain serialisable object so that the persistence layer
 * (localStorage today, Supabase/PostgreSQL later) can store it as a row.
 * Relationships are expressed with ids only.
 */

export type ISODate = string;
export type Lang = 'fr' | 'ar';

// ───────────────────────────── Reference data ─────────────────────────────

export interface Category {
  id: string;
  label: string;
  /** Lower-case keywords used by the interpreter and the matching engine. */
  keywords: string[];
}

export interface Plan {
  id: string;
  name: string;
  /** Free text, configurable. Prices are not hard-coded business rules. */
  priceLabel: string;
  /** Max demands delivered per calendar month, null = unlimited. */
  monthlyQuota: number | null;
  /** Max number of covered cities, null = unlimited. */
  maxCities: number | null;
  /** Subscribed companies on this plan receive matching demands automatically. */
  autoDistribution: boolean;
  description: string;
  active: boolean;
}

export const SUBSCRIPTION_STATUSES = ['NONE', 'TRIAL', 'ACTIVE', 'PAUSED', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  status: SubscriptionStatus;
  planId: string | null;
  startedAt: ISODate | null;
  /** Set when the company asked (from its workspace) to subscribe. */
  requestedAt: ISODate | null;
  requestedPlanId: string | null;
}

export interface CompanyNote {
  id: string;
  body: string;
  author: string;
  at: ISODate;
}

export interface Company {
  id: string;
  /** Telecontact fiche id — the deterministic link between the directory and the conversation. */
  ficheId: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  /** Category id (sector). */
  sector: string;
  activity: string;
  description: string;
  products: string[];
  phone: string;
  email: string;
  website: string;
  /** Number where this company receives Telecontact demands (simulated delivery). */
  whatsappNumber: string;
  coveredCities: string[];
  acceptedCategories: string[];
  acceptedIntents: Intent[];
  subscription: Subscription;
  /** A non-subscribed company gets one free opportunity to experience the service. */
  freeOpportunityUsedAt: ISODate | null;
  notes: CompanyNote[];
  rating: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ───────────────────────────── Customers & conversations ─────────────────────────────

export interface Contact {
  id: string;
  /** WhatsApp id of the sender (E.164 digits with +). */
  waNumber: string;
  /** Profile name pushed by WhatsApp (may be empty). */
  profileName: string;
  name: string | null;
  /** Phone confirmed for the call back (may differ from waNumber). */
  phone: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export const INTENTS = ['PRICE', 'INFO', 'CALLBACK'] as const;
export type Intent = (typeof INTENTS)[number];

export const CALLBACK_TIMES = ['ASAP', 'TODAY', 'TOMORROW'] as const;
export type CallbackTime = (typeof CALLBACK_TIMES)[number];

/** Explicit conversation states. See docs/ARCHITECTURE.md for the diagram. */
export const CONVERSATION_STATES = [
  'NEW',
  'AWAIT_INTENT',
  'AWAIT_CONSENT',
  'AWAIT_NAME',
  'AWAIT_PHONE_CONFIRM',
  'AWAIT_PHONE_INPUT',
  'PRICE_PRODUCT',
  'PRICE_QUANTITY',
  'PRICE_LOCATION',
  'PRICE_DETAILS',
  'INFO_QUESTION',
  'CALLBACK_REASON',
  'CALLBACK_TIME',
  'COMPLETED',
  'REFUSED',
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export type ConversationStatus = 'ACTIVE' | 'COMPLETED' | 'REFUSED' | 'ABANDONED';

/** Information progressively collected during qualification. */
export interface CollectedData {
  name?: string;
  phone?: string;
  product?: string;
  category?: string;
  specification?: string;
  quantity?: number;
  location?: string;
  details?: string;
  question?: string;
  reason?: string;
  callbackTime?: CallbackTime;
}

export interface Conversation {
  id: string;
  contactId: string;
  waNumber: string;
  /** Requested company, resolved deterministically when the conversation opens. */
  companyId: string | null;
  ficheId: string | null;
  city: string | null;
  source: 'telecontact_fiche' | 'direct';
  clickId: string | null;
  /** How the requested company was identified. */
  resolution: 'referral' | 'template' | 'unresolved';
  state: ConversationState;
  status: ConversationStatus;
  intent: Intent | null;
  consent: boolean | null;
  consentAt: ISODate | null;
  /** null until the customer writes free text (prompts are then bilingual). */
  lang: Lang | null;
  data: CollectedData;
  /** Consecutive invalid answers in the current state. */
  retries: number;
  /** Outbound message id holding the interactive buttons that are currently valid. */
  activePromptId: string | null;
  demandId: string | null;
  lastInboundAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  closedAt: ISODate | null;
}

export type Direction = 'IN' | 'OUT';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface MessageButton {
  id: string;
  label: string;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: Direction;
  /** Provider message id (wamid…) — used for idempotency. */
  externalId: string;
  kind: 'text' | 'buttons' | 'notice';
  body: string;
  buttons?: MessageButton[];
  /** For inbound button replies: the id of the chosen button. */
  payload?: string;
  /** For inbound button replies: the outbound message the button belonged to. */
  replyTo?: string;
  deliveryStatus: DeliveryStatus;
  error?: string;
  /** Conversation state when the message was produced (useful for audits). */
  state: ConversationState;
  createdAt: ISODate;
}

// ───────────────────────────── Demands & distribution ─────────────────────────────

export const DEMAND_STATUSES = ['NEW', 'IN_REVIEW', 'DISTRIBUTED', 'ACCEPTED', 'CLOSED', 'REJECTED'] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export interface Demand {
  id: string;
  /** Human-friendly sequential number (DEMANDE #184). */
  number: number;
  conversationId: string;
  contactId: string;
  requestedCompanyId: string | null;
  intent: Intent;
  category: string | null;
  customerName: string;
  customerPhone: string;
  product: string | null;
  specification: string | null;
  quantity: number | null;
  city: string | null;
  details: string | null;
  question: string | null;
  reason: string | null;
  callbackTime: CallbackTime | null;
  consent: true;
  source: 'Telecontact';
  status: DemandStatus;
  /** Why a demand is held for manual review, or why it was rejected/closed. */
  statusNote: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type DistributionMode = 'FREE_OPPORTUNITY' | 'SUBSCRIPTION' | 'MANUAL';
export type DistributionOutcome = 'SENT' | 'VIEWED' | 'CONTACTED' | 'WON' | 'LOST' | 'DECLINED';

export interface Distribution {
  id: string;
  demandId: string;
  companyId: string;
  destinationNumber: string;
  mode: DistributionMode;
  /** 'auto' for automatic subscription delivery, otherwise the admin action. */
  adminAction: 'auto' | 'manual_send' | 'resend';
  actor: string;
  messageBody: string;
  externalId: string;
  deliveryStatus: DeliveryStatus;
  error: string | null;
  /** Commercial follow-up, updated from the company workspace. */
  outcome: DistributionOutcome;
  matchScore: number;
  sentAt: ISODate;
  updatedAt: ISODate;
}

// ───────────────────────────── Tracking, audit, settings ─────────────────────────────

export interface TrackingEvent {
  id: string;
  type: 'FICHE_VIEW' | 'WA_CLICK';
  companyId: string;
  ficheId: string;
  visitorId: string;
  at: ISODate;
}

export interface ActivityEntry {
  id: string;
  /** Subject entity for timeline grouping. */
  entity: 'demand' | 'company' | 'conversation' | 'system';
  entityId: string;
  /** Optional cross links to make timelines navigable. */
  demandId?: string;
  companyId?: string;
  conversationId?: string;
  action: string;
  label: string;
  actor: string;
  at: ISODate;
}

export interface InboundLedgerEntry {
  externalId: string;
  conversationId: string | null;
  receivedAt: ISODate;
}

export interface Settings {
  /** Deliver automatically to subscribed companies whose plan allows it. */
  autoDistribution: boolean;
  /** Max companies a single demand may be sent to. */
  maxCompaniesPerDemand: number;
  /** Probability (0..1) that a simulated WhatsApp delivery fails. */
  simulatedFailureRate: number;
  /** Simulated latency of the data layer (ms) — makes loading states visible. */
  simulatedLatencyMs: number;
  /** Inactivity after which an open conversation counts as abandoned. */
  abandonAfterMinutes: number;
  /** Central Telecontact WhatsApp number (simulated). */
  centralNumber: string;
  privacyUrl: string;
}

export interface Database {
  version: number;
  seededAt: ISODate;
  counters: { demandNumber: number };
  settings: Settings;
  categories: Category[];
  plans: Plan[];
  companies: Company[];
  contacts: Contact[];
  conversations: Conversation[];
  messages: Message[];
  demands: Demand[];
  distributions: Distribution[];
  tracking: TrackingEvent[];
  activity: ActivityEntry[];
  inboundLedger: InboundLedgerEntry[];
}
