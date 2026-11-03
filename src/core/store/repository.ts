import type {
  ActivityEntry,
  Category,
  Company,
  Contact,
  Conversation,
  Database,
  Demand,
  Distribution,
  Message,
  Plan,
  Settings,
  TrackingEvent,
} from '../types';

/**
 * Persistence port. Services only talk to this interface.
 *
 * Today: `MemoryRepository` (optionally persisted to localStorage).
 * Later: a Supabase/PostgreSQL implementation — every method maps to a single
 * table query, and `claimInboundEvent` / `insertDemand` map to unique
 * constraints (inbound external_id, demands.conversation_id).
 */
export interface Repository {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  listCategories(): Promise<Category[]>;
  listPlans(): Promise<Plan[]>;
  savePlan(plan: Plan): Promise<Plan>;

  listCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | null>;
  getCompanyBySlug(slug: string): Promise<Company | null>;
  getCompanyByFiche(ficheId: string): Promise<Company | null>;
  saveCompany(company: Company): Promise<Company>;

  getContact(id: string): Promise<Contact | null>;
  getContactByWa(waNumber: string): Promise<Contact | null>;
  listContacts(): Promise<Contact[]>;
  saveContact(contact: Contact): Promise<Contact>;

  getConversation(id: string): Promise<Conversation | null>;
  listConversations(): Promise<Conversation[]>;
  saveConversation(conversation: Conversation): Promise<Conversation>;

  listMessages(conversationId: string): Promise<Message[]>;
  listAllMessages(): Promise<Message[]>;
  getMessage(id: string): Promise<Message | null>;
  saveMessage(message: Message): Promise<Message>;

  /**
   * Atomically records an inbound provider event. Returns false when the
   * event was already processed (duplicate webhook delivery, double click…).
   */
  claimInboundEvent(externalId: string, conversationId: string | null, at: string): Promise<boolean>;

  getDemand(id: string): Promise<Demand | null>;
  getDemandByConversation(conversationId: string): Promise<Demand | null>;
  listDemands(): Promise<Demand[]>;
  /** Assigns the next sequential number. Rejects a second demand for the same conversation. */
  insertDemand(demand: Omit<Demand, 'number'>): Promise<Demand>;
  saveDemand(demand: Demand): Promise<Demand>;

  listDistributions(filter?: { demandId?: string; companyId?: string }): Promise<Distribution[]>;
  saveDistribution(distribution: Distribution): Promise<Distribution>;

  addTracking(event: TrackingEvent): Promise<void>;
  listTracking(): Promise<TrackingEvent[]>;

  addActivity(entry: ActivityEntry): Promise<void>;
  listActivity(filter?: { demandId?: string; companyId?: string; conversationId?: string }): Promise<ActivityEntry[]>;

  /** Replace everything (used by the demo reset). */
  replaceAll(db: Database): Promise<void>;
  snapshot(): Promise<Database>;
}

export class DuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateError';
  }
}
