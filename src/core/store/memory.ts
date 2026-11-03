import type { Database, Demand } from '../types';
import { DuplicateError, type Repository } from './repository';

/** Where a MemoryRepository writes its snapshot (localStorage in the browser, nothing in tests). */
export interface PersistenceDriver {
  load(): Database | null;
  save(db: Database): void;
}

export const noPersistence: PersistenceDriver = { load: () => null, save: () => {} };

export function localStorageDriver(key: string): PersistenceDriver {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        return raw ? (JSON.parse(raw) as Database) : null;
      } catch {
        return null;
      }
    },
    save(db) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(db));
      } catch (err) {
        console.error('[store] could not persist demo data', err);
      }
    },
  };
}

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory implementation of the repository. Every write is persisted
 * synchronously through the driver, so data survives page refreshes.
 * Returned objects are copies: callers cannot mutate stored state by accident.
 */
export class MemoryRepository implements Repository {
  private db: Database;
  private listeners = new Set<() => void>();

  constructor(
    initial: Database,
    private driver: PersistenceDriver = noPersistence,
  ) {
    this.db = clone(initial);
  }

  /** Subscribe to any change (used by the UI to refresh live views). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Reload from the driver (another tab wrote). */
  reloadFromDriver() {
    const loaded = this.driver.load();
    if (loaded) {
      this.db = loaded;
      this.emit();
    }
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private pending = false;

  /** Writes are coalesced: a burst of updates triggers one save and one UI refresh. */
  private commit() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.driver.save(this.db);
      this.emit();
    });
  }

  /** Force pending writes to the driver (used before unload and in tests). */
  flush() {
    this.driver.save(this.db);
  }

  private upsert<T extends { id: string }>(table: T[], row: T): T {
    const i = table.findIndex((r) => r.id === row.id);
    const copy = clone(row);
    if (i >= 0) table[i] = copy;
    else table.push(copy);
    this.commit();
    return clone(copy);
  }

  async getSettings() {
    return clone(this.db.settings);
  }
  async updateSettings(patch: Partial<Database['settings']>) {
    this.db.settings = { ...this.db.settings, ...patch };
    this.commit();
    return clone(this.db.settings);
  }

  async listCategories() {
    return clone(this.db.categories);
  }
  async listPlans() {
    return clone(this.db.plans);
  }
  async savePlan(plan: Database['plans'][number]) {
    return this.upsert(this.db.plans, plan);
  }

  async listCompanies() {
    return clone(this.db.companies);
  }
  async getCompany(id: string) {
    const c = this.db.companies.find((x) => x.id === id);
    return c ? clone(c) : null;
  }
  async getCompanyBySlug(slug: string) {
    const c = this.db.companies.find((x) => x.slug === slug);
    return c ? clone(c) : null;
  }
  async getCompanyByFiche(ficheId: string) {
    const c = this.db.companies.find((x) => x.ficheId === ficheId);
    return c ? clone(c) : null;
  }
  async saveCompany(company: Database['companies'][number]) {
    return this.upsert(this.db.companies, company);
  }

  async getContact(id: string) {
    const c = this.db.contacts.find((x) => x.id === id);
    return c ? clone(c) : null;
  }
  async getContactByWa(waNumber: string) {
    const c = this.db.contacts.find((x) => x.waNumber === waNumber);
    return c ? clone(c) : null;
  }
  async listContacts() {
    return clone(this.db.contacts);
  }
  async saveContact(contact: Database['contacts'][number]) {
    return this.upsert(this.db.contacts, contact);
  }

  async getConversation(id: string) {
    const c = this.db.conversations.find((x) => x.id === id);
    return c ? clone(c) : null;
  }
  async listConversations() {
    return clone(this.db.conversations);
  }
  async saveConversation(conversation: Database['conversations'][number]) {
    return this.upsert(this.db.conversations, conversation);
  }

  async listMessages(conversationId: string) {
    return clone(this.db.messages.filter((m) => m.conversationId === conversationId));
  }
  async getMessage(id: string) {
    const m = this.db.messages.find((x) => x.id === id);
    return m ? clone(m) : null;
  }
  async listAllMessages() {
    return clone(this.db.messages);
  }
  async saveMessage(message: Database['messages'][number]) {
    return this.upsert(this.db.messages, message);
  }

  async claimInboundEvent(externalId: string, conversationId: string | null, at: string) {
    if (this.db.inboundLedger.some((e) => e.externalId === externalId)) return false;
    this.db.inboundLedger.push({ externalId, conversationId, receivedAt: at });
    this.commit();
    return true;
  }

  async getDemand(id: string) {
    const d = this.db.demands.find((x) => x.id === id);
    return d ? clone(d) : null;
  }
  async getDemandByConversation(conversationId: string) {
    const d = this.db.demands.find((x) => x.conversationId === conversationId);
    return d ? clone(d) : null;
  }
  async listDemands() {
    return clone(this.db.demands);
  }
  async insertDemand(demand: Omit<Demand, 'number'>) {
    if (this.db.demands.some((d) => d.conversationId === demand.conversationId)) {
      throw new DuplicateError(`A demand already exists for conversation ${demand.conversationId}`);
    }
    this.db.counters.demandNumber += 1;
    const row: Demand = { ...demand, number: this.db.counters.demandNumber };
    return this.upsert(this.db.demands, row);
  }
  async saveDemand(demand: Demand) {
    return this.upsert(this.db.demands, demand);
  }

  async listDistributions(filter: { demandId?: string; companyId?: string } = {}) {
    return clone(
      this.db.distributions.filter(
        (d) => (!filter.demandId || d.demandId === filter.demandId) && (!filter.companyId || d.companyId === filter.companyId),
      ),
    );
  }
  async saveDistribution(distribution: Database['distributions'][number]) {
    return this.upsert(this.db.distributions, distribution);
  }

  async addTracking(event: Database['tracking'][number]) {
    this.db.tracking.push(clone(event));
    this.commit();
  }
  async listTracking() {
    return clone(this.db.tracking);
  }

  async addActivity(entry: Database['activity'][number]) {
    this.db.activity.push(clone(entry));
    this.commit();
  }
  async listActivity(filter: { demandId?: string; companyId?: string; conversationId?: string } = {}) {
    return clone(
      this.db.activity.filter(
        (a) =>
          (!filter.demandId || a.demandId === filter.demandId) &&
          (!filter.companyId || a.companyId === filter.companyId) &&
          (!filter.conversationId || a.conversationId === filter.conversationId),
      ),
    );
  }

  async replaceAll(db: Database) {
    this.db = clone(db);
    this.commit();
  }
  async snapshot() {
    return clone(this.db);
  }
}
