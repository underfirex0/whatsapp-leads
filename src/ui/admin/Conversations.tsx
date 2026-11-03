import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowRight, ChevronRight, MessagesSquare, Search, ShieldCheck, ShieldX } from 'lucide-react';
import { useLive } from '../runtime';
import { Avatar, Badge, EmptyState, ErrorState, Notice, PageSkeleton, RelTime, StatusBadge, TableSkeleton, Tabs, fmt, useDebounced } from '../components';
import { CONVERSATION_STATUS, INTENT_LABEL } from '../../core/status';
import { STATE_LABELS, PERSONAL_DATA_STATES } from '../../core/conversation/engine';
import { CALLBACK_LABELS } from '../../core/conversation/copy';
import { formatPhone } from '../../core/phone';
import { normalize } from '../../core/text';
import type { ConversationStatus } from '../../core/types';
import { Timeline } from './Timeline';

export function ConversationsList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('statut') ?? 'all') as ConversationStatus | 'all';
  const q = params.get('q') ?? '';
  const dq = useDebounced(q);
  const live = useLive(async (app) => {
    const [conversations, contacts, companies, messages] = await Promise.all([app.repo.listConversations(), app.repo.listContacts(), app.repo.listCompanies(), app.repo.listAllMessages()]);
    const counts = new Map<string, number>();
    const last = new Map<string, string>();
    for (const m of messages) {
      counts.set(m.conversationId, (counts.get(m.conversationId) ?? 0) + 1);
      if (m.direction === 'IN') last.set(m.conversationId, m.body);
    }
    return { conversations, contacts, companies, counts, last };
  });

  const rows = useMemo(() => {
    if (!live.data) return [];
    const { conversations, contacts, companies, counts, last } = live.data;
    const nq = normalize(dq);
    return conversations
      .map((c) => ({ c, contact: contacts.find((x) => x.id === c.contactId), company: companies.find((x) => x.id === c.companyId), count: counts.get(c.id) ?? 0, last: last.get(c.id) ?? '' }))
      .filter((r) => !nq || normalize([r.contact?.name, r.contact?.waNumber, r.company?.name, r.last].filter(Boolean).join(' ')).includes(nq))
      .sort((a, b) => b.c.updatedAt.localeCompare(a.c.updatedAt));
  }, [live.data, dq]);
  const visible = rows.filter((r) => status === 'all' || r.c.status === status);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Conversations</h1>
          <div className="desc">Échanges WhatsApp avec le numéro central Telecontact (simulé).</div>
        </div>
      </div>
      <Tabs
        value={status}
        onChange={(v) => set('statut', v === 'all' ? '' : v)}
        tabs={[
          { value: 'all', label: 'Toutes', count: rows.length },
          ...(Object.keys(CONVERSATION_STATUS) as ConversationStatus[]).map((s) => ({ value: s, label: CONVERSATION_STATUS[s].label, count: rows.filter((r) => r.c.status === s).length })),
        ]}
      />
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder="Client, numéro, entreprise, message…" value={q} onChange={(e) => set('q', e.target.value)} aria-label="Rechercher une conversation" />
          </div>
          <span className="subtle small" style={{ marginLeft: 'auto' }}>
            {visible.length} conversation{visible.length > 1 ? 's' : ''}
          </span>
        </div>
        {live.loading ? (
          <TableSkeleton />
        ) : live.error ? (
          <ErrorState error={live.error} onRetry={live.reload} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<MessagesSquare size={20} />} title="Aucune conversation">
            Ouvrez une fiche Telecontact et cliquez sur le bouton WhatsApp pour en démarrer une.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Entreprise demandée</th>
                  <th>Besoin</th>
                  <th>Étape</th>
                  <th>Statut</th>
                  <th className="num">Messages</th>
                  <th>Activité</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ c, contact, company, count, last }) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/admin/conversations/${c.id}`)}>
                    <td>
                      <span className="primary-cell">{contact?.name ?? <span className="subtle">Anonyme</span>}</span>
                      <span className="sub mono">{formatPhone(c.waNumber)}</span>
                    </td>
                    <td>{company?.name ?? <span className="subtle">Non identifiée</span>}</td>
                    <td style={{ maxWidth: 260 }}>
                      <div className="ellipsis">{c.intent ? INTENT_LABEL[c.intent].label : '—'}</div>
                      <span className="sub ellipsis">{last}</span>
                    </td>
                    <td className="small">{STATE_LABELS[c.state]}</td>
                    <td>
                      <StatusBadge map={CONVERSATION_STATUS} value={c.status} />
                    </td>
                    <td className="num">{count}</td>
                    <td className="subtle small">
                      <RelTime iso={c.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function ConversationDetail() {
  const { id = '' } = useParams();
  const live = useLive(
    async (app) => {
      const conv = await app.repo.getConversation(id);
      if (!conv) return null;
      const [messages, contact, company, demand, activity] = await Promise.all([
        app.repo.listMessages(id),
        app.repo.getContact(conv.contactId),
        conv.companyId ? app.repo.getCompany(conv.companyId) : Promise.resolve(null),
        app.repo.getDemandByConversation(id),
        app.repo.listActivity({ conversationId: id }),
      ]);
      return { conv, messages: messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), contact, company, demand, activity };
    },
    [id],
  );
  if (live.loading) return <PageSkeleton />;
  if (live.error) return <ErrorState error={live.error} onRetry={live.reload} />;
  if (!live.data)
    return (
      <div className="page">
        <EmptyState title="Conversation introuvable" action={<Link className="btn" to="/admin/conversations">Retour</Link>} />
      </div>
    );
  const { conv, messages, contact, company, demand, activity } = live.data;
  const d = conv.data;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/admin/conversations">Conversations</Link>
        <ChevronRight size={13} />
        <span className="mono">{conv.id}</span>
      </div>
      <div className="page-h">
        <div>
          <div className="row wrap">
            <h1>{contact?.name ?? 'Client anonyme'}</h1>
            <StatusBadge map={CONVERSATION_STATUS} value={conv.status} />
            {conv.intent && <Badge tone="outline">{INTENT_LABEL[conv.intent].label}</Badge>}
          </div>
          <div className="desc">
            {formatPhone(conv.waNumber)} · démarrée {fmt.dateTime(conv.createdAt)} · étape « {STATE_LABELS[conv.state]} »
          </div>
        </div>
        <div className="actions">
          {demand && (
            <Link to={`/admin/demandes/${demand.id}`} className="btn primary">
              Demande #{demand.number} <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>

      <div className="detail">
        <section className="card">
          <div className="card-h">
            <h3>Transcription</h3>
            <span className="sub">{messages.length} messages</span>
          </div>
          <div className="wa-body" style={{ maxHeight: 640, borderRadius: '0 0 12px 12px' }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: 'contents' }}>
                <div className={`bubble ${m.direction === 'IN' ? 'out' : 'in'} ${m.deliveryStatus === 'FAILED' ? 'failed' : ''}`}>
                  {m.body}
                  {m.buttons && (
                    <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                      {m.buttons.map((b) => (
                        <span key={b.id} className="badge outline square">
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="meta">
                    {m.payload && <span className="mono">{m.payload} · </span>}
                    {fmt.time(m.createdAt)} · {m.state}
                    {m.deliveryStatus === 'FAILED' && <span style={{ color: 'var(--danger)' }}> · échec</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="col">
          <section className="card">
            <div className="card-h">
              <h3>Contexte</h3>
            </div>
            <div className="card-b">
              <dl className="kv">
                <dt>Entreprise</dt>
                <dd>{company ? <Link to={`/admin/entreprises/${company.id}`} className="strong">{company.name}</Link> : 'Non identifiée'}</dd>
                <dt>Fiche</dt>
                <dd className="mono">{conv.ficheId ?? '—'}</dd>
                <dt>Ville fiche</dt>
                <dd>{conv.city ?? '—'}</dd>
                <dt>Attribution</dt>
                <dd>{conv.resolution === 'referral' ? 'Référence de clic (déterministe)' : conv.resolution === 'template' ? 'Message pré-rempli' : 'Non résolue'}</dd>
                <dt>Clic</dt>
                <dd className="mono">{conv.clickId ?? '—'}</dd>
                <dt>Source</dt>
                <dd>Telecontact</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>Données collectées</h3>
            </div>
            <div className="card-b">
              {conv.consent === false ? (
                <Notice tone="danger" icon={<ShieldX size={16} />} title="Consentement refusé">
                  Collecte arrêtée le {fmt.dateTime(conv.consentAt)}. Aucune donnée personnelle n’est conservée.
                </Notice>
              ) : (
                <>
                  {conv.consent && (
                    <div className="row small" style={{ marginBottom: 10, color: 'var(--success)' }}>
                      <ShieldCheck size={15} /> Consentement accepté {fmt.dateTime(conv.consentAt)}
                    </div>
                  )}
                  {conv.consent === null && PERSONAL_DATA_STATES.includes(conv.state) === false && (
                    <div className="subtle small" style={{ marginBottom: 10 }}>
                      Consentement non encore donné.
                    </div>
                  )}
                  <dl className="kv">
                    <dt>Nom</dt>
                    <dd>{d.name ?? '—'}</dd>
                    <dt>Téléphone</dt>
                    <dd>{formatPhone(d.phone)}</dd>
                    <dt>Produit</dt>
                    <dd>{[d.product, d.specification].filter(Boolean).join(' ') || '—'}</dd>
                    <dt>Quantité</dt>
                    <dd>{d.quantity ?? '—'}</dd>
                    <dt>Ville</dt>
                    <dd>{d.location ?? '—'}</dd>
                    {d.question && (
                      <>
                        <dt>Question</dt>
                        <dd>{d.question}</dd>
                      </>
                    )}
                    {d.reason && (
                      <>
                        <dt>Motif</dt>
                        <dd>{d.reason}</dd>
                      </>
                    )}
                    {d.callbackTime && (
                      <>
                        <dt>Rappel</dt>
                        <dd>{CALLBACK_LABELS[d.callbackTime]}</dd>
                      </>
                    )}
                    {d.details && (
                      <>
                        <dt>Précisions</dt>
                        <dd>{d.details}</dd>
                      </>
                    )}
                  </dl>
                </>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>Journal du moteur</h3>
            </div>
            <div className="card-b">
              <Timeline entries={activity} />
            </div>
          </section>

          {contact && (
            <section className="card">
              <div className="card-b row">
                <Avatar name={contact.name ?? '?'} />
                <div className="small">
                  <div className="strong">{contact.name ?? 'Contact sans nom'}</div>
                  <div className="subtle">Contact créé {fmt.date(contact.createdAt)} · profil WhatsApp « {contact.profileName || '—'} »</div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
