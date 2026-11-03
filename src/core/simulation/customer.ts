import type { AppService, InboundResult } from '../services/app';
import type { Conversation, Intent } from '../types';

/**
 * A scripted WhatsApp customer. Produces the same inbound events as the
 * interactive simulator (and, later, the Meta webhook). Used by the seed
 * generator and the end-to-end tests.
 */
export class SimulatedCustomer {
  conversationId: string | null = null;
  private seq = 0;

  constructor(
    private app: AppService,
    readonly waNumber: string,
    readonly profileName: string,
    private idPrefix = 'wamid.CUST',
  ) {}

  private nextId() {
    this.seq += 1;
    return `${this.idPrefix}.${this.waNumber.slice(-6)}.${this.seq}.${Math.random().toString(36).slice(2, 7)}`;
  }

  private track(r: InboundResult) {
    if (r.conversationId) this.conversationId = r.conversationId;
    return r;
  }

  async openFromFiche(companyId: string, visitorId = `v_${this.waNumber.slice(-6)}`) {
    await this.app.recordFicheView(companyId, visitorId);
    const click = await this.app.clickWhatsApp(companyId, visitorId);
    return this.track(
      await this.app.receiveInbound({
        externalId: this.nextId(),
        from: this.waNumber,
        profileName: this.profileName,
        text: click.text,
        referral: { ficheId: click.ficheId, clickId: click.clickId },
      }),
    );
  }

  async say(text: string, externalId = this.nextId()) {
    return this.track(await this.app.receiveInbound({ externalId, from: this.waNumber, profileName: this.profileName, text }));
  }

  async press(buttonId: string, externalId = this.nextId()) {
    const conv = await this.conversation();
    return this.track(
      await this.app.receiveInbound({
        externalId,
        from: this.waNumber,
        profileName: this.profileName,
        button: { id: buttonId, replyTo: conv?.activePromptId ?? undefined },
      }),
    );
  }

  async conversation(): Promise<Conversation | null> {
    return this.conversationId ? this.app.repo.getConversation(this.conversationId) : null;
  }
}

export interface CustomerScript {
  intent: Intent;
  consent: boolean;
  name: string;
  otherPhone?: string;
  product?: string;
  quantity?: number | 'button';
  city?: string | 'fiche';
  details?: string;
  question?: string;
  reason?: string;
  callbackTime?: 'ASAP' | 'TODAY' | 'TOMORROW';
  /** Stop answering at this state (abandonment). */
  stopAt?: Conversation['state'];
}

/** Drives a conversation to completion by answering whatever the bot asks next. */
export async function runScript(customer: SimulatedCustomer, script: CustomerScript, onStep?: () => void) {
  for (let guard = 0; guard < 20; guard++) {
    const conv = await customer.conversation();
    if (!conv) throw new Error('No conversation');
    if (script.stopAt && conv.state === script.stopAt) return conv;
    onStep?.();
    switch (conv.state) {
      case 'NEW':
      case 'AWAIT_INTENT':
        await customer.press(`intent:${script.intent}`);
        break;
      case 'AWAIT_CONSENT':
        await customer.press(script.consent ? 'consent:yes' : 'consent:no');
        break;
      case 'AWAIT_NAME':
        await customer.say(script.name);
        break;
      case 'AWAIT_PHONE_CONFIRM':
        await customer.press(script.otherPhone ? 'phone:other' : 'phone:confirm');
        break;
      case 'AWAIT_PHONE_INPUT':
        await customer.say(script.otherPhone ?? '0661000000');
        break;
      case 'PRICE_PRODUCT':
        await customer.say(script.product ?? 'Un devis');
        break;
      case 'PRICE_QUANTITY':
        if (script.quantity === 'button' || script.quantity === undefined) await customer.press('qty:1');
        else await customer.say(String(script.quantity));
        break;
      case 'PRICE_LOCATION':
        if (!script.city || script.city === 'fiche') await customer.press('loc:fiche');
        else await customer.say(script.city);
        break;
      case 'PRICE_DETAILS':
        if (script.details) await customer.say(script.details);
        else await customer.press('details:skip');
        break;
      case 'INFO_QUESTION':
        await customer.say(script.question ?? 'Quels sont vos horaires ?');
        break;
      case 'CALLBACK_REASON':
        await customer.say(script.reason ?? 'Je souhaite un rendez-vous');
        break;
      case 'CALLBACK_TIME':
        await customer.press(`time:${script.callbackTime ?? 'ASAP'}`);
        break;
      case 'COMPLETED':
      case 'REFUSED':
        return conv;
    }
  }
  throw new Error('Script did not finish');
}
