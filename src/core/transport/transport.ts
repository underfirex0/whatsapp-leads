import type { DeliveryStatus, MessageButton } from '../types';

/**
 * Messaging transport port. The conversation engine and services never call a
 * provider directly. Swap `SimulatedTransport` for a Meta WhatsApp Cloud API
 * implementation (POST /{phone-number-id}/messages) without touching logic.
 */
export interface OutboundMessage {
  to: string;
  body: string;
  buttons?: MessageButton[];
  /** 'customer' = conversation with the visitor, 'company' = demand notification. */
  channel: 'customer' | 'company';
}

export interface SendResult {
  externalId: string;
  status: DeliveryStatus;
  error?: string;
}

export interface MessagingTransport {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

/**
 * Simulated WhatsApp delivery. Nothing leaves the browser.
 * Failure can be forced (next message) or random (settings failure rate).
 */
export class SimulatedTransport implements MessagingTransport {
  readonly name = 'simulated-whatsapp';
  private failNext = 0;
  private seq = 0;

  constructor(
    private failureRate: () => number = () => 0,
    private random: () => number = Math.random,
  ) {}

  /** Make the next `n` sends fail (demo tool). */
  forceFailures(n = 1) {
    this.failNext = n;
  }

  get pendingForcedFailures() {
    return this.failNext;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    this.seq += 1;
    const externalId = `wamid.SIM${Date.now().toString(36)}${this.seq.toString(36)}`;
    if (!/^\+\d{8,15}$/.test(message.to)) {
      return { externalId, status: 'FAILED', error: 'Numéro de destination invalide' };
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      return { externalId, status: 'FAILED', error: 'Échec simulé : destinataire injoignable (131026)' };
    }
    if (this.random() < this.failureRate()) {
      return { externalId, status: 'FAILED', error: 'Échec simulé aléatoire (taux configuré)' };
    }
    return { externalId, status: 'DELIVERED' };
  }
}
