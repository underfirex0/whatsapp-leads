# Architecture & implementation

## 1. Repository assessment (starting point)

The repository contained only a one-line `README.md` on an initial commit: no framework, code, storage, deployment configuration or earlier WhatsApp integration. Nothing could be reused, so the product was built from scratch.

## 2. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One typed domain model shared by the engine, services, UI and tests. |
| UI | React 19 + React Router 7, Vite | Fast, standard, static build: the prototype can be hosted anywhere. |
| Styling | Hand-written CSS with design tokens | Full control over a restrained identity; no UI-kit look. Inter Variable, self-hosted. |
| Icons | lucide-react | Consistent stroke icons. |
| Tests | Vitest | Runs the pure core in Node, with no browser needed. |
| Persistence (demo) | In-memory repository persisted to `localStorage` | No credentials; survives refreshes; resettable. |

There is no backend for this stage. The **core is pure TypeScript with no browser or React dependency**, so the same code can run inside a Node/edge webhook handler later. This is the simplest robust choice: one deployable today, and a clean extraction path tomorrow.

## 3. Module boundaries

```
                ┌──────────── UI (React) ────────────┐
                │ directory · WhatsApp simulator ·    │
                │ admin · company workspace           │
                └───────────────┬────────────────────┘
                                │ only calls
                     ┌──────────▼──────────┐
                     │  AppService          │  src/core/services/app.ts
                     │  (use cases)         │
                     └──┬──────┬──────┬────┘
           pure modules │      │      │ ports (interfaces)
   ┌────────────────────┘      │      └──────────────────────────────┐
   │ conversation/engine       │ Repository   MessagingTransport   Interpreter
   │ matching/matching         │   │              │                    │
   │ analytics/metrics         │ MemoryRepo    SimulatedTransport   RuleBasedInterpreter
   │ status, phone, catalog    │ (localStorage)  (today)              (today)
   └───────────────────────────┘ Supabase repo  Meta Cloud API      LLM + validator (later)
```

- **Conversation and business logic** (`conversation/engine.ts`) is a pure function `step(conversation, input, ctx) → {conversation, replies, effects}`. It never touches storage, the transport or the UI.
- **Messaging transport** (`transport/transport.ts`) is an interface with `send()`. The simulated implementation can be forced to fail, or fail at a configurable rate.
- **Data persistence** (`store/repository.ts`) is an async repository interface. Each method maps to one table query; idempotency maps to unique constraints.
- **AI interpretation** (`ai/interpreter.ts`) is an interface. Every output passes through `validateInterpretation` (a trust boundary) before use.
- **Matching and distribution** live in `matching/` and `AppService.distribute`, independent of the frontend. Eligibility is re-checked server-side on every send.
- **Composition root** (`src/core/index.ts`) is the only place that chooses the implementations.

## 4. Data model (`src/core/types.ts`)

```
Company 1─* Distribution *─1 Demand 1─1 Conversation *─1 Contact
   │                            │            │
   └── Subscription (embedded)  │            └─* Message
   └── notes[]                  └── requestedCompanyId → Company
Plan (configurable) ← Company.subscription.planId
TrackingEvent (FICHE_VIEW, WA_CLICK) → Company
ActivityEntry (audit log, cross-linked to demand/company/conversation)
InboundLedgerEntry (processed provider event ids → idempotency)
Settings, Category (reference data)
```

Integrity rules enforced in code and covered by tests:

- One demand per conversation (`insertDemand` rejects duplicates, like a unique index on `conversation_id`).
- A demand always references a valid contact, conversation and requested company.
- Refused consent clears the collected data and never creates a demand.
- A distribution is unique per (demand, company) unless the previous attempt failed.
- Status labels and transitions are defined once in `status.ts`.

## 5. Conversation state machine

```
NEW ──first message──► AWAIT_INTENT ──Prix/Infos/Rappel──► AWAIT_CONSENT
 │   (free text with a detected intent jumps directly to consent)  │
 │                                               Non ◄────────┤────► OK
 │                                                 ▼                ▼
 │                                             REFUSED          AWAIT_NAME
 │                                                                  ▼
 │                                      AWAIT_PHONE_CONFIRM ──autre──► AWAIT_PHONE_INPUT
 │                                                  │ confirmer            │ valid number
 │                                                  ▼                      ▼
 │        PRICE:    PRICE_PRODUCT → PRICE_QUANTITY → PRICE_LOCATION → PRICE_DETAILS ─┐
 │        INFO:     INFO_QUESTION ─────────────────────────────────────────────────┤
 │        CALLBACK: CALLBACK_REASON → CALLBACK_TIME ───────────────────────────────┤
 │                                                                                  ▼
 └──────────────────────────────────────────────────────────────────────────► COMPLETED
```

- Questions already answered are skipped (`nextQualificationState`). For example, "Je cherche un climatiseur 18000 BTU à Casablanca" fills product, spec and city.
- **Duplicate protection**: every inbound provider id is claimed once (`claimInboundEvent`). Button replies are only honoured when they belong to the conversation's `activePromptId`, so repeated or old clicks are ignored and logged. Work is serialised per sender (`withLock`), so concurrent events cannot race.
- **Validation**: names (letters only, prefixes like "je m'appelle" stripped), Moroccan and E.164 phones, quantities 1–10 000, known cities or plausible names. Invalid input re-prompts with a specific message. Button states re-send their buttons.
- **Unexpected text** in a button state falls back to keywords, numbers 1/2/3 and the interpreter, then re-prompts.
- **Resumption**: re-opening the fiche (or simply writing) on an open conversation sends "Rebonjour 👋 Reprenons…" and the current prompt. Idle conversations are swept to `ABANDONED` after the configured delay and become `ACTIVE` again when the customer returns.
- **Terminal states**: after completion or refusal, the bot answers politely and offers "Nouvelle demande"/"Recommencer", which opens a new conversation for the same company.
- **Failed delivery**: an outbound message that fails is stored as `FAILED` with the error and can be resent.
- **Language**: the first prompts are bilingual (FR + AR as specified). Once the customer writes, replies follow their script.

## 6. Qualification & AI

The flow is deterministic. The `RuleBasedInterpreter` extracts intent, product (lexicon in `catalog.ts`), category, specification (`18000 BTU`, `5 kWc`, `55 pouces`…), quantity (explicit numbers vs. "un/une" inferred quantities), city (FR/AR aliases) and callback time. Its output is suggestions only. The engine decides what to store, and `validateInterpretation` drops anything malformed (unknown intents, negative quantities, unknown cities…). A future LLM implementation plugs into the same interface and cannot change state or business rules.

Requested-company identification never relies on AI. The order is: (1) referral metadata from the fiche click (fiche id + click id), (2) exact parse of the pre-filled template ("au sujet de {company} à {city}"), (3) "unresolved", which the admin can assign.

## 7. Matching rules (`matching/matching.ts`)

Each candidate gets points with a visible reason:

| Rule | Effect |
|---|---|
| Requested by the customer | +40, always listed first |
| Category accepted / sector | +30 |
| Product overlap with the company's products | +25 |
| Based in the demand city / covers it | +15 / +10, otherwise **blocked** (alternatives) |
| Accepts the intent (prix/infos/rappel) | otherwise **blocked** |
| Subscription ACTIVE / TRIAL | +20 / +15 → mode *Abonnement* |
| Not subscribed, free opportunity unused | mode *Opportunité gratuite* |
| Not subscribed, free opportunity used / PAUSED | **blocked** |
| Plan monthly quota reached | **blocked** |
| Customer rating | + rating (tie-breaker) |

Irrelevant companies (no category and no product match) are not listed. The recommendation is: send to the requested company if eligible; otherwise up to `maxCompaniesPerDemand` eligible alternatives, subscribers first; otherwise hold for manual review.

## 8. Distribution (`AppService.distribute`)

- **Automatic**: right after qualification, demands go to recommended companies whose subscription and plan allow auto-distribution (setting `autoDistribution`).
- **Manual**: free opportunities are a sales act, so they always wait for an admin. Demands with no eligible company go to *À revoir*.
- Each send re-runs matching and refuses ineligible or duplicate targets. It builds the notification ("Nouvelle demande Telecontact …"), sends it through the transport to the company's WhatsApp number, and records demand, company, destination, date, delivery status, mode, admin action, actor and score.
- A successful free opportunity marks `freeOpportunityUsedAt`. Failed sends can be resent.
- Companies report follow-up (consultée, client contacté, conclue, sans suite, déclinée). Reaching a customer moves the demand to *Prise en charge*.

Demand lifecycle: `NEW → IN_REVIEW ⇄ NEW → DISTRIBUTED → ACCEPTED → CLOSED`, `REJECTED` from NEW/IN_REVIEW. Closed and rejected demands can be re-opened. Transitions are guarded.

## 9. Subscriptions

Plans are configuration (name, price label, monthly quota, max cities, auto-distribution, active). No price is hard-coded. Admins change a company's status/plan, and the change applies to matching immediately. Companies request a plan from their workspace; requests appear under *Abonnements*, alongside prospects who received a free opportunity.

## 10. Analytics

`computeMetrics` derives everything from records over 7/30/90 days: fiche views, WhatsApp clicks, conversations (active, abandoned, refused, completed), consent rate, demands by status/intent/city/category, distributed demands, companies contacted, demands taken in charge, top requested companies (with prospect flag), daily series, and subscription performance (free opportunities, conversions after a free opportunity, deliveries per plan).

## 11. Demo data & reset

`seed/generate.ts` replays ~30 days of traffic with a fixed random seed. Scripted customers open fiches, click WhatsApp, qualify, refuse or abandon. Admins distribute, and companies follow up. All of it goes through the real `AppService`, so every record is consistent. Story beats make the business visible:

- SpaceFix is the most requested company and is not subscribed. Its older demands went to subscribed competitors, and its free opportunity is kept for the live demo.
- ÉlectroMénager Plus received a free opportunity, then subscribed.
- VisioGuard has a pending subscription request. There is one failed delivery to retry, and conversations are in progress right now.

All companies, people and numbers are fictional (`*.example.ma`, +212 6 00 …). **Réinitialiser** in the top bar or *Paramètres* regenerates the dataset. Bumping `DB_VERSION` forces a reseed after model changes.

## 12. What is simulated

| Real system | Simulation |
|---|---|
| Meta WhatsApp Cloud API (customer + company messages) | `SimulatedTransport` with forced or random failures |
| Webhook delivery | the simulator calls `AppService.receiveInbound` with the same event shape |
| Telecontact fiche + wa.me link | in-app directory; the click produces a pre-filled message and referral metadata |
| Database | `MemoryRepository` + `localStorage` |
| AI provider | `RuleBasedInterpreter` |
| Company authentication | company picker ("connexion simulée") |
| Payments | none; subscription changes are admin actions |
| Clock for abandonment | "Partir 45 min" demo tool |

## 13. Known limitations

- Single-browser storage: each browser has its own dataset (tabs stay in sync through `storage` events).
- No authentication or roles. Admin and company spaces are open in the demo.
- The rule-based interpreter covers a curated lexicon. Unknown products are stored verbatim and categorised by the admin.
- Monthly quotas count calendar months. There is no billing, invoicing or plan-limit enforcement on covered cities.
- WhatsApp's 24-hour session window and message templates are not modelled (see checklist).
- Message delivery statuses are immediate (no async status webhooks).
