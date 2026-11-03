import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, BadgeCheck, Check, CheckCheck, SendHorizontal, AlertCircle, Clock } from 'lucide-react';
import type { InboundEvent, InboundResult } from '../../core/services/app';
import type { Conversation, Message } from '../../core/types';
import { useAction, useApp, useLive, useToast } from '../runtime';
import { fmt } from '../components';
import { hasArabic } from '../../core/text';

/**
 * Simulated WhatsApp client. It only produces inbound events (exactly what
 * the Meta webhook would deliver) and renders what the store contains — all
 * conversation logic lives in the core engine.
 */

export interface SimulatorProps {
  conversationId: string | null;
  waNumber: string;
  profileName: string;
  /** Text pre-filled by the wa.me link (sent by the customer, not automatically). */
  prefill?: string;
  /** Referral metadata attached to the first message after a fiche click. */
  referral?: InboundEvent['referral'];
  onConversation: (id: string) => void;
  onEvent?: (event: InboundEvent, result: InboundResult) => void;
  onClose?: () => void;
  centralName?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let extSeq = 0;
const newExternalId = () => `wamid.SIM${Date.now().toString(36)}${(extSeq++).toString(36)}`;

export function WhatsAppSimulator({ conversationId, waNumber, profileName, prefill, referral, onConversation, onEvent, onClose, centralName = 'Telecontact' }: SimulatorProps) {
  const app = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState(prefill ?? '');
  const [pending, setPending] = useState<{ body: string } | null>(null);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const referralRef = useRef(referral);
  referralRef.current = referral;

  useEffect(() => setDraft(prefill ?? ''), [prefill]);

  const live = useLive(
    async (a) => {
      if (!conversationId) return { conv: null as Conversation | null, messages: [] as Message[] };
      const [conv, messages] = await Promise.all([a.repo.getConversation(conversationId), a.repo.listMessages(conversationId)]);
      return { conv, messages: messages.sort((x, y) => x.createdAt.localeCompare(y.createdAt)) };
    },
    [conversationId],
  );
  const conv = live.data?.conv ?? null;
  const messages = live.data?.messages ?? [];

  useLayoutEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages.length, pending, typing]);

  const resend = useAction((a, id: string) => a.resendMessage(id), 'Message renvoyé');

  async function deliver(event: Omit<InboundEvent, 'externalId' | 'from' | 'profileName'>, preview: string) {
    if (busy) return;
    setBusy(true);
    setPending({ body: preview });
    setTyping(true);
    try {
      await sleep(550);
      const full: InboundEvent = { externalId: newExternalId(), from: waNumber, profileName, ...event };
      if (!event.button && referralRef.current) full.referral = referralRef.current;
      const res = await app.receiveInbound(full);
      if (res.conversationId && res.conversationId !== conversationId) onConversation(res.conversationId);
      onEvent?.(full, res);
      if (res.note === 'stale_button') toast({ kind: 'info', message: 'Bouton déjà utilisé : clic ignoré par le moteur' });
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message });
    } finally {
      setPending(null);
      setTyping(false);
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function sendText() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void deliver({ text }, text);
  }

  const lastPromptIdx = messages.reduce((acc, m, i) => (m.direction === 'OUT' && m.buttons?.length ? i : acc), -1);
  const chosenByPrompt = new Map<string, string>();
  for (const m of messages) if (m.direction === 'IN' && m.replyTo && m.payload) chosenByPrompt.set(m.replyTo, m.payload);

  let lastDay = '';

  return (
    <div className="phone" aria-label="Simulateur WhatsApp">
      <div className="phone-screen">
        <div className="wa-head">
          {onClose && (
            <button className="btn ghost sm icon" onClick={onClose} aria-label="Quitter la conversation">
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="avatar">T</span>
          <div className="grow">
            <b>
              {centralName} <BadgeCheck size={15} fill="#25d366" color="#fff" />
            </b>
            <span>{typing ? 'en train d’écrire…' : 'Compte professionnel · simulé'}</span>
          </div>
        </div>

        <div className="wa-body" ref={bodyRef}>
          <div className="wa-sys">🔒 Simulation — aucun message n’est réellement envoyé sur WhatsApp.</div>
          {!conversationId && !pending && (
            <div className="wa-sys">Message pré-rempli par le lien Telecontact. Appuyez sur ➤ pour l’envoyer.</div>
          )}
          {messages.map((m, i) => {
            const day = fmt.date(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const isPrompt = m.direction === 'OUT' && (m.buttons?.length ?? 0) > 0;
            const active = isPrompt && i === lastPromptIdx && conv?.activePromptId === m.id && !busy;
            const chosen = chosenByPrompt.get(m.id);
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && <div className="wa-day">{day}</div>}
                <div className={`bubble ${m.direction === 'IN' ? 'out' : 'in'} ${m.deliveryStatus === 'FAILED' ? 'failed' : ''}`} dir={hasArabic(m.body) && !/[a-z]{3}/i.test(m.body) ? 'rtl' : undefined}>
                  <Linkified text={m.body} />
                  <div className="meta">
                    {fmt.time(m.createdAt)}
                    {m.direction === 'IN' && <CheckCheck size={14} className="read" />}
                  </div>
                  {m.deliveryStatus === 'FAILED' && (
                    <div className="fail">
                      <AlertCircle size={13} /> Non délivré (simulation)
                      <button onClick={() => resend.run(m.id)}>Renvoyer</button>
                    </div>
                  )}
                </div>
                {isPrompt && (
                  <div className="wa-buttons">
                    {m.buttons!.map((b) => (
                      <button
                        key={b.id}
                        disabled={!active}
                        className={chosen === b.id ? 'chosen' : ''}
                        onClick={() => void deliver({ button: { id: b.id, replyTo: m.id } }, b.label)}
                        title={!active ? 'Ce choix n’est plus actif' : undefined}
                      >
                        {chosen === b.id && <Check size={13} style={{ marginRight: 4, verticalAlign: -2 }} />}
                        {b.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {pending && (
            <div className="bubble out" style={{ opacity: 0.85 }}>
              {pending.body}
              <div className="meta">
                <Clock size={11} />
              </div>
            </div>
          )}
          {typing && (
            <div className="wa-typing" aria-label="Le bot écrit">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>

        <div className="wa-input">
          <textarea
            ref={inputRef}
            value={draft}
            placeholder="Message"
            aria-label="Votre message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
            rows={draft.length > 60 ? 3 : 1}
            style={{ height: draft.length > 60 ? 76 : 40 }}
          />
          <button onClick={sendText} disabled={!draft.trim() || busy} aria-label="Envoyer">
            <SendHorizontal size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

