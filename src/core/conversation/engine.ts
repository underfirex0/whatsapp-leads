import type {
  CallbackTime,
  CollectedData,
  Conversation,
  ConversationState,
  Intent,
  ISODate,
  MessageButton,
} from '../types';
import type { Interpretation } from '../ai/interpreter';
import { copy, ENTRY_TEMPLATE_RE } from './copy';
import { formatPhone, normalizePhone } from '../phone';
import { findCity } from '../catalog';
import { hasArabic, normalize, titleCase } from '../text';

/**
 * Conversation engine — a pure, provider-agnostic state machine.
 *
 *   step(conversation, input, context) → { conversation', replies, effects }
 *
 * It never touches storage, transport or the UI. The application service
 * persists the new conversation, sends the replies through the messaging
 * transport and executes the effects (create demand, update contact…).
 */

export type EngineInput =
  | { kind: 'text'; text: string; interpretation?: Interpretation }
  | { kind: 'button'; buttonId: string; replyTo?: string }
  /** The customer re-opened the conversation (e.g. clicked the fiche button again). */
  | { kind: 'resume' };

export interface EngineContext {
  companyName: string | null;
  ficheCity: string | null;
  waNumber: string;
  privacyUrl: string;
  now: ISODate;
}

export interface Reply {
  kind: 'text' | 'buttons';
  body: string;
  buttons?: MessageButton[];
}

export type Effect =
  | { type: 'CONSENT'; value: boolean }
  | { type: 'CONTACT'; name?: string; phone?: string }
  | { type: 'CREATE_DEMAND' }
  | { type: 'RESTART' };

export interface StepResult {
  conversation: Conversation;
  replies: Reply[];
  effects: Effect[];
  /** false when the input was ignored (stale button, terminal state…). */
  accepted: boolean;
  /** Short machine-readable reason, recorded in the audit log. */
  note?: string;
}

export const TERMINAL_STATES: ConversationState[] = ['COMPLETED', 'REFUSED'];
export const PERSONAL_DATA_STATES: ConversationState[] = [
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
];

export const STATE_LABELS: Record<ConversationState, string> = {
  NEW: 'Nouveau',
  AWAIT_INTENT: 'Choix du besoin',
  AWAIT_CONSENT: 'Consentement',
  AWAIT_NAME: 'Nom',
  AWAIT_PHONE_CONFIRM: 'Confirmation du numéro',
  AWAIT_PHONE_INPUT: 'Saisie du numéro',
  PRICE_PRODUCT: 'Produit',
  PRICE_QUANTITY: 'Quantité',
  PRICE_LOCATION: 'Ville',
  PRICE_DETAILS: 'Précisions',
  INFO_QUESTION: 'Question',
  CALLBACK_REASON: 'Motif du rappel',
  CALLBACK_TIME: 'Créneau de rappel',
  COMPLETED: 'Terminée',
  REFUSED: 'Consentement refusé',
};

const MAX_TEXT = 500;

// ───────────────────────────── Validators ─────────────────────────────

const NAME_PREFIXES = /^(je m'appelle|je suis|moi c'est|mon nom est|nom ?:|c'est|ana|smiti|اسمي|أنا|انا)\s+/i;

export function parseName(raw: string): string | null {
  let v = raw.trim().replace(/\s+/g, ' ').replace(/’/g, "'");
  v = v.replace(NAME_PREFIXES, '').trim();
  if (v.length < 2 || v.length > 60) return null;
  if (/\d/.test(v)) return null;
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(v)) return null;
  const letters = v.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return null;
  const n = normalize(v);
  if (['ok', 'oui', 'non', 'merci', 'salam', 'bonjour', 'hello', 'prix', 'infos'].includes(n)) return null;
  return hasArabic(v) ? v : titleCase(v);
}

export function parseQuantity(raw: string, interpretation?: Interpretation): number | null {
  const m = /\d{1,5}/.exec(raw.replace(/\s/g, ''));
  const value = m ? Number(m[0]) : interpretation?.quantity;
  if (!value || !Number.isInteger(value) || value < 1 || value > 10000) return null;
  return value;
}

const YES = /^(ok|oui|d'accord|daccord|accepte|j'accepte|yes|wakha|ouakha|موافق|نعم|واخا|اه)(?=$|[\s!.,])/;
const NO = /^(non|no|refuse|je refuse|pas d'accord|la|لا|لا شكرا)(?=$|[\s!.,])/;

function firstName(name: string | undefined): string {
  return (name ?? '').split(' ')[0] ?? '';
}

// ───────────────────────────── Prompts ─────────────────────────────

/** The prompt that asks for the information expected in `state`. */
export function promptFor(conv: Conversation, ctx: EngineContext): Reply[] {
  const lang = conv.lang;
  const company = ctx.companyName ?? 'ce professionnel';
  switch (conv.state) {
    case 'NEW':
    case 'AWAIT_INTENT':
      return [{ kind: 'buttons', body: copy.welcome(), buttons: copy.intentButtons }];
    case 'AWAIT_CONSENT':
      return [{ kind: 'buttons', body: copy.consent(ctx.privacyUrl), buttons: copy.consentButtons }];
    case 'AWAIT_NAME':
      return [{ kind: 'text', body: copy.askName(lang) }];
    case 'AWAIT_PHONE_CONFIRM':
      return [
        {
          kind: 'buttons',
          body: copy.confirmPhone(lang, firstName(conv.data.name), formatPhone(ctx.waNumber)),
          buttons: copy.phoneButtons(lang),
        },
      ];
    case 'AWAIT_PHONE_INPUT':
      return [{ kind: 'text', body: copy.askPhone(lang) }];
    case 'PRICE_PRODUCT':
      return [{ kind: 'text', body: copy.askProduct(lang, company) }];
    case 'PRICE_QUANTITY':
      return [
        {
          kind: 'buttons',
          body: copy.askQuantity(lang, [conv.data.product, conv.data.specification].filter(Boolean).join(' ')),
          buttons: copy.quantityButtons,
        },
      ];
    case 'PRICE_LOCATION':
      return [{ kind: 'buttons', body: copy.askLocation(lang), buttons: copy.locationButtons(ctx.ficheCity, lang) }];
    case 'PRICE_DETAILS':
      return [{ kind: 'buttons', body: copy.askDetails(lang), buttons: copy.detailsButtons(lang) }];
    case 'INFO_QUESTION':
      return [{ kind: 'text', body: copy.askQuestion(lang) }];
    case 'CALLBACK_REASON':
      return [{ kind: 'text', body: copy.askReason(lang) }];
    case 'CALLBACK_TIME':
      return [{ kind: 'buttons', body: copy.askCallbackTime(lang), buttons: copy.callbackButtons(lang) }];
    case 'COMPLETED':
      return [{ kind: 'buttons', body: copy.alreadyCompleted(lang), buttons: copy.restartButton(lang, 'new') }];
    case 'REFUSED':
      return [{ kind: 'buttons', body: copy.afterRefusal(lang), buttons: copy.restartButton(lang, 'restart') }];
  }
}

/** Buttons that are valid answers in a given state. */
function validButtons(state: ConversationState): string[] {
  switch (state) {
    case 'NEW':
    case 'AWAIT_INTENT':
      return ['intent:PRICE', 'intent:INFO', 'intent:CALLBACK'];
    case 'AWAIT_CONSENT':
      return ['consent:yes', 'consent:no'];
    case 'AWAIT_PHONE_CONFIRM':
      return ['phone:confirm', 'phone:other'];
    case 'PRICE_QUANTITY':
      return ['qty:1', 'qty:2', 'qty:3'];
    case 'PRICE_LOCATION':
      return ['loc:fiche', 'loc:other'];
    case 'PRICE_DETAILS':
      return ['details:skip'];
    case 'CALLBACK_TIME':
      return ['time:ASAP', 'time:TODAY', 'time:TOMORROW'];
    case 'COMPLETED':
    case 'REFUSED':
      return ['restart'];
    default:
      return [];
  }
}

/** Next qualification step given what is already known (skips questions already answered). */
export function nextQualificationState(intent: Intent, data: CollectedData): ConversationState | 'DONE' {
  if (intent === 'PRICE') {
    if (!data.product) return 'PRICE_PRODUCT';
    if (data.quantity === undefined) return 'PRICE_QUANTITY';
    if (!data.location) return 'PRICE_LOCATION';
    if (data.details === undefined) return 'PRICE_DETAILS';
    return 'DONE';
  }
  if (intent === 'INFO') return data.question ? 'DONE' : 'INFO_QUESTION';
  if (!data.reason) return 'CALLBACK_REASON';
  if (!data.callbackTime) return 'CALLBACK_TIME';
  return 'DONE';
}

// ───────────────────────────── Engine ─────────────────────────────

export function step(input: Conversation, event: EngineInput, ctx: EngineContext): StepResult {
  // Work on a copy — the caller's object is never mutated.
  const conv: Conversation = { ...input, data: { ...input.data }, updatedAt: ctx.now };
  const replies: Reply[] = [];
  const effects: Effect[] = [];

  const result = (accepted: boolean, note?: string): StepResult => ({ conversation: conv, replies, effects, accepted, note });

  const goTo = (state: ConversationState) => {
    conv.state = state;
    conv.retries = 0;
    replies.push(...promptFor(conv, ctx));
  };

  const advanceQualification = () => {
    const next = nextQualificationState(conv.intent!, conv.data);
    if (next === 'DONE') {
      conv.state = 'COMPLETED';
      conv.status = 'COMPLETED';
      conv.retries = 0;
      conv.closedAt = ctx.now;
      effects.push({ type: 'CREATE_DEMAND' });
      replies.push({ kind: 'text', body: copy.completed(conv.lang, formatPhone(conv.data.phone ?? ctx.waNumber)) });
    } else {
      goTo(next);
    }
  };

  const invalid = (message?: string): StepResult => {
    conv.retries += 1;
    if (message) replies.push({ kind: 'text', body: message });
    // Button states: re-send the buttons so the customer always has a valid prompt.
    if (validButtons(conv.state).length > 0) {
      const prompt = promptFor(conv, ctx);
      replies.push(conv.retries >= 2 ? { ...prompt[prompt.length - 1], body: copy.useButtons(conv.lang) } : prompt[prompt.length - 1]);
    }
    return result(true, 'invalid_input');
  };

  const applyIntent = (intent: Intent) => {
    conv.intent = intent;
    goTo('AWAIT_CONSENT');
  };

  // ── Resume after leaving ──
  if (event.kind === 'resume') {
    if (TERMINAL_STATES.includes(conv.state)) return result(false, 'terminal');
    if (conv.status === 'ABANDONED') conv.status = 'ACTIVE';
    if (conv.state === 'NEW') {
      goTo('AWAIT_INTENT');
      return result(true, 'resumed');
    }
    replies.push({ kind: 'text', body: copy.welcomeBack(conv.lang) });
    replies.push(...promptFor(conv, ctx));
    return result(true, 'resumed');
  }

  conv.lastInboundAt = ctx.now;
  if (conv.status === 'ABANDONED') conv.status = 'ACTIVE';

  // ── Button replies: only buttons from the currently active prompt are honoured ──
  let buttonId: string | null = null;
  let text = '';
  let interp: Interpretation | undefined;
  if (event.kind === 'button') {
    if (!validButtons(conv.state).includes(event.buttonId)) return result(false, 'stale_button');
    if (event.replyTo && conv.activePromptId && event.replyTo !== conv.activePromptId) return result(false, 'stale_button');
    buttonId = event.buttonId;
  } else {
    text = event.text.trim().slice(0, MAX_TEXT);
    interp = event.interpretation;
    if (/\p{L}{2,}/u.test(text)) conv.lang = hasArabic(text) ? 'ar' : 'fr';
  }
  const n = normalize(text);

  switch (conv.state) {
    case 'NEW': {
      // First inbound message. Either the fiche template or a free-text request.
      const isTemplate = ENTRY_TEMPLATE_RE.test(n);
      if (!isTemplate && interp?.intent) {
        prefill(conv, interp, text);
        replies.push({ kind: 'text', body: conv.lang === 'ar' ? 'مرحبًا 👋 شكرًا على رسالتكم.' : 'Bonjour 👋 Merci pour votre message.' });
        applyIntent(interp.intent);
        return result(true, 'intent_detected');
      }
      goTo('AWAIT_INTENT');
      return result(true);
    }

    case 'AWAIT_INTENT': {
      let intent: Intent | null = null;
      if (buttonId) intent = buttonId.split(':')[1] as Intent;
      else if (/^1\b|^1️⃣/.test(n)) intent = 'PRICE';
      else if (/^2\b|^2️⃣/.test(n)) intent = 'INFO';
      else if (/^3\b|^3️⃣/.test(n)) intent = 'CALLBACK';
      else if (interp?.intent) {
        intent = interp.intent;
        prefill(conv, interp, text);
      }
      if (!intent) return invalid();
      applyIntent(intent);
      return result(true);
    }

    case 'AWAIT_CONSENT': {
      const yes = buttonId === 'consent:yes' || (!buttonId && YES.test(n));
      const no = buttonId === 'consent:no' || (!buttonId && NO.test(n));
      if (yes) {
        conv.consent = true;
        conv.consentAt = ctx.now;
        effects.push({ type: 'CONSENT', value: true });
        goTo('AWAIT_NAME');
        return result(true);
      }
      if (no) {
        conv.consent = false;
        conv.consentAt = ctx.now;
        conv.state = 'REFUSED';
        conv.status = 'REFUSED';
        conv.closedAt = ctx.now;
        // Data minimisation: anything inferred before consent is discarded.
        conv.data = {};
        effects.push({ type: 'CONSENT', value: false });
        replies.push({ kind: 'text', body: copy.refused(conv.lang) });
        return result(true);
      }
      return invalid();
    }

    case 'AWAIT_NAME': {
      if (buttonId) return result(false, 'stale_button');
      const name = parseName(text);
      if (!name) return invalid(copy.invalidName(conv.lang));
      conv.data.name = name;
      effects.push({ type: 'CONTACT', name });
      goTo('AWAIT_PHONE_CONFIRM');
      return result(true);
    }

    case 'AWAIT_PHONE_CONFIRM': {
      if (buttonId === 'phone:confirm' || (!buttonId && YES.test(n)) || /^confirm/.test(n)) {
        conv.data.phone = ctx.waNumber;
        effects.push({ type: 'CONTACT', phone: ctx.waNumber });
        advanceQualification();
        return result(true);
      }
      if (buttonId === 'phone:other' || /autre|other|آخر/.test(n)) {
        goTo('AWAIT_PHONE_INPUT');
        return result(true);
      }
      // The customer typed a number directly.
      const typed = normalizePhone(text);
      if (!buttonId && typed.ok) {
        conv.data.phone = typed.e164;
        effects.push({ type: 'CONTACT', phone: typed.e164 });
        advanceQualification();
        return result(true);
      }
      return invalid();
    }

    case 'AWAIT_PHONE_INPUT': {
      const typed = normalizePhone(text);
      if (!typed.ok) return invalid(copy.invalidPhone(conv.lang));
      conv.data.phone = typed.e164;
      effects.push({ type: 'CONTACT', phone: typed.e164 });
      advanceQualification();
      return result(true);
    }

    case 'PRICE_PRODUCT': {
      if (text.length < 2) return invalid(copy.tooShort(conv.lang));
      conv.data.product = interp?.product ?? capitalize(text.slice(0, 80));
      if (interp?.category) conv.data.category = interp.category;
      if (interp?.specification) conv.data.specification = interp.specification;
      // At this step the bot asks the quantity next, so only a number actually written is kept.
      if (interp?.quantity !== undefined && interp.quantitySource === 'explicit' && conv.data.quantity === undefined) conv.data.quantity = interp.quantity;
      if (interp?.location && !conv.data.location) conv.data.location = interp.location;
      // Keep a useful clause the lexicon does not model ("pour mon bureau", "avec installation"…).
      const extra = extractDetails(text);
      if (extra && conv.data.details === undefined) conv.data.details = extra;
      advanceQualification();
      return result(true);
    }

    case 'PRICE_QUANTITY': {
      let qty: number | null = null;
      if (buttonId) qty = Number(buttonId.split(':')[1]);
      else qty = parseQuantity(text, interp);
      if (!qty) return invalid(copy.invalidQuantity(conv.lang));
      conv.data.quantity = qty;
      advanceQualification();
      return result(true);
    }

    case 'PRICE_LOCATION': {
      if (buttonId === 'loc:fiche' && ctx.ficheCity) {
        conv.data.location = ctx.ficheCity;
        advanceQualification();
        return result(true);
      }
      if (buttonId === 'loc:other') {
        replies.push({ kind: 'text', body: copy.askOtherCity(conv.lang) });
        return result(true);
      }
      const city = findCity(text) ?? (/^[\p{L}][\p{L}\s'-]{1,39}$/u.test(text) ? titleCase(text) : null);
      if (!city) return invalid(copy.invalidCity(conv.lang));
      conv.data.location = city;
      advanceQualification();
      return result(true);
    }

    case 'PRICE_DETAILS': {
      if (buttonId === 'details:skip' || /^(passer|non|rien|skip|تخطي|لا)$/.test(n)) {
        conv.data.details = conv.data.details ?? '';
      } else {
        conv.data.details = [conv.data.details, text].filter(Boolean).join(' — ');
        if (interp?.specification && !conv.data.specification) conv.data.specification = interp.specification;
      }
      advanceQualification();
      return result(true);
    }

    case 'INFO_QUESTION': {
      if (text.length < 3) return invalid(copy.tooShort(conv.lang));
      conv.data.question = text;
      if (interp?.product) conv.data.product = conv.data.product ?? interp.product;
      if (interp?.category) conv.data.category = conv.data.category ?? interp.category;
      if (interp?.location) conv.data.location = conv.data.location ?? interp.location;
      advanceQualification();
      return result(true);
    }

    case 'CALLBACK_REASON': {
      if (text.length < 3) return invalid(copy.tooShort(conv.lang));
      conv.data.reason = text;
      if (interp?.product) conv.data.product = conv.data.product ?? interp.product;
      if (interp?.category) conv.data.category = conv.data.category ?? interp.category;
      if (interp?.location) conv.data.location = conv.data.location ?? interp.location;
      if (interp?.callbackTime) conv.data.callbackTime = interp.callbackTime;
      advanceQualification();
      return result(true);
    }

    case 'CALLBACK_TIME': {
      let time: CallbackTime | undefined;
      if (buttonId) time = buttonId.split(':')[1] as CallbackTime;
      else time = interp?.callbackTime;
      if (!time) return invalid();
      conv.data.callbackTime = time;
      advanceQualification();
      return result(true);
    }

    case 'COMPLETED':
    case 'REFUSED': {
      if (buttonId === 'restart' || /^(nouvelle|recommencer|restart|جديد)/.test(n)) {
        effects.push({ type: 'RESTART' });
        return result(true, 'restart');
      }
      replies.push(...promptFor(conv, ctx));
      return result(true, 'terminal_reply');
    }
  }
}

/** Store what the interpreter understood from a free-text first message (no personal data). */
function prefill(conv: Conversation, interp: Interpretation, text: string) {
  if (interp.product) conv.data.product = interp.product;
  if (interp.category) conv.data.category = interp.category;
  if (interp.specification) conv.data.specification = interp.specification;
  if (interp.quantity !== undefined) conv.data.quantity = interp.quantity;
  if (interp.location) conv.data.location = interp.location;
  if (interp.callbackTime) conv.data.callbackTime = interp.callbackTime;
  if (interp.intent === 'INFO' && text.length > 15) conv.data.question = text;
}

/** "Je cherche un climatiseur pour mon bureau, livraison rapide" → "Pour mon bureau, livraison rapide". */
export function extractDetails(text: string): string | null {
  const m = /\b(pour|avec|sans|livr\w*|install\w*|urgent|avant|d[eè]s que|budget|marque|garantie)\b[\s\S]*$/i.exec(text);
  if (!m) return null;
  const clause = m[0].replace(/[.!?\s]+$/, '').trim();
  if (clause.length < 6) return null;
  return capitalize(clause.slice(0, 200));
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
