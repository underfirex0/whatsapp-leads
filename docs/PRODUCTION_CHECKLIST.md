# Production integration checklist

The business logic does not change. Each item replaces an adapter behind an existing interface, or adds infrastructure around `AppService`.

## 1. Backend host

- [ ] Move `src/core` into a server runtime (Node service, Supabase Edge Functions or similar). It has no browser dependencies.
- [ ] Expose `AppService` use cases as authenticated API endpoints for the admin and company UIs. Replace direct `useApp()` calls with an API client of the same shape.
- [ ] Replace the `withLock` in-process queue with a per-sender queue or a DB advisory lock if you run several instances.

## 2. Supabase / PostgreSQL

- [ ] Create one table per entity in `types.ts` (`companies`, `plans`, `contacts`, `conversations`, `messages`, `demands`, `distributions`, `tracking_events`, `activity`, `inbound_events`, `settings`, `categories`). Use `jsonb` for `conversation.data`, `company.subscription` and `company.notes` (or normalise them).
- [ ] Constraints: `unique(inbound_events.external_id)`, `unique(demands.conversation_id)`, `unique(contacts.wa_number)`, a sequence for `demands.number`, FKs for every `*_id`.
- [ ] Implement `SupabaseRepository implements Repository`:
  - `claimInboundEvent` → `insert … on conflict do nothing returning`
  - `insertDemand` → insert using the sequence; map a unique violation to `DuplicateError`
- [ ] Row Level Security: admins see everything; a company user sees only its `distributions` and the linked demand fields.
- [ ] Optionally move `computeMetrics` to SQL views for large volumes.
- [ ] Data retention policy for refused or abandoned conversations (personal data).

## 3. Meta WhatsApp Cloud API

- [ ] Meta Business account, verified business, WhatsApp Business number for the central Telecontact line. Store the token and phone-number id as secrets.
- [ ] `MetaCloudTransport implements MessagingTransport`: `POST /{phone-number-id}/messages`. Text → `type: text`. Up to 3 buttons → `interactive.button` (titles ≤ 20 chars: shorten labels in `copy.ts`). More options → `interactive.list`.
- [ ] Webhook endpoint: verify the `hub.challenge` handshake and the `X-Hub-Signature-256` signature. Map `messages[]` into `InboundEvent`:
  - `id` → `externalId`, `from` → `from`, `profile.name` → `profileName`
  - `text.body` → `text`
  - `interactive.button_reply.id` → `button.id`, `context.id` (the wamid of the prompt) → `button.replyTo`. Store the outbound provider wamid on `Message.externalId` and look prompts up by it.
  - `referral` (click-to-WhatsApp ads), or a short reference code in the pre-filled text, → `referral`
- [ ] Return 200 quickly; process asynchronously. Duplicates are already handled by the ledger.
- [ ] Handle `statuses[]` webhooks to update `deliveryStatus` (sent/delivered/read/failed).
- [ ] Company notifications are usually outside the 24-hour window. Create and approve a **utility message template** ("Nouvelle demande Telecontact…") and send distributions as template messages.
- [ ] Opt-in records for companies receiving notifications. Honour STOP/unsubscribe.

## 4. Telecontact fiches

- [ ] On each real fiche, add the WhatsApp button linking to `https://wa.me/<central>?text=<template>` (see `ENTRY_TEMPLATE`), and log `FICHE_VIEW`/`WA_CLICK` through a tracking endpoint.
- [ ] For deterministic attribution, append a short reference to the pre-filled text (e.g. `Réf. F1040`) and extend `ENTRY_TEMPLATE_RE`, or use click-to-WhatsApp referrals. Template parsing alone breaks if two companies share a name and city.
- [ ] Sync companies from the Telecontact directory (fiche id, name, city, sector, products) into `companies`.

## 5. AI provider (optional)

- [ ] `LlmInterpreter implements Interpreter`: prompt for strict JSON, then always pass through `validateInterpretation`. Keep `RuleBasedInterpreter` as a fallback on timeout or error (the service already continues without suggestions).
- [ ] Log prompts and outputs without personal data; set a timeout and budget.

## 6. Subscriptions & distribution

- [ ] Company authentication (magic link / OTP to the WhatsApp number) for the workspace.
- [ ] Billing provider for paid plans; webhook → `setSubscription`.
- [ ] Enforce `maxCities` from plans when companies edit coverage.
- [ ] Notification fallback (SMS/e-mail) when WhatsApp delivery fails repeatedly.

## 7. Compliance & operations

- [ ] Morocco law 09-08 / CNDP declaration for the processing; publish the privacy page linked in the consent message.
- [ ] Consent proof: keep `consentAt`, the consent message id and the policy version.
- [ ] Monitoring: webhook error rate, delivery failures, queue lag. Alert on failed distributions.
- [ ] Admin roles and audit (the `activity` log already records actor and action).
- [ ] Remove the demo tools (simulator, reset, inactivity simulation) from production builds.
