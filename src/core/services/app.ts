import type {
  ActivityEntry,
  Company,
  Contact,
  Conversation,
  Demand,
  DemandStatus,
  Distribution,
  DistributionOutcome,
  Message,
  MessageButton,
  Plan,
  Settings,
  SubscriptionStatus,
} from '../types';
import type { Repository } from '../store/repository';
import { DuplicateError } from '../store/repository';
import type { MessagingTransport } from '../transport/transport';
import type { Interpreter, InterpretContext } from '../ai/interpreter';
import type { Clock } from '../clock';
import { MINUTE } from '../clock';
import type { IdGenerator } from '../ids';
import { step, promptFor, TERMINAL_STATES, type EngineContext, type EngineInput, type Reply } from '../conversation/engine';
import { ENTRY_TEMPLATE, ENTRY_TEMPLATE_RE, CALLBACK_LABELS } from '../conversation/copy';
import { matchDemand, type MatchResult } from '../matching/matching';
import { computeMetrics } from '../analytics/metrics';
import { canTransition, DEMAND_STATUS, INTENT_LABEL } from '../status';
import { formatPhone, normalizePhone } from '../phone';
import { normalize } from '../text';
import { findCity } from '../catalog';

/**
 * Application service — the only entry point used by the UI (and, later, by a
 * webhook handler). It orchestrates the pure modules (engine, matching,
 * analytics) with the ports (repository, transport, interpreter).
 */

export interface InboundEvent {
  /** Provider message id. Re-delivering the same id is a no-op. */
  externalId: string;
  from: string;
  profileName?: string;
  text?: string;
  button?: { id: string; replyTo?: string };
  /** Deterministic attribution metadata (simulates Meta's `referral` / our click token). */
  referral?: { ficheId: string; clickId?: string };
}

export interface InboundResult {
  duplicate: boolean;
  accepted: boolean;
  conversationId: string | null;
  note?: string;
  demandId?: string;
}

export interface Deps {
  repo: Repository;
  transport: MessagingTransport;
  companyTransport?: MessagingTransport;
  interpreter: Interpreter;
  clock: Clock;
  ids: IdGenerator;
}

export class AppService {
  private locks = new Map<string, Promise<unknown>>();

  constructor(private deps: Deps) {}

  get repo() {
    return this.deps.repo;
  }

  private now() {
    return this.deps.clock.now().toISOString();
  }

  /** Serialise work per key (one customer = one queue), like a per-sender webhook queue. */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private async log(entry: Omit<ActivityEntry, 'id' | 'at'> & { at?: string }) {
    await this.deps.repo.addActivity({ id: this.deps.ids.next('act'), at: entry.at ?? this.now(), ...entry });
  }

  // ═════════════════════════════ Directory & tracking ═════════════════════════════

  async recordFicheView(companyId: string, visitorId: string) {
    const company = await this.requireCompany(companyId);
    await this.deps.repo.addTracking({ id: this.deps.ids.next('trk'), type: 'FICHE_VIEW', companyId, ficheId: company.ficheId, visitorId, at: this.now() });
  }

  /** The visitor clicked the WhatsApp button on a fiche. Returns the wa.me pre-filled message. */
  async clickWhatsApp(companyId: string, visitorId: string) {
    const company = await this.requireCompany(companyId);
    const settings = await this.deps.repo.getSettings();
    const clickId = this.deps.ids.next('clk');
    await this.deps.repo.addTracking({ id: clickId, type: 'WA_CLICK', companyId, ficheId: company.ficheId, visitorId, at: this.now() });
    const text = ENTRY_TEMPLATE(company.name, company.city);
    return {
      clickId,
      text,
      ficheId: company.ficheId,
      waLink: `https://wa.me/${settings.centralNumber.replace('+', '')}?text=${encodeURIComponent(text)}`,
    };
  }

  /** Latest open conversation of a customer with a company, if any (used to resume). */
  async findOpenConversation(waNumber: string, companyId: string): Promise<Conversation | null> {
    const contact = await this.deps.repo.getContactByWa(waNumber);
    if (!contact) return null;
    const all = await this.deps.repo.listConversations();
    return (
      all
        .filter((c) => c.contactId === contact.id && c.companyId === companyId && !TERMINAL_STATES.includes(c.state))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    );
  }

  // ═════════════════════════════ Inbound messages (webhook equivalent) ═════════════════════════════

  async receiveInbound(event: InboundEvent): Promise<InboundResult> {
    const from = normalizePhone(event.from);
    if (!from.ok) throw new Error('Numéro expéditeur invalide');
    return this.withLock(from.e164!, () => this.processInbound({ ...event, from: from.e164! }));
  }

  private async processInbound(event: InboundEvent): Promise<InboundResult> {
    const { repo } = this.deps;
    const now = this.now();

    // 1. Idempotency — the same provider event is processed at most once.
    const fresh = await repo.claimInboundEvent(event.externalId, null, now);
    if (!fresh) {
      await this.log({ entity: 'system', entityId: event.externalId, action: 'duplicate_event', label: 'Événement entrant en double ignoré', actor: 'système' });
      return { duplicate: true, accepted: false, conversationId: null, note: 'duplicate' };
    }

    // 2. Contact.
    const contact = await this.upsertContact(event.from, event.profileName);

    // 3. Conversation: resolve deterministically.
    const { conversation, created } = await this.resolveConversation(contact, event);

    // 4. Store inbound message.
    const inbound: Message = {
      id: this.deps.ids.next('msg'),
      conversationId: conversation.id,
      direction: 'IN',
      externalId: event.externalId,
      kind: 'text',
      body: event.text ?? '',
      deliveryStatus: 'READ',
      state: conversation.state,
      createdAt: now,
    };
    if (event.button) {
      const prompt = event.button.replyTo ? await repo.getMessage(event.button.replyTo) : null;
      inbound.body = prompt?.buttons?.find((b) => b.id === event.button!.id)?.label ?? event.button.id;
      inbound.payload = event.button.id;
      inbound.replyTo = event.button.replyTo;
    }
    await repo.saveMessage(inbound);

    // 5. Decide engine input. Re-opening from a fiche on an existing conversation = resume.
    let input: EngineInput;
    if (event.button) input = { kind: 'button', buttonId: event.button.id, replyTo: event.button.replyTo };
    else {
      const text = event.text ?? '';
      const isEntry = ENTRY_TEMPLATE_RE.test(normalize(text));
      if (!created && isEntry) input = { kind: 'resume' };
      else input = { kind: 'text', text, interpretation: await this.interpret(text, conversation) };
    }

    return this.applyStep(conversation, input, inbound);
  }

  private async interpret(text: string, conv: Conversation) {
    const expecting: InterpretContext['expecting'] =
      conv.state === 'NEW' || conv.state === 'AWAIT_INTENT'
        ? 'intent'
        : conv.state.startsWith('PRICE')
          ? 'product'
          : conv.state === 'INFO_QUESTION'
            ? 'question'
            : conv.state === 'CALLBACK_REASON'
              ? 'reason'
              : 'free';
    try {
      return await this.deps.interpreter.interpret(text, { expecting });
    } catch (err) {
      // The flow is deterministic: an interpreter failure only loses the suggestions.
      console.warn('[interpreter] failed, continuing without suggestions', err);
      return undefined;
    }
  }

  private async engineContext(conv: Conversation): Promise<EngineContext> {
    const company = conv.companyId ? await this.deps.repo.getCompany(conv.companyId) : null;
    const settings = await this.deps.repo.getSettings();
    return { companyName: company?.name ?? null, ficheCity: company?.city ?? conv.city, waNumber: conv.waNumber, privacyUrl: settings.privacyUrl, now: this.now() };
  }

  private async applyStep(conversation: Conversation, input: EngineInput, inbound: Message | null): Promise<InboundResult> {
    const { repo } = this.deps;
    const ctx = await this.engineContext(conversation);
    const res = step(conversation, input, ctx);
    let conv = res.conversation;

    if (!res.accepted) {
      // Stale button / terminal: keep the state, record why.
      await repo.saveConversation({ ...conversation, lastInboundAt: ctx.now, updatedAt: ctx.now });
      await this.log({
        entity: 'conversation',
        entityId: conversation.id,
        conversationId: conversation.id,
        companyId: conversation.companyId ?? undefined,
        action: res.note ?? 'ignored',
        label: res.note === 'stale_button' ? 'Clic sur un bouton périmé ignoré' : 'Message ignoré',
        actor: 'système',
      });
      return { duplicate: false, accepted: false, conversationId: conversation.id, note: res.note };
    }

    if (inbound && res.note === 'invalid_input') {
      await this.log({ entity: 'conversation', entityId: conv.id, conversationId: conv.id, action: 'invalid_input', label: `Réponse invalide à l’étape « ${conversation.state} »`, actor: 'système' });
    }

    // Effects that must happen before replies are rendered.
    let demand: Demand | null = null;
    let restartId: string | null = null;
    for (const effect of res.effects) {
      if (effect.type === 'CONSENT') {
        await this.log({
          entity: 'conversation',
          entityId: conv.id,
          conversationId: conv.id,
          companyId: conv.companyId ?? undefined,
          action: effect.value ? 'consent_accepted' : 'consent_refused',
          label: effect.value ? 'Consentement accepté' : 'Consentement refusé — collecte arrêtée',
          actor: 'client',
        });
      } else if (effect.type === 'CONTACT') {
        const contact = await repo.getContact(conv.contactId);
        if (contact) {
          await repo.saveContact({ ...contact, name: effect.name ?? contact.name, phone: effect.phone ?? contact.phone, updatedAt: ctx.now });
        }
      } else if (effect.type === 'CREATE_DEMAND') {
        demand = await this.createDemandFromConversation(conv);
        conv = { ...conv, demandId: demand.id };
      }
    }

    await repo.saveConversation(conv);

    if (res.note === 'resumed') {
      await this.log({ entity: 'conversation', entityId: conv.id, conversationId: conv.id, companyId: conv.companyId ?? undefined, action: 'resumed', label: 'Conversation reprise par le client', actor: 'client' });
    }

    const existingDemand = demand ?? (conv.demandId ? await repo.getDemand(conv.demandId) : null);
    await this.sendReplies(conv, res.replies, existingDemand?.number);

    for (const effect of res.effects) {
      if (effect.type === 'RESTART') restartId = await this.restartConversation(conv);
    }

    // Distribution runs after the confirmation has been sent to the customer.
    if (demand) await this.autoDistribute(demand.id);

    return {
      duplicate: false,
      accepted: true,
      conversationId: restartId ?? conv.id,
      note: res.note,
      demandId: demand?.id,
    };
  }

  private async sendReplies(conv: Conversation, replies: Reply[], demandNumber?: number) {
    if (replies.length === 0) return;
    let activePromptId: string | null = null;
    for (const reply of replies) {
      const body = reply.body.replace(/\{\{demandNumber\}\}/g, demandNumber ? String(demandNumber) : '—');
      const msg = await this.sendToCustomer(conv, body, reply.buttons);
      activePromptId = reply.buttons?.length ? msg.id : null;
    }
    const latest = (await this.deps.repo.getConversation(conv.id)) ?? conv;
    await this.deps.repo.saveConversation({ ...latest, activePromptId });
  }

  private async sendToCustomer(conv: Conversation, body: string, buttons?: MessageButton[]): Promise<Message> {
    const result = await this.deps.transport.send({ to: conv.waNumber, body, buttons, channel: 'customer' });
    const msg: Message = {
      id: this.deps.ids.next('msg'),
      conversationId: conv.id,
      direction: 'OUT',
      externalId: result.externalId,
      kind: buttons?.length ? 'buttons' : 'text',
      body,
      buttons,
      deliveryStatus: result.status,
      error: result.error,
      state: conv.state,
      createdAt: this.now(),
    };
    await this.deps.repo.saveMessage(msg);
    if (result.status === 'FAILED') {
      await this.log({ entity: 'conversation', entityId: conv.id, conversationId: conv.id, action: 'delivery_failed', label: `Échec d’envoi au client : ${result.error}`, actor: 'système' });
    }
    return msg;
  }

  /** Retry a failed outbound message (customer conversation). */
  async resendMessage(messageId: string) {
    const msg = await this.deps.repo.getMessage(messageId);
    if (!msg || msg.direction !== 'OUT' || msg.deliveryStatus !== 'FAILED') throw new Error('Ce message ne peut pas être renvoyé');
    const conv = await this.requireConversation(msg.conversationId);
    const result = await this.deps.transport.send({ to: conv.waNumber, body: msg.body, buttons: msg.buttons, channel: 'customer' });
    const updated: Message = { ...msg, externalId: result.externalId, deliveryStatus: result.status, error: result.error };
    await this.deps.repo.saveMessage(updated);
    await this.log({ entity: 'conversation', entityId: conv.id, conversationId: conv.id, action: 'message_resent', label: result.status === 'FAILED' ? 'Nouvel échec de renvoi' : 'Message renvoyé avec succès', actor: 'système' });
    return updated;
  }

  private async upsertContact(waNumber: string, profileName?: string): Promise<Contact> {
    const { repo } = this.deps;
    const existing = await repo.getContactByWa(waNumber);
    if (existing) {
      if (profileName && profileName !== existing.profileName) return repo.saveContact({ ...existing, profileName, updatedAt: this.now() });
      return existing;
    }
    return repo.saveContact({
      id: this.deps.ids.next('ctc'),
      waNumber,
      profileName: profileName ?? '',
      name: null,
      phone: null,
      createdAt: this.now(),
      updatedAt: this.now(),
    });
  }

  /**
   * Requested-company attribution, in order of reliability:
   *   1. referral metadata (fiche id / click id) — deterministic;
   *   2. exact parse of the pre-filled template (company name + city);
   *   3. otherwise the conversation stays "unresolved" for the admin to assign.
   * AI is never used to decide which company the visitor asked for.
   */
  private async resolveConversation(contact: Contact, event: InboundEvent): Promise<{ conversation: Conversation; created: boolean }> {
    const { repo } = this.deps;
    let company: Company | null = null;
    let resolution: Conversation['resolution'] = 'unresolved';

    if (event.referral?.ficheId) {
      company = await repo.getCompanyByFiche(event.referral.ficheId);
      if (company) resolution = 'referral';
    }
    if (!company && event.text) {
      const m = ENTRY_TEMPLATE_RE.exec(normalize(event.text));
      if (m) {
        const [, name, city] = m;
        const companies = await repo.listCompanies();
        company = companies.find((c) => normalize(c.name) === name.trim() && normalize(c.city) === city.trim()) ?? null;
        if (company) resolution = 'template';
      }
    }

    const mine = (await repo.listConversations())
      .filter((c) => c.contactId === contact.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const all = mine.filter((c) => !TERMINAL_STATES.includes(c.state));

    // A button reply belongs to the conversation of the message that carried it.
    if (event.button?.replyTo) {
      const msg = await repo.getMessage(event.button.replyTo);
      const owner = msg && mine.find((c) => c.id === msg.conversationId);
      if (owner) return { conversation: owner, created: false };
    }

    if (company) {
      const open = all.find((c) => c.companyId === company!.id);
      if (open) return { conversation: open, created: false };
      // A new fiche click while another company's conversation is open: the old one is left as abandoned.
      for (const other of all.filter((c) => c.status === 'ACTIVE')) {
        await repo.saveConversation({ ...other, status: 'ABANDONED', updatedAt: this.now() });
      }
    } else if (all[0]) {
      return { conversation: all[0], created: false };
    } else if (mine[0] && !ENTRY_TEMPLATE_RE.test(normalize(event.text ?? ""))) {
      // Writing again after a finished conversation: the engine answers from the terminal state.
      return { conversation: mine[0], created: false };
    }

    const conversation = await this.createConversation(contact, company, resolution, event.referral?.clickId ?? null);
    return { conversation, created: true };
  }

  private async createConversation(contact: Contact, company: Company | null, resolution: Conversation['resolution'], clickId: string | null) {
    const now = this.now();
    const conversation: Conversation = {
      id: this.deps.ids.next('cnv'),
      contactId: contact.id,
      waNumber: contact.waNumber,
      companyId: company?.id ?? null,
      ficheId: company?.ficheId ?? null,
      city: company?.city ?? null,
      source: company ? 'telecontact_fiche' : 'direct',
      clickId,
      resolution,
      state: 'NEW',
      status: 'ACTIVE',
      intent: null,
      consent: null,
      consentAt: null,
      lang: null,
      data: {},
      retries: 0,
      activePromptId: null,
      demandId: null,
      lastInboundAt: now,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    await this.deps.repo.saveConversation(conversation);
    await this.log({
      entity: 'conversation',
      entityId: conversation.id,
      conversationId: conversation.id,
      companyId: company?.id,
      action: 'conversation_started',
      label: company
        ? `Conversation ouverte depuis la fiche ${company.name} (${resolution === 'referral' ? 'référence de clic' : 'message pré-rempli'})`
        : 'Conversation ouverte — entreprise non identifiée',
      actor: 'client',
    });
    return conversation;
  }

  /** "Nouvelle demande" / "Recommencer": a fresh conversation for the same customer and company. */
  private async restartConversation(previous: Conversation): Promise<string> {
    const contact = await this.deps.repo.getContact(previous.contactId);
    const company = previous.companyId ? await this.deps.repo.getCompany(previous.companyId) : null;
    if (!contact) throw new Error('Contact introuvable');
    const conv = await this.createConversation(contact, company, previous.resolution, null);
    const ctx = await this.engineContext(conv);
    const next: Conversation = { ...conv, state: 'AWAIT_INTENT', lang: previous.lang };
    await this.deps.repo.saveConversation(next);
    await this.sendReplies(next, promptFor(next, ctx));
    return conv.id;
  }

  /** Marks idle open conversations as abandoned. Safe to call repeatedly. */
  async sweepAbandoned(): Promise<number> {
    const settings = await this.deps.repo.getSettings();
    const limit = this.deps.clock.now().getTime() - settings.abandonAfterMinutes * MINUTE;
    let count = 0;
    for (const c of await this.deps.repo.listConversations()) {
      if (c.status === 'ACTIVE' && c.lastInboundAt && Date.parse(c.lastInboundAt) < limit) {
        await this.deps.repo.saveConversation({ ...c, status: 'ABANDONED' });
        count++;
      }
    }
    return count;
  }

  /**
   * Demo tool: pretend the customer has been silent for `minutes`, then run
   * the abandonment sweep. Never used by production code paths.
   */
  async simulateInactivity(conversationId: string, minutes: number) {
    const conv = await this.requireConversation(conversationId);
    const past = new Date(this.deps.clock.now().getTime() - minutes * MINUTE).toISOString();
    await this.deps.repo.saveConversation({ ...conv, lastInboundAt: past });
    await this.sweepAbandoned();
    await this.log({ entity: 'conversation', entityId: conv.id, conversationId: conv.id, action: 'simulated_inactivity', label: `Inactivité simulée (${minutes} min)`, actor: 'démo' });
    return this.requireConversation(conversationId);
  }

  // ═════════════════════════════ Demands ═════════════════════════════

  private async createDemandFromConversation(conv: Conversation): Promise<Demand> {
    const { repo } = this.deps;
    const existing = await repo.getDemandByConversation(conv.id);
    if (existing) return existing;
    const contact = await repo.getContact(conv.contactId);
    const d = conv.data;
    const now = this.now();
    try {
      const demand = await repo.insertDemand({
        id: this.deps.ids.next('dem'),
        conversationId: conv.id,
        contactId: conv.contactId,
        requestedCompanyId: conv.companyId,
        intent: conv.intent!,
        category: d.category ?? null,
        customerName: d.name ?? contact?.name ?? '',
        customerPhone: d.phone ?? conv.waNumber,
        product: d.product ?? null,
        specification: d.specification ?? null,
        quantity: d.quantity ?? null,
        city: d.location ?? conv.city,
        details: d.details || null,
        question: d.question ?? null,
        reason: d.reason ?? null,
        callbackTime: d.callbackTime ?? null,
        consent: true,
        source: 'Telecontact',
        status: 'NEW',
        statusNote: null,
        createdAt: now,
        updatedAt: now,
      });
      await this.log({
        entity: 'demand',
        entityId: demand.id,
        demandId: demand.id,
        conversationId: conv.id,
        companyId: conv.companyId ?? undefined,
        action: 'demand_created',
        label: `Demande n°${demand.number} créée (${INTENT_LABEL[demand.intent].label})`,
        actor: 'système',
      });
      return demand;
    } catch (err) {
      if (err instanceof DuplicateError) return (await repo.getDemandByConversation(conv.id))!;
      throw err;
    }
  }

  async getMatches(demandId: string): Promise<MatchResult> {
    const { repo } = this.deps;
    const [demand, companies, plans, distributions, settings] = await Promise.all([
      this.requireDemand(demandId),
      repo.listCompanies(),
      repo.listPlans(),
      repo.listDistributions(),
      repo.getSettings(),
    ]);
    return matchDemand({ demand, companies, plans, distributions, settings, now: this.deps.clock.now() });
  }

  /** Automatic routing right after qualification. */
  async autoDistribute(demandId: string) {
    const settings = await this.deps.repo.getSettings();
    const match = await this.getMatches(demandId);
    const { recommendation } = match;
    const autoTargets = match.candidates.filter((c) => recommendation.companyIds.includes(c.companyId) && c.autoDistribution);

    if (settings.autoDistribution && autoTargets.length > 0) {
      await this.distribute(demandId, autoTargets.map((c) => c.companyId), 'système', 'auto');
      return;
    }
    if (recommendation.action === 'MANUAL_REVIEW') {
      await this.setDemandStatus(demandId, 'IN_REVIEW', recommendation.summary, 'système');
    } else {
      await this.log({ entity: 'demand', entityId: demandId, demandId, action: 'awaiting_admin', label: `En attente de validation : ${recommendation.summary}`, actor: 'système' });
    }
  }

  async updateDemand(demandId: string, patch: Partial<Pick<Demand, 'customerName' | 'customerPhone' | 'product' | 'specification' | 'quantity' | 'city' | 'details' | 'question' | 'reason' | 'category' | 'callbackTime' | 'requestedCompanyId'>>, actor = 'admin') {
    const demand = await this.requireDemand(demandId);
    const clean = { ...patch };
    if (clean.customerName !== undefined && clean.customerName.trim().length < 2) throw new Error('Le nom du client est obligatoire');
    if (clean.customerPhone !== undefined) {
      const p = normalizePhone(clean.customerPhone);
      if (!p.ok) throw new Error('Numéro de téléphone invalide');
      clean.customerPhone = p.e164!;
    }
    if (clean.quantity !== undefined && clean.quantity !== null && (!Number.isInteger(clean.quantity) || clean.quantity < 1)) {
      throw new Error('La quantité doit être un entier positif');
    }
    if (clean.city) clean.city = findCity(clean.city) ?? clean.city.trim();
    if (clean.requestedCompanyId) await this.requireCompany(clean.requestedCompanyId);
    const changed = (Object.keys(clean) as (keyof typeof clean)[]).filter((k) => clean[k] !== demand[k]);
    if (changed.length === 0) return demand;
    const saved = await this.deps.repo.saveDemand({ ...demand, ...clean, updatedAt: this.now() });
    await this.log({ entity: 'demand', entityId: demandId, demandId, action: 'demand_edited', label: `Champs modifiés : ${changed.join(', ')}`, actor });
    return saved;
  }

  async setDemandStatus(demandId: string, status: DemandStatus, note: string | null, actor = 'admin') {
    const demand = await this.requireDemand(demandId);
    if (demand.status === status) return demand;
    if (!canTransition(demand.status, status)) {
      throw new Error(`Transition impossible : ${DEMAND_STATUS[demand.status].label} → ${DEMAND_STATUS[status].label}`);
    }
    const saved = await this.deps.repo.saveDemand({ ...demand, status, statusNote: note, updatedAt: this.now() });
    await this.log({
      entity: 'demand',
      entityId: demandId,
      demandId,
      action: 'status_changed',
      label: `Statut : ${DEMAND_STATUS[demand.status].label} → ${DEMAND_STATUS[status].label}${note ? ` — ${note}` : ''}`,
      actor,
    });
    return saved;
  }

  // ═════════════════════════════ Distribution ═════════════════════════════

  buildNotification(demand: Demand): string {
    const need = [demand.product, demand.specification].filter(Boolean).join(' ') || demand.question || demand.reason || '—';
    const lines = [
      'Nouvelle demande Telecontact',
      '',
      `Client : ${demand.customerName}`,
      `Téléphone : ${formatPhone(demand.customerPhone)}`,
      `Ville : ${demand.city ?? '—'}`,
      `Besoin : ${need}`,
    ];
    if (demand.quantity) lines.push(`Quantité : ${demand.quantity}`);
    if (demand.intent === 'INFO' && demand.question && need !== demand.question) lines.push(`Question : ${demand.question}`);
    if (demand.intent === 'CALLBACK') {
      if (demand.reason && need !== demand.reason) lines.push(`Motif : ${demand.reason}`);
      if (demand.callbackTime) lines.push(`Rappel souhaité : ${CALLBACK_LABELS[demand.callbackTime]}`);
    }
    if (demand.details) lines.push(`Précisions : ${demand.details}`);
    lines.push(`Type : ${INTENT_LABEL[demand.intent].label}`, '', `Réf. demande n°${demand.number}`);
    return lines.join('\n');
  }

  /**
   * Send a demand to companies. Eligibility is re-checked server-side: the UI
   * cannot push a demand to an ineligible company or send it twice.
   */
  async distribute(demandId: string, companyIds: string[], actor = 'admin', action: Distribution['adminAction'] = 'manual_send') {
    const { repo } = this.deps;
    return this.withLock(`demand:${demandId}`, async () => {
      const demand = await this.requireDemand(demandId);
      if (['CLOSED', 'REJECTED'].includes(demand.status)) throw new Error('Demande clôturée ou rejetée : distribution impossible');
      const settings = await repo.getSettings();
      const match = await this.getMatches(demandId);
      const already = (await repo.listDistributions({ demandId })).filter((d) => d.deliveryStatus !== 'FAILED');
      const unique = [...new Set(companyIds)];
      if (unique.length === 0) throw new Error('Sélectionnez au moins une entreprise');
      if (already.length + unique.length > settings.maxCompaniesPerDemand) {
        throw new Error(`Limite de ${settings.maxCompaniesPerDemand} entreprises par demande`);
      }

      const results: Distribution[] = [];
      for (const companyId of unique) {
        const candidate = match.candidates.find((c) => c.companyId === companyId);
        if (!candidate) throw new Error('Entreprise non pertinente pour cette demande');
        if (!candidate.eligible) throw new Error(`${candidate.companyName} n’est pas éligible : ${candidate.reasons.find((r) => r.kind === 'block')?.label}`);
        if (candidate.alreadySent) throw new Error(`Déjà transmise à ${candidate.companyName}`);
        const company = await this.requireCompany(companyId);
        const body = this.buildNotification(demand);
        const transport = this.deps.companyTransport ?? this.deps.transport;
        const sent = await transport.send({ to: company.whatsappNumber, body, channel: 'company' });
        const now = this.now();
        const dist: Distribution = {
          id: this.deps.ids.next('dst'),
          demandId,
          companyId,
          destinationNumber: company.whatsappNumber,
          mode: candidate.mode ?? 'MANUAL',
          adminAction: action,
          actor,
          messageBody: body,
          externalId: sent.externalId,
          deliveryStatus: sent.status,
          error: sent.error ?? null,
          outcome: 'SENT',
          matchScore: candidate.score,
          sentAt: now,
          updatedAt: now,
        };
        await repo.saveDistribution(dist);
        results.push(dist);
        if (sent.status !== 'FAILED' && dist.mode === 'FREE_OPPORTUNITY') {
          await repo.saveCompany({ ...company, freeOpportunityUsedAt: now, updatedAt: now });
        }
        await this.log({
          entity: 'demand',
          entityId: demandId,
          demandId,
          companyId,
          action: sent.status === 'FAILED' ? 'distribution_failed' : 'distributed',
          label:
            sent.status === 'FAILED'
              ? `Échec d’envoi à ${company.name} (${formatPhone(company.whatsappNumber)}) : ${sent.error}`
              : `Transmise à ${company.name} via WhatsApp ${formatPhone(company.whatsappNumber)}${dist.mode === 'FREE_OPPORTUNITY' ? ' — opportunité gratuite' : ''}${action === 'auto' ? ' (automatique)' : ''}`,
          actor,
        });
      }
      if (results.some((r) => r.deliveryStatus !== 'FAILED') && ['NEW', 'IN_REVIEW'].includes(demand.status)) {
        await this.setDemandStatus(demandId, 'DISTRIBUTED', null, actor);
      }
      return results;
    });
  }

  async resendDistribution(distributionId: string, actor = 'admin') {
    const { repo } = this.deps;
    const dist = (await repo.listDistributions()).find((d) => d.id === distributionId);
    if (!dist || dist.deliveryStatus !== 'FAILED') throw new Error('Seul un envoi en échec peut être relancé');
    const company = await this.requireCompany(dist.companyId);
    const transport = this.deps.companyTransport ?? this.deps.transport;
    const sent = await transport.send({ to: company.whatsappNumber, body: dist.messageBody, channel: 'company' });
    const now = this.now();
    const updated: Distribution = {
      ...dist,
      destinationNumber: company.whatsappNumber,
      externalId: sent.externalId,
      deliveryStatus: sent.status,
      error: sent.error ?? null,
      adminAction: 'resend',
      actor,
      sentAt: now,
      updatedAt: now,
    };
    await repo.saveDistribution(updated);
    if (sent.status !== 'FAILED' && dist.mode === 'FREE_OPPORTUNITY' && !company.freeOpportunityUsedAt) {
      await repo.saveCompany({ ...company, freeOpportunityUsedAt: now, updatedAt: now });
    }
    await this.log({
      entity: 'demand',
      entityId: dist.demandId,
      demandId: dist.demandId,
      companyId: dist.companyId,
      action: sent.status === 'FAILED' ? 'distribution_failed' : 'distribution_resent',
      label: sent.status === 'FAILED' ? `Nouvel échec d’envoi à ${company.name}` : `Renvoyée avec succès à ${company.name}`,
      actor,
    });
    const demand = await this.requireDemand(dist.demandId);
    if (sent.status !== 'FAILED' && ['NEW', 'IN_REVIEW'].includes(demand.status)) await this.setDemandStatus(demand.id, 'DISTRIBUTED', null, actor);
    return updated;
  }

  /** Commercial follow-up reported by the company from its workspace. */
  async setDistributionOutcome(distributionId: string, outcome: DistributionOutcome, companyId: string) {
    const { repo } = this.deps;
    const dist = (await repo.listDistributions({ companyId })).find((d) => d.id === distributionId);
    if (!dist) throw new Error('Demande introuvable pour cette entreprise');
    if (dist.deliveryStatus === 'FAILED') throw new Error('Cette demande n’a pas été délivrée');
    if (dist.outcome === outcome) return dist;
    const updated = await repo.saveDistribution({ ...dist, outcome, updatedAt: this.now() });
    const company = await this.requireCompany(companyId);
    const labels: Record<DistributionOutcome, string> = {
      SENT: 'remise à non lue',
      VIEWED: 'consultée',
      CONTACTED: 'client contacté',
      WON: 'affaire conclue',
      LOST: 'sans suite',
      DECLINED: 'déclinée',
    };
    await this.log({ entity: 'demand', entityId: dist.demandId, demandId: dist.demandId, companyId, action: 'outcome', label: `${company.name} : ${labels[outcome]}`, actor: company.name });
    if (outcome === 'CONTACTED' || outcome === 'WON') {
      const demand = await this.requireDemand(dist.demandId);
      if (demand.status === 'DISTRIBUTED') await this.setDemandStatus(demand.id, 'ACCEPTED', `Prise en charge par ${company.name}`, company.name);
    }
    return updated;
  }

  // ═════════════════════════════ Companies & subscriptions ═════════════════════════════

  validateCompany(input: Partial<Company>): string[] {
    const errors: string[] = [];
    if (!input.name || input.name.trim().length < 2) errors.push('Nom obligatoire');
    if (!input.city) errors.push('Ville obligatoire');
    if (!input.sector) errors.push('Secteur obligatoire');
    if (!input.whatsappNumber || !normalizePhone(input.whatsappNumber).ok) errors.push('Numéro WhatsApp de réception invalide');
    if (input.acceptedIntents && input.acceptedIntents.length === 0) errors.push('Au moins un type de demande accepté');
    return errors;
  }

  async saveCompany(input: Company, actor = 'admin') {
    const errors = this.validateCompany(input);
    if (errors.length) throw new Error(errors.join(' · '));
    const existing = await this.deps.repo.getCompany(input.id);
    const now = this.now();
    const company: Company = {
      ...input,
      name: input.name.trim(),
      whatsappNumber: normalizePhone(input.whatsappNumber).e164!,
      slug: input.slug || slugify(input.name),
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    };
    const saved = await this.deps.repo.saveCompany(company);
    await this.log({ entity: 'company', entityId: company.id, companyId: company.id, action: existing ? 'company_updated' : 'company_created', label: existing ? 'Fiche entreprise modifiée' : 'Entreprise créée', actor });
    return saved;
  }

  newCompanyDraft(): Company {
    const id = this.deps.ids.next('cmp');
    const now = this.now();
    return {
      id,
      ficheId: `F${Math.floor(10000 + Math.random() * 89999)}`,
      slug: '',
      name: '',
      city: 'Casablanca',
      address: '',
      sector: 'electronique',
      activity: '',
      description: '',
      products: [],
      phone: '',
      email: '',
      website: '',
      whatsappNumber: '',
      coveredCities: [],
      acceptedCategories: [],
      acceptedIntents: ['PRICE', 'INFO', 'CALLBACK'],
      subscription: { status: 'NONE', planId: null, startedAt: null, requestedAt: null, requestedPlanId: null },
      freeOpportunityUsedAt: null,
      notes: [],
      rating: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async addCompanyNote(companyId: string, body: string, author = 'admin') {
    if (!body.trim()) throw new Error('Note vide');
    const company = await this.requireCompany(companyId);
    const note = { id: this.deps.ids.next('note'), body: body.trim(), author, at: this.now() };
    return this.deps.repo.saveCompany({ ...company, notes: [note, ...company.notes], updatedAt: this.now() });
  }

  async setSubscription(companyId: string, status: SubscriptionStatus, planId: string | null, actor = 'admin') {
    const company = await this.requireCompany(companyId);
    if ((status === 'ACTIVE' || status === 'TRIAL') && !planId) throw new Error('Choisissez un plan');
    if (planId) {
      const plan = (await this.deps.repo.listPlans()).find((p) => p.id === planId);
      if (!plan) throw new Error('Plan inconnu');
    }
    const wasSubscribed = ['ACTIVE', 'TRIAL'].includes(company.subscription.status);
    const isSubscribed = ['ACTIVE', 'TRIAL'].includes(status);
    const now = this.now();
    const saved = await this.deps.repo.saveCompany({
      ...company,
      subscription: {
        status,
        planId: status === 'NONE' ? null : planId,
        startedAt: isSubscribed ? (wasSubscribed ? company.subscription.startedAt : now) : company.subscription.startedAt,
        requestedAt: isSubscribed ? null : company.subscription.requestedAt,
        requestedPlanId: isSubscribed ? null : company.subscription.requestedPlanId,
      },
      updatedAt: now,
    });
    const plans = await this.deps.repo.listPlans();
    await this.log({
      entity: 'company',
      entityId: companyId,
      companyId,
      action: 'subscription_changed',
      label: `Abonnement : ${status}${planId ? ` — ${plans.find((p) => p.id === planId)?.name}` : ''} (simulation)`,
      actor,
    });
    return saved;
  }

  async requestSubscription(companyId: string, planId: string) {
    const company = await this.requireCompany(companyId);
    const saved = await this.deps.repo.saveCompany({ ...company, subscription: { ...company.subscription, requestedAt: this.now(), requestedPlanId: planId }, updatedAt: this.now() });
    await this.log({ entity: 'company', entityId: companyId, companyId, action: 'subscription_requested', label: 'Demande d’abonnement depuis l’espace entreprise', actor: company.name });
    return saved;
  }

  async updateCompanyPreferences(companyId: string, patch: Pick<Company, 'whatsappNumber' | 'coveredCities' | 'acceptedCategories' | 'acceptedIntents'>) {
    const company = await this.requireCompany(companyId);
    return this.saveCompany({ ...company, ...patch }, company.name);
  }

  async savePlan(plan: Plan) {
    if (!plan.name.trim()) throw new Error('Nom du plan obligatoire');
    if (plan.monthlyQuota !== null && (!Number.isInteger(plan.monthlyQuota) || plan.monthlyQuota < 1)) throw new Error('Quota invalide');
    const saved = await this.deps.repo.savePlan(plan);
    await this.log({ entity: 'system', entityId: plan.id, action: 'plan_saved', label: `Plan « ${plan.name} » enregistré`, actor: 'admin' });
    return saved;
  }

  async updateSettings(patch: Partial<Settings>) {
    if (patch.maxCompaniesPerDemand !== undefined && (patch.maxCompaniesPerDemand < 1 || patch.maxCompaniesPerDemand > 10)) throw new Error('Entre 1 et 10 entreprises');
    if (patch.simulatedFailureRate !== undefined && (patch.simulatedFailureRate < 0 || patch.simulatedFailureRate > 1)) throw new Error('Taux entre 0 et 100 %');
    return this.deps.repo.updateSettings(patch);
  }

  async metrics(days = 30) {
    const db = await this.deps.repo.snapshot();
    return computeMetrics(db, this.deps.clock.now(), days);
  }

  // ═════════════════════════════ Helpers ═════════════════════════════

  private async requireCompany(id: string) {
    const c = await this.deps.repo.getCompany(id);
    if (!c) throw new Error('Entreprise introuvable');
    return c;
  }
  private async requireDemand(id: string) {
    const d = await this.deps.repo.getDemand(id);
    if (!d) throw new Error('Demande introuvable');
    return d;
  }
  private async requireConversation(id: string) {
    const c = await this.deps.repo.getConversation(id);
    if (!c) throw new Error('Conversation introuvable');
    return c;
  }
}

export function slugify(s: string) {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
