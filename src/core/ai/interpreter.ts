import type { CallbackTime, Intent } from '../types';
import { INTENTS, CALLBACK_TIMES } from '../types';
import { CITY_NAMES, PRODUCTS, findCity } from '../catalog';
import { hasArabic, normalize } from '../text';

/**
 * AI interpretation port.
 *
 * The conversation engine never depends on an LLM: it calls an Interpreter to
 * turn free text into *suggested* structured fields, then validates them with
 * `validateInterpretation` before anything is stored. A real provider (Claude,
 * etc.) can implement this interface later; its raw output goes through the
 * same validator, so it can never write arbitrary data or change state.
 */
export interface Interpretation {
  intent?: Intent;
  product?: string;
  category?: string;
  specification?: string;
  quantity?: number;
  /** 'explicit' = a number was written; 'article' = inferred from "un/une". */
  quantitySource?: 'explicit' | 'article';
  location?: string;
  callbackTime?: CallbackTime;
  lang: 'fr' | 'ar';
  /** 0..1 — how much of the message was understood. */
  confidence: number;
  /** Which component produced it (for audit). */
  engine: string;
}

export interface InterpretContext {
  /** Conversation state, gives the interpreter a hint of what is expected. */
  expecting?: 'intent' | 'product' | 'question' | 'reason' | 'free';
}

export interface Interpreter {
  readonly name: string;
  interpret(text: string, ctx?: InterpretContext): Promise<Interpretation>;
}

// ───────────────────────────── Validation (trust boundary) ─────────────────────────────

/** Accept unknown input (e.g. LLM JSON) and return only well-formed, bounded fields. */
export function validateInterpretation(raw: unknown, engine = 'unknown'): Interpretation {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;
  const out: Interpretation = {
    lang: r.lang === 'ar' ? 'ar' : 'fr',
    confidence: typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0,
    engine,
  };
  if (typeof r.intent === 'string' && (INTENTS as readonly string[]).includes(r.intent)) out.intent = r.intent as Intent;
  out.product = str(r.product, 80);
  out.category = str(r.category, 40);
  out.specification = str(r.specification, 120);
  if (typeof r.quantity === 'number' && Number.isInteger(r.quantity) && r.quantity >= 1 && r.quantity <= 10000) {
    out.quantity = r.quantity;
    out.quantitySource = r.quantitySource === 'article' ? 'article' : 'explicit';
  }
  const loc = str(r.location, 60);
  if (loc) {
    const known = findCity(loc);
    if (known && CITY_NAMES.includes(known)) out.location = known;
  }
  if (typeof r.callbackTime === 'string' && (CALLBACK_TIMES as readonly string[]).includes(r.callbackTime)) {
    out.callbackTime = r.callbackTime as CallbackTime;
  }
  for (const k of Object.keys(out) as (keyof Interpretation)[]) if (out[k] === undefined) delete out[k];
  return out;
}

// ───────────────────────────── Deterministic implementation ─────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  douze: 12, quinze: 15, vingt: 20, trente: 30, cinquante: 50, cent: 100,
  wahed: 1, jouj: 2, zouj: 2, tlata: 3, rb3a: 4, khamsa: 5,
  'واحد': 1, 'جوج': 2, 'زوج': 2, 'اثنين': 2, 'ثلاثة': 3, 'تلاتة': 3, 'أربعة': 4, 'خمسة': 5,
};

const SPEC_RE =
  /(\d[\d\s.,]*)\s*(btu|kwc|kw|kva|w\b|watts?|cv|m2|m²|m3|pouces|"|go|to|litres?|l\b|mm|cm|m\b|ah|v\b|tonnes?)/i;

const INTENT_PATTERNS: { intent: Intent; re: RegExp }[] = [
  { intent: 'PRICE', re: /\b(prix|tarifs?|combien|cout|devis|cher|budget|promo)\b|بشحال|ثمن|السعر|الثمن|شحال|bchhal|bchal|taman/ },
  { intent: 'CALLBACK', re: /\b(rappel(er|ez)?|rappelle[rz]?|appel(er|ez)?|appelle[rz]?|telephon\w*|joindre|call)\b|اتصلوا|عيطو|عيط|اتصال/ },
  { intent: 'INFO', re: /\b(infos?|informations?|horaires?|adresse|ouvert|disponibles?|disponibilite|delai|garantie|livr\w*|question)\b|معلومات|واش كاين|عنوان/ },
];

const CALLBACK_PATTERNS: { time: CallbackTime; re: RegExp }[] = [
  { time: 'ASAP', re: /des que possible|maintenant|tout de suite|urgent|vite|asap|دابا|حالا|في أقرب وقت/ },
  { time: 'TOMORROW', re: /demain|ghedda|غدا|غدوة/ },
  { time: 'TODAY', re: /aujourd'?hui|ce soir|cet apres|lyoum|اليوم/ },
];

function parseQuantity(n: string, productHit: boolean): { value: number; source: 'explicit' | 'article' } | undefined {
  const v = parseQuantityValue(n);
  if (v !== undefined) return { value: v, source: 'explicit' };
  // A singular article before a recognised product ("un climatiseur") ⇒ 1.
  if (productHit && /\b(un|une|1)\s+(nouveau |nouvelle |petit |grand )?[a-z]/.test(n)) return { value: 1, source: 'article' };
  return undefined;
}

function parseQuantityValue(n: string): number | undefined {
  // "2 climatiseurs", "x3", "quantite : 4", "deux clims"
  const explicit =
    /(?:quantite|qte|qty|nombre)\s*[:=]?\s*(\d{1,5})/.exec(n) ??
    /\bx\s?(\d{1,4})\b/.exec(n) ??
    /\b(\d{1,4})\s*(?:x\b|unites?|pieces?|pcs)/.exec(n);
  if (explicit) return Number(explicit[1]);

  // A small number directly before a product word: "2 climatiseurs".
  const before = /\b(\d{1,3})\s+(?:[a-z؀-ۿ'-]+\s+){0,1}(climatiseurs?|clims?|splits?|panneaux|cameras?|onduleurs?|televiseurs?|refrigerateurs?|ordinateurs?|pc|imprimantes?|machines?|alarmes?|unites?)/.exec(n);
  if (before) return Number(before[1]);

  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    if (value === 1) continue; // "un/une" are articles, handled by the caller.
    const re = /^[a-z0-9]+$/.test(word) ? new RegExp(`(^|\\s)${word}(\\s|$)`) : new RegExp(word);
    if (re.test(n)) return value;
  }
  return undefined;
}

export class RuleBasedInterpreter implements Interpreter {
  readonly name = 'rules-v1';

  async interpret(text: string, ctx: InterpretContext = {}): Promise<Interpretation> {
    return this.interpretSync(text, ctx);
  }

  interpretSync(text: string, _ctx: InterpretContext = {}): Interpretation {
    const n = normalize(text);
    const raw: Record<string, unknown> = { lang: hasArabic(text) ? 'ar' : 'fr' };
    let hits = 0;

    for (const { intent, re } of INTENT_PATTERNS) {
      if (re.test(n)) {
        raw.intent = intent;
        hits++;
        break;
      }
    }

    const product = PRODUCTS.find((p) => p.patterns.some((re) => re.test(n)));
    if (product) {
      raw.product = product.label;
      raw.category = product.category;
      hits++;
    }

    const spec = SPEC_RE.exec(text);
    if (spec) {
      const value = spec[1].replace(/[\s.,]/g, '');
      const unit = spec[2].toUpperCase() === '"' ? 'pouces' : spec[2].toUpperCase().replace('M²', 'm²');
      raw.specification = `${value} ${unit}`.replace(/ M2$/, ' m²');
      hits++;
    }

    // Avoid reading the specification value (e.g. 18000 BTU) as a quantity.
    const nNoSpec = spec ? n.replace(normalize(spec[0]), ' ') : n;
    const qty = parseQuantity(nNoSpec, Boolean(product));
    if (qty !== undefined) {
      raw.quantity = qty.value;
      raw.quantitySource = qty.source;
      hits++;
    }

    const city = findCity(text);
    if (city) {
      raw.location = city;
      hits++;
    }

    for (const { time, re } of CALLBACK_PATTERNS) {
      if (re.test(n)) {
        raw.callbackTime = time;
        break;
      }
    }

    raw.confidence = Math.min(1, hits / 4);
    return validateInterpretation(raw, this.name);
  }
}
