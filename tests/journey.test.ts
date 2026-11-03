import { describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { runScript } from '../src/core/simulation/customer';
import { MINUTE } from '../src/core/clock';

describe('Customer journey', () => {
  it('A — PRICE: fiche → Prix → consent → name → phone → product → demand', async () => {
    const { customer, company, repo, lastBot } = setup();
    const spacefix = await company('SpaceFix');
    const c = customer();

    const open = await c.openFromFiche(spacefix.id);
    const conv0 = (await c.conversation())!;
    expect(open.accepted).toBe(true);
    expect(conv0.companyId).toBe(spacefix.id);
    expect(conv0.ficheId).toBe(spacefix.ficheId);
    expect(conv0.resolution).toBe('referral');
    expect(conv0.state).toBe('AWAIT_INTENT');
    const firstInbound = (await repo.listMessages(conv0.id))[0];
    expect(firstInbound.body).toBe('Bonjour, je vous contacte via Telecontact au sujet de SpaceFix à Casablanca. Pouvez-vous me répondre rapidement ?');
    expect((await lastBot(conv0.id)).buttons?.map((b) => b.id)).toEqual(['intent:PRICE', 'intent:INFO', 'intent:CALLBACK']);

    await c.press('intent:PRICE');
    expect((await c.conversation())!.state).toBe('AWAIT_CONSENT');
    await c.press('consent:yes');
    expect((await c.conversation())!.consent).toBe(true);
    await c.say('Ahmed El Amrani');
    expect((await c.conversation())!.state).toBe('AWAIT_PHONE_CONFIRM');
    await c.press('phone:confirm');
    expect((await c.conversation())!.state).toBe('PRICE_PRODUCT');
    expect((await lastBot(conv0.id)).body).toContain('Quel produit ou service recherchez-vous chez SpaceFix ?');

    await c.say('Je cherche un climatiseur 18000 BTU pour mon bureau');
    let conv = (await c.conversation())!;
    expect(conv.data.product).toBe('Climatiseur');
    expect(conv.data.specification).toBe('18000 BTU');
    expect(conv.state).toBe('PRICE_QUANTITY');
    await c.say('2');
    await c.press('loc:fiche');
    await c.say('Pour un bureau');
    conv = (await c.conversation())!;
    expect(conv.state).toBe('COMPLETED');

    const demand = (await repo.getDemandByConversation(conv.id))!;
    expect(demand).toMatchObject({
      requestedCompanyId: spacefix.id,
      customerName: 'Ahmed El Amrani',
      customerPhone: '+212661234567',
      intent: 'PRICE',
      product: 'Climatiseur',
      specification: '18000 BTU',
      quantity: 2,
      city: 'Casablanca',
      consent: true,
      source: 'Telecontact',
      status: 'NEW',
    });
    expect(conv.demandId).toBe(demand.id);
    expect((await lastBot(conv.id)).body).toContain(`n°${demand.number}`);
    const contact = (await repo.getContact(conv.contactId))!;
    expect(contact.name).toBe('Ahmed El Amrani');
  });

  it('A′ — free text first message is interpreted and skips answered questions', async () => {
    const { customer, repo } = setup();
    const c = customer();
    await c.say('Salam, je cherche un climatiseur 18000 BTU pour mon bureau à Casablanca et je voudrais connaître le prix.');
    let conv = (await c.conversation())!;
    expect(conv.intent).toBe('PRICE');
    expect(conv.state).toBe('AWAIT_CONSENT');
    expect(conv.data).toMatchObject({ product: 'Climatiseur', specification: '18000 BTU', location: 'Casablanca', quantity: 1 });
    await c.press('consent:yes');
    await c.say('Ahmed El Amrani');
    await c.press('phone:confirm');
    conv = (await c.conversation())!;
    // product, quantity and city already known → straight to optional details
    expect(conv.state).toBe('PRICE_DETAILS');
    await c.press('details:skip');
    expect((await repo.getDemandByConversation(conv.id))?.product).toBe('Climatiseur');
  });

  it('B — INFO path creates a demand with the question', async () => {
    const { customer, company, repo } = setup();
    const c = customer();
    await c.openFromFiche((await company('Casa Clim')).id);
    const conv = await runScript(c, { intent: 'INFO', consent: true, name: 'Salma Bennani', question: 'Faites-vous l’entretien des climatiseurs le samedi ?' });
    expect(conv.state).toBe('COMPLETED');
    const d = (await repo.getDemandByConversation(conv.id))!;
    expect(d.intent).toBe('INFO');
    expect(d.question).toContain('entretien');
    expect(d.category).toBe('climatisation');
  });

  it('C — CALLBACK path stores reason and preferred time', async () => {
    const { customer, company, repo } = setup();
    const c = customer();
    await c.openFromFiche((await company('ElectroPro')).id);
    const conv = await runScript(c, { intent: 'CALLBACK', consent: true, name: 'Omar Tazi', reason: 'Coupure de courant dans mon magasin', callbackTime: 'TOMORROW' });
    const d = (await repo.getDemandByConversation(conv.id))!;
    expect(d.reason).toBe('Coupure de courant dans mon magasin');
    expect(d.callbackTime).toBe('TOMORROW');
  });

  it('D — refused consent stops collection, no demand, no personal data', async () => {
    const { customer, company, repo, lastBot } = setup();
    const c = customer();
    await c.openFromFiche((await company('SpaceFix')).id);
    await c.press('intent:PRICE');
    await c.press('consent:no');
    let conv = (await c.conversation())!;
    expect(conv.state).toBe('REFUSED');
    expect(conv.consent).toBe(false);
    expect(conv.status).toBe('REFUSED');
    // Further text must not be collected as a name.
    await c.say('Ahmed El Amrani');
    conv = (await c.conversation())!;
    expect(conv.state).toBe('REFUSED');
    expect(conv.data).toEqual({});
    expect((await repo.getContact(conv.contactId))!.name).toBeNull();
    expect(await repo.listDemands()).toHaveLength(0);
    expect((await lastBot(conv.id)).buttons?.[0].id).toBe('restart');
    const log = await repo.listActivity({ conversationId: conv.id });
    expect(log.some((a) => a.action === 'consent_refused')).toBe(true);
  });

  it('D′ — refusal also discards information inferred before consent', async () => {
    const { customer } = setup();
    const c = customer();
    await c.say('Bonjour, prix d’un climatiseur 12000 BTU à Rabat ?');
    await c.press('consent:no');
    expect((await c.conversation())!.data).toEqual({});
  });

  it('E — customer leaves and comes back: conversation resumes at the same step', async () => {
    const { app, customer, company, clock, lastBot } = setup();
    const spacefix = await company('SpaceFix');
    const c = customer();
    await c.openFromFiche(spacefix.id);
    await c.press('intent:CALLBACK');
    await c.press('consent:yes');
    const before = (await c.conversation())!;
    expect(before.state).toBe('AWAIT_NAME');

    clock.advance(45 * MINUTE);
    expect(await app.sweepAbandoned()).toBe(1);
    expect((await c.conversation())!.status).toBe('ABANDONED');

    // Customer clicks the fiche button again (same pre-filled message).
    await c.openFromFiche(spacefix.id);
    const after = (await c.conversation())!;
    expect(after.id).toBe(before.id);
    expect(after.state).toBe('AWAIT_NAME');
    expect(after.status).toBe('ACTIVE');
    expect(after.intent).toBe('CALLBACK');
    expect((await lastBot(after.id)).body).toContain('nom et prénom');

    // Customer can also simply type the answer after returning.
    await c.say('Karim Lahlou');
    expect((await c.conversation())!.state).toBe('AWAIT_PHONE_CONFIRM');
  });

  it('F — duplicate events and repeated clicks never create duplicates', async () => {
    const { customer, company, repo } = setup();
    const c = customer();
    await c.openFromFiche((await company('SpaceFix')).id);
    // Same provider event delivered twice.
    const r1 = await c.press('intent:PRICE', 'wamid.FIXED1');
    const r2 = await c.press('intent:PRICE', 'wamid.FIXED1');
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    // Second click on the same button (new event id) is stale: state unchanged.
    const r3 = await c.press('intent:PRICE');
    expect(r3.accepted).toBe(false);
    expect((await c.conversation())!.state).toBe('AWAIT_CONSENT');
    await c.press('consent:yes');
    await c.say('Ahmed El Amrani');
    await c.press('phone:confirm');
    await c.say('climatiseur 18000 BTU');
    await c.say('2');
    await c.press('loc:fiche');
    await Promise.all([c.press('details:skip', 'wamid.LAST'), c.press('details:skip', 'wamid.LAST'), c.press('details:skip')]);
    expect(await repo.listDemands()).toHaveLength(1);
    // Text after completion does not create another demand either.
    await c.say('Merci !');
    expect(await repo.listDemands()).toHaveLength(1);
  });

  it('F′ — a click on a button from an earlier message is ignored', async () => {
    const { app, customer, company, repo } = setup();
    const c = customer();
    await c.openFromFiche((await company('SpaceFix')).id);
    const conv = (await c.conversation())!;
    const welcome = (await repo.listMessages(conv.id)).find((m) => m.buttons?.length)!;
    await c.press('intent:INFO');
    const res = await app.receiveInbound({ externalId: 'wamid.OLD', from: c.waNumber, button: { id: 'intent:PRICE', replyTo: welcome.id } });
    expect(res.accepted).toBe(false);
    expect((await c.conversation())!.intent).toBe('INFO');
  });

  it('validates names and phone numbers', async () => {
    const { customer, company, lastBot } = setup();
    const c = customer();
    await c.openFromFiche((await company('SpaceFix')).id);
    await c.press('intent:PRICE');
    await c.press('consent:yes');
    await c.say('12345');
    let conv = (await c.conversation())!;
    expect(conv.state).toBe('AWAIT_NAME');
    expect(conv.retries).toBe(1);
    expect((await lastBot(conv.id)).body).toContain('nom');
    await c.say('je m’appelle youssef benali');
    conv = (await c.conversation())!;
    expect(conv.data.name).toBe('Youssef Benali');
    await c.press('phone:other');
    await c.say('0123');
    expect((await c.conversation())!.state).toBe('AWAIT_PHONE_INPUT');
    await c.say('07 12 34 56 78');
    conv = (await c.conversation())!;
    expect(conv.data.phone).toBe('+212712345678');
    expect(conv.state).toBe('PRICE_PRODUCT');
  });

  it('handles unexpected text when a button is expected', async () => {
    const { customer, company, lastBot } = setup();
    const c = customer();
    await c.openFromFiche((await company('SpaceFix')).id);
    await c.say('hein ?');
    const conv = (await c.conversation())!;
    expect(conv.state).toBe('AWAIT_INTENT');
    expect((await lastBot(conv.id)).buttons?.length).toBe(3);
    await c.say('2');
    expect((await c.conversation())!.intent).toBe('INFO');
  });

  it('supports Arabic answers', async () => {
    const { customer, company } = setup();
    const c = customer();
    await c.openFromFiche((await company('Casa Clim')).id);
    await c.press('intent:PRICE');
    await c.say('موافق');
    await c.say('أحمد العمراني');
    const conv = (await c.conversation())!;
    expect(conv.data.name).toBe('أحمد العمراني');
    expect(conv.lang).toBe('ar');
  });

  it('restart after completion opens a new conversation for the same company', async () => {
    const { customer, company, repo } = setup();
    const c = customer();
    const cc = await company('Casa Clim');
    await c.openFromFiche(cc.id);
    const first = await runScript(c, { intent: 'INFO', consent: true, name: 'Nadia Alaoui', question: 'Vos horaires ?' });
    await c.say('Bonjour encore');
    await c.press('restart');
    const second = (await c.conversation())!;
    expect(second.id).not.toBe(first.id);
    expect(second.companyId).toBe(cc.id);
    expect(second.state).toBe('AWAIT_INTENT');
    expect(await repo.listDemands()).toHaveLength(1);
  });

  it('failed simulated delivery is recorded and can be resent', async () => {
    const { app, customer, company, transport, repo } = setup();
    const c = customer();
    transport.forceFailures(1);
    await c.openFromFiche((await company('SpaceFix')).id);
    const conv = (await c.conversation())!;
    const failed = (await repo.listMessages(conv.id)).find((m) => m.deliveryStatus === 'FAILED')!;
    expect(failed).toBeTruthy();
    const resent = await app.resendMessage(failed.id);
    expect(resent.deliveryStatus).toBe('DELIVERED');
  });

  it('template parsing identifies the company without referral metadata', async () => {
    const { customer, company } = setup();
    const c = customer();
    await c.say('Bonjour, je vous contacte via Telecontact au sujet de Atlas Solar à Rabat. Pouvez-vous me répondre rapidement ?');
    const conv = (await c.conversation())!;
    expect(conv.companyId).toBe((await company('Atlas Solar')).id);
    expect(conv.resolution).toBe('template');
  });
});
