import { describe, expect, it } from 'vitest';
import { setup, NOW } from './helpers';
import { runScript, type CustomerScript } from '../src/core/simulation/customer';
import { RuleBasedInterpreter, validateInterpretation } from '../src/core/ai/interpreter';
import { normalizePhone, formatPhone } from '../src/core/phone';
import { generateSeed } from '../src/core/seed/generate';

const climPrice: Omit<CustomerScript, 'name'> = { intent: 'PRICE', consent: true, product: 'Climatiseur 18000 BTU', quantity: 2, city: 'fiche' };

async function demandFor(ctx: ReturnType<typeof setup>, companyName: string, script = climPrice, num = '+212661234567') {
  const c = ctx.customer(num);
  await c.openFromFiche((await ctx.company(companyName)).id);
  const conv = await runScript(c, { name: 'Ahmed El Amrani', ...script });
  return (await ctx.repo.getDemandByConversation(conv.id))!;
}

describe('Matching & distribution', () => {
  it('G — requested company is recommended first when eligible (free opportunity)', async () => {
    const ctx = setup();
    const demand = await demandFor(ctx, 'SpaceFix');
    const match = await ctx.app.getMatches(demand.id);
    expect(match.candidates[0].companyName).toBe('SpaceFix');
    expect(match.candidates[0].eligible).toBe(true);
    expect(match.candidates[0].mode).toBe('FREE_OPPORTUNITY');
    expect(match.recommendation.action).toBe('SEND_REQUESTED');
    expect(match.recommendation.companyIds).toEqual([demand.requestedCompanyId]);
    // Not subscribed → never auto-sent: waits for the admin.
    expect((await ctx.repo.getDemand(demand.id))!.status).toBe('NEW');
    expect(await ctx.repo.listDistributions({ demandId: demand.id })).toHaveLength(0);
  });

  it('G′ — subscribed requested company receives the demand automatically', async () => {
    const ctx = setup();
    const demand = await demandFor(ctx, 'Casa Clim');
    const dists = await ctx.repo.listDistributions({ demandId: demand.id });
    expect(dists).toHaveLength(1);
    expect(dists[0]).toMatchObject({ companyId: demand.requestedCompanyId, mode: 'SUBSCRIPTION', adminAction: 'auto', deliveryStatus: 'DELIVERED' });
    expect((await ctx.repo.getDemand(demand.id))!.status).toBe('DISTRIBUTED');
  });

  it('H — ineligible requested company leads to explained alternatives', async () => {
    const ctx = setup((db) => {
      const sf = db.companies.find((c) => c.name === 'SpaceFix')!;
      sf.freeOpportunityUsedAt = NOW.toISOString();
    });
    const settingsOff = await ctx.app.updateSettings({ autoDistribution: false });
    expect(settingsOff.autoDistribution).toBe(false);
    const demand = await demandFor(ctx, 'SpaceFix');
    const match = await ctx.app.getMatches(demand.id);
    const sf = match.candidates[0];
    expect(sf.companyName).toBe('SpaceFix');
    expect(sf.eligible).toBe(false);
    expect(sf.reasons.find((r) => r.kind === 'block')?.label).toMatch(/abonnement requis/);
    expect(match.recommendation.action).toBe('SEND_ALTERNATIVES');
    const names = match.candidates.filter((c) => match.recommendation.companyIds.includes(c.companyId)).map((c) => c.companyName);
    expect(names).toContain('Casa Clim');
    expect(names).toContain('ElectroPro');
    // Out-of-area / irrelevant companies are not recommended.
    expect(names).not.toContain('Atlas Solar');
    expect(names).not.toContain('Marrakech Clim Confort');
    const marrakech = match.candidates.find((c) => c.companyName === 'Marrakech Clim Confort');
    expect(marrakech?.eligible).toBe(false);
    expect(marrakech?.reasons.some((r) => r.label.includes('Ne couvre pas Casablanca'))).toBe(true);
  });

  it('H′ — with auto-distribution on, subscribed alternatives receive it automatically', async () => {
    const ctx = setup((db) => {
      db.companies.find((c) => c.name === 'SpaceFix')!.freeOpportunityUsedAt = NOW.toISOString();
    });
    const demand = await demandFor(ctx, 'SpaceFix');
    const dists = await ctx.repo.listDistributions({ demandId: demand.id });
    expect(dists.length).toBeGreaterThan(0);
    expect(dists.every((d) => d.mode === 'SUBSCRIPTION')).toBe(true);
    expect(dists.some((d) => d.companyId === demand.requestedCompanyId)).toBe(false);
  });

  it('subscription status changes eligibility', async () => {
    const ctx = setup();
    const ep = await ctx.company('ElectroPro');
    await ctx.app.setSubscription(ep.id, 'PAUSED', ep.subscription.planId);
    await ctx.app.updateSettings({ autoDistribution: false });
    const demand = await demandFor(ctx, 'ElectroPro');
    let match = await ctx.app.getMatches(demand.id);
    expect(match.candidates[0].eligible).toBe(false);
    expect(match.candidates[0].reasons.some((r) => r.label === 'Abonnement en pause')).toBe(true);
    await ctx.app.setSubscription(ep.id, 'ACTIVE', 'plan_pro');
    match = await ctx.app.getMatches(demand.id);
    expect(match.candidates[0].eligible).toBe(true);
    expect(match.candidates[0].mode).toBe('SUBSCRIPTION');
  });

  it('I — admin distribution reaches the company workspace and consumes the free opportunity', async () => {
    const ctx = setup();
    const demand = await demandFor(ctx, 'SpaceFix');
    const [dist] = await ctx.app.distribute(demand.id, [demand.requestedCompanyId!]);
    expect(dist).toMatchObject({ demandId: demand.id, destinationNumber: (await ctx.company('SpaceFix')).whatsappNumber, deliveryStatus: 'DELIVERED', mode: 'FREE_OPPORTUNITY', adminAction: 'manual_send' });
    expect(dist.messageBody).toContain('Nouvelle demande Telecontact');
    expect(dist.messageBody).toContain('Client : Ahmed El Amrani');
    expect(dist.messageBody).toContain('Besoin : Climatiseur 18000 BTU');
    expect(dist.messageBody).toContain('Quantité : 2');
    expect(dist.messageBody).toContain('Type : Demande de prix');
    // Company workspace = distributions filtered by company.
    const inbox = await ctx.repo.listDistributions({ companyId: demand.requestedCompanyId! });
    expect(inbox.map((d) => d.demandId)).toContain(demand.id);
    expect((await ctx.company('SpaceFix')).freeOpportunityUsedAt).not.toBeNull();
    expect((await ctx.repo.getDemand(demand.id))!.status).toBe('DISTRIBUTED');
    // Cannot be sent twice to the same company.
    await expect(ctx.app.distribute(demand.id, [demand.requestedCompanyId!])).rejects.toThrow(/Déjà transmise|éligible/);
    // Company reports it contacted the customer → demand accepted.
    await ctx.app.setDistributionOutcome(dist.id, 'CONTACTED', demand.requestedCompanyId!);
    expect((await ctx.repo.getDemand(demand.id))!.status).toBe('ACCEPTED');
    // A second demand for SpaceFix no longer qualifies for a free opportunity.
    const second = await demandFor(ctx, 'SpaceFix', climPrice, '+212662000000');
    const m2 = await ctx.app.getMatches(second.id);
    expect(m2.candidates[0].eligible).toBe(false);
  });

  it('refuses to distribute to an ineligible company', async () => {
    const ctx = setup();
    await ctx.app.updateSettings({ autoDistribution: false });
    const demand = await demandFor(ctx, 'SpaceFix');
    const marrakech = await ctx.company('Marrakech Clim Confort');
    await expect(ctx.app.distribute(demand.id, [marrakech.id])).rejects.toThrow(/pas éligible/);
  });

  it('failed company delivery can be resent', async () => {
    const ctx = setup();
    await ctx.app.updateSettings({ autoDistribution: false });
    const demand = await demandFor(ctx, 'SpaceFix');
    ctx.companyTransport.forceFailures(1);
    const [dist] = await ctx.app.distribute(demand.id, [demand.requestedCompanyId!]);
    expect(dist.deliveryStatus).toBe('FAILED');
    expect((await ctx.company('SpaceFix')).freeOpportunityUsedAt).toBeNull();
    expect((await ctx.repo.getDemand(demand.id))!.status).toBe('NEW');
    const resent = await ctx.app.resendDistribution(dist.id);
    expect(resent.deliveryStatus).toBe('DELIVERED');
    expect((await ctx.repo.getDemand(demand.id))!.status).toBe('DISTRIBUTED');
  });

  it('demand status transitions are guarded', async () => {
    const ctx = setup();
    const demand = await demandFor(ctx, 'SpaceFix');
    await expect(ctx.app.setDemandStatus(demand.id, 'ACCEPTED', null)).rejects.toThrow(/Transition impossible/);
    await ctx.app.setDemandStatus(demand.id, 'REJECTED', 'Spam');
    await expect(ctx.app.distribute(demand.id, [demand.requestedCompanyId!])).rejects.toThrow(/clôturée ou rejetée/);
    await ctx.app.setDemandStatus(demand.id, 'NEW', null);
    await ctx.app.updateDemand(demand.id, { quantity: 3, customerPhone: '0612345678' });
    const d = (await ctx.repo.getDemand(demand.id))!;
    expect(d.quantity).toBe(3);
    expect(d.customerPhone).toBe('+212612345678');
    await expect(ctx.app.updateDemand(demand.id, { customerPhone: '123' })).rejects.toThrow(/invalide/);
  });
});

describe('Analytics', () => {
  it('J — creating records updates the metrics', async () => {
    const ctx = setup();
    const m0 = await ctx.app.metrics();
    expect(m0.demands).toBe(0);
    expect(m0.waClicks).toBe(0);

    const demand = await demandFor(ctx, 'SpaceFix');
    const refused = ctx.customer('+212663333333');
    await refused.openFromFiche((await ctx.company('Casa Clim')).id);
    await runScript(refused, { intent: 'INFO', consent: false, name: 'x' });

    let m = await ctx.app.metrics();
    expect(m.ficheViews).toBe(2);
    expect(m.waClicks).toBe(2);
    expect(m.conversations).toBe(2);
    expect(m.conversationsCompleted).toBe(1);
    expect(m.conversationsRefused).toBe(1);
    expect(m.consentRate).toBe(0.5);
    expect(m.demands).toBe(1);
    expect(m.byCity).toEqual([{ key: 'Casablanca', label: 'Casablanca', count: 1 }]);
    expect(m.topRequested[0].label).toBe('SpaceFix');
    expect(m.demandsDistributed).toBe(0);

    await ctx.app.distribute(demand.id, [demand.requestedCompanyId!]);
    m = await ctx.app.metrics();
    expect(m.demandsDistributed).toBe(1);
    expect(m.companiesContacted).toBe(1);
    expect(m.subscriptions.freeOpportunitiesSent).toBe(1);
    expect(m.funnel.map((f) => f.value)).toEqual([2, 2, 2, 1, 1, 1, 0]);
  });
});

describe('Interpreter', () => {
  const ai = new RuleBasedInterpreter();
  it('extracts the brief example', () => {
    const r = ai.interpretSync('Salam, je cherche un climatiseur 18000 BTU pour mon bureau à Casablanca et je voudrais connaître le prix.');
    expect(r).toMatchObject({ intent: 'PRICE', product: 'Climatiseur', specification: '18000 BTU', quantity: 1, location: 'Casablanca', category: 'climatisation' });
  });
  it('reads quantities and Arabic', () => {
    expect(ai.interpretSync('2 climatiseurs split 12000 BTU').quantity).toBe(2);
    expect(ai.interpretSync('بشحال مكيف في الدار البيضاء')).toMatchObject({ intent: 'PRICE', product: 'Climatiseur', location: 'Casablanca', lang: 'ar' });
    expect(ai.interpretSync('Panneaux solaires 5 kWc à Rabat')).toMatchObject({ product: 'Panneaux solaires', specification: '5 KWC', location: 'Rabat' });
  });
  it('validator rejects malformed AI output', () => {
    const v = validateInterpretation({ intent: 'DROP TABLE', quantity: -4, location: 'Atlantis', product: 42, confidence: 9 }, 'llm');
    expect(v.intent).toBeUndefined();
    expect(v.quantity).toBeUndefined();
    expect(v.location).toBeUndefined();
    expect(v.product).toBeUndefined();
    expect(v.confidence).toBe(1);
  });
});

describe('Phone', () => {
  it('normalises Moroccan numbers', () => {
    expect(normalizePhone('06 61 23 45 67').e164).toBe('+212661234567');
    expect(normalizePhone('+212 7 12 34 56 78').e164).toBe('+212712345678');
    expect(normalizePhone('00212522000100').e164).toBe('+212522000100');
    expect(normalizePhone('0123').ok).toBe(false);
    expect(normalizePhone('08 12 34 56 78').ok).toBe(false);
    expect(formatPhone('+212661234567')).toBe('+212 6 61 23 45 67');
  });
});

describe('Seed', () => {
  it('generates consistent demo data', async () => {
    const db = await generateSeed(NOW);
    expect(db.demands.length).toBeGreaterThan(40);
    expect(db.companies.length).toBeGreaterThan(20);
    const ids = (arr: { id: string }[]) => new Set(arr.map((x) => x.id));
    const conv = ids(db.conversations);
    const contacts = ids(db.contacts);
    const companies = ids(db.companies);
    const demands = ids(db.demands);
    for (const d of db.demands) {
      expect(conv.has(d.conversationId)).toBe(true);
      expect(contacts.has(d.contactId)).toBe(true);
      expect(d.requestedCompanyId && companies.has(d.requestedCompanyId)).toBe(true);
      expect(d.consent).toBe(true);
      expect(db.conversations.find((c) => c.id === d.conversationId)?.demandId).toBe(d.id);
    }
    for (const x of db.distributions) {
      expect(demands.has(x.demandId)).toBe(true);
      expect(companies.has(x.companyId)).toBe(true);
    }
    for (const c of db.conversations.filter((c) => c.consent === false)) {
      expect(c.data).toEqual({});
      expect(c.demandId).toBeNull();
    }
    // One demand per conversation.
    expect(new Set(db.demands.map((d) => d.conversationId)).size).toBe(db.demands.length);
    // SpaceFix keeps its free opportunity for the live demo.
    expect(db.companies.find((c) => c.name === 'SpaceFix')!.freeOpportunityUsedAt).toBeNull();
    // Story: ÉlectroMénager Plus converted after its free opportunity.
    const emp = db.companies.find((c) => c.name === 'ÉlectroMénager Plus')!;
    expect(emp.subscription.status).toBe('ACTIVE');
    expect(emp.freeOpportunityUsedAt! <= emp.subscription.startedAt!).toBe(true);
    const statuses = new Set(db.conversations.map((c) => c.status));
    expect(statuses).toEqual(new Set(['COMPLETED', 'REFUSED', 'ABANDONED', 'ACTIVE']));
    expect(db.distributions.some((d) => d.deliveryStatus === 'FAILED')).toBe(true);
  });
});
