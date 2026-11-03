import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { MapPin, Phone, Globe, Mail, Search, Star, MessageCircle, ExternalLink, UserRoundPlus, Copy, Clock4, WifiOff, ArrowRight } from 'lucide-react';
import { useApp, useLive, useRuntime, useSimIdentity, useToast } from '../runtime';
import { Badge, Button, EmptyState, Skeleton, fmt } from '../components';
import { WhatsAppSimulator } from '../whatsapp/WhatsAppSimulator';
import { CITY_NAMES, categoryLabel } from '../../core/catalog';
import { formatPhone } from '../../core/phone';
import { normalize } from '../../core/text';
import { STATE_LABELS } from '../../core/conversation/engine';
import type { InboundEvent } from '../../core/services/app';

function SiteHeader({ q, setQ, city, setCity }: { q?: string; setQ?: (v: string) => void; city?: string; setCity?: (v: string) => void }) {
  const navigate = useNavigate();
  const [local, setLocal] = useState(q ?? '');
  return (
    <header className="site-header">
      <div className="inner">
        <Link to="/" className="site-logo" aria-label="Telecontact — accueil">
          <span className="mark">T</span>
          <span>
            telecontact
            <small>L’annuaire des professionnels au Maroc</small>
          </span>
        </Link>
        <form
          className="site-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (setQ) setQ(local);
            else navigate(`/?q=${encodeURIComponent(local)}`);
          }}
        >
          <input className="input" placeholder="Entreprise, produit, service…" value={local} onChange={(e) => setLocal(e.target.value)} aria-label="Rechercher" />
          {setCity && (
            <select className="select" value={city} onChange={(e) => setCity(e.target.value)} aria-label="Ville">
              <option value="">Toutes les villes</option>
              {CITY_NAMES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <button className="btn primary" type="submit">
            <Search size={16} />
            <span className="sr-only">Rechercher</span>
          </button>
        </form>
      </div>
    </header>
  );
}

export function DirectoryHome() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const city = params.get('ville') ?? '';
  const cat = params.get('cat') ?? '';
  const live = useLive(async (app) => ({ companies: await app.repo.listCompanies(), categories: await app.repo.listCategories() }));
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const results = useMemo(() => {
    const list = live.data?.companies ?? [];
    const nq = normalize(q);
    return list
      .filter((c) => !city || c.city === city)
      .filter((c) => !cat || c.sector === cat || c.acceptedCategories.includes(cat))
      .filter((c) => !nq || normalize([c.name, c.activity, c.city, ...c.products].join(' ')).includes(nq))
      .sort((a, b) => (a.name === 'SpaceFix' ? -1 : b.name === 'SpaceFix' ? 1 : b.rating - a.rating));
  }, [live.data, q, city, cat]);

  return (
    <div className="site">
      <SiteHeader q={q} setQ={(v) => set('q', v)} city={city} setCity={(v) => set('ville', v)} />
      <main className="site-main">
        <section className="hero">
          <h1>Trouvez le bon professionnel, contactez-le sur WhatsApp en un clic.</h1>
          <p>Prototype de démonstration : choisissez une fiche, cliquez sur « Contacter sur WhatsApp » et suivez la demande jusqu’à l’entreprise.</p>
        </section>
        <div className="cat-chips">
          <button className="chip-toggle" aria-pressed={!cat} onClick={() => set('cat', '')}>
            Toutes les activités
          </button>
          {live.data?.categories.map((c) => (
            <button key={c.id} className="chip-toggle" aria-pressed={cat === c.id} onClick={() => set('cat', cat === c.id ? '' : c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="muted small">
            {live.loading ? 'Recherche…' : `${results.length} professionnel${results.length > 1 ? 's' : ''}${city ? ` à ${city}` : ''}`}
          </span>
        </div>
        {live.loading ? (
          <div className="listing">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="listing-card">
                <Skeleton w="50%" h={16} />
                <Skeleton w="80%" />
                <Skeleton w="35%" />
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="Aucun résultat" action={<Button onClick={() => setParams({})}>Effacer la recherche</Button>}>
            Essayez un autre mot-clé ou une autre ville.
          </EmptyState>
        ) : (
          <div className="listing">
            {results.map((c) => (
              <Link key={c.id} to={`/fiche/${c.slug}`} className="listing-card">
                <div className="row">
                  <h3 className="grow">{c.name}</h3>
                  {c.name === 'SpaceFix' && <Badge tone="accent">Parcours démo</Badge>}
                </div>
                <div className="muted small">{c.activity}</div>
                <div className="meta">
                  <span>
                    <MapPin size={13} /> {c.city}
                  </span>
                  <span>
                    <Star size={13} /> {c.rating.toFixed(1)}
                  </span>
                  <span style={{ color: 'var(--wa-dark)' }}>
                    <MessageCircle size={13} /> WhatsApp
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export function FichePage() {
  const { slug = '' } = useParams();
  const app = useApp();
  const runtime = useRuntime();
  const toast = useToast();
  const { identity, renew } = useSimIdentity();
  const [params, setParams] = useSearchParams();
  const [chat, setChat] = useState<{ open: boolean; conversationId: string | null; prefill?: string; referral?: InboundEvent['referral'] }>({ open: false, conversationId: null });
  const [lastEvent, setLastEvent] = useState<InboundEvent | null>(null);
  const viewed = useRef<string | null>(null);

  const live = useLive(async (a) => {
    const company = await a.repo.getCompanyBySlug(slug);
    const categories = await a.repo.listCategories();
    return { company, categories };
  }, [slug]);
  const company = live.data?.company ?? null;

  // Current conversation for this simulated customer & company (to resume after refresh).
  const convLive = useLive(async (a) => {
    if (!chat.conversationId) return null;
    return a.repo.getConversation(chat.conversationId);
  }, [chat.conversationId]);
  const conv = convLive.data ?? null;

  useEffect(() => {
    if (!company || viewed.current === company.id) return;
    viewed.current = company.id;
    void app.recordFicheView(company.id, identity.visitorId);
    // Restore an open chat after a refresh.
    const wanted = params.get('chat');
    if (wanted) setChat({ open: true, conversationId: wanted });
  }, [company, app, identity.visitorId, params]);

  async function openWhatsApp() {
    if (!company) return;
    const click = await app.clickWhatsApp(company.id, identity.visitorId);
    const existing = await app.findOpenConversation(identity.waNumber, company.id);
    setChat({ open: true, conversationId: existing?.id ?? null, prefill: click.text, referral: { ficheId: click.ficheId, clickId: click.clickId } });
    if (existing) setParams({ chat: existing.id }, { replace: true });
    // On narrow screens the chat sits below the fiche: bring it into view.
    if (window.innerWidth < 1000) requestAnimationFrame(() => document.querySelector('.fiche-aside')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function onConversation(id: string) {
    setChat((c) => ({ ...c, conversationId: id, prefill: undefined, referral: undefined }));
    setParams({ chat: id }, { replace: true });
  }

  async function replayLastEvent() {
    if (!lastEvent) return;
    const res = await app.receiveInbound(lastEvent);
    toast({ kind: res.duplicate ? 'success' : 'info', message: res.duplicate ? 'Doublon reçu et ignoré : aucune donnée créée' : 'Événement rejoué' });
  }

  if (live.loading) {
    return (
      <div className="site">
        <SiteHeader />
        <main className="site-main">
          <Skeleton w={300} h={28} />
          <Skeleton w={420} style={{ marginTop: 12 }} />
        </main>
      </div>
    );
  }
  if (!company) {
    return (
      <div className="site">
        <SiteHeader />
        <main className="site-main">
          <EmptyState title="Fiche introuvable" action={<Link className="btn" to="/">Retour à l’annuaire</Link>}>
            Cette entreprise n’existe pas ou a été supprimée.
          </EmptyState>
        </main>
      </div>
    );
  }

  return (
    <div className="site">
      <SiteHeader />
      <main className="site-main">
        <div className="breadcrumb">
          <Link to="/">Annuaire</Link> / <Link to={`/?ville=${company.city}`}>{company.city}</Link> / <span>{company.name}</span>
        </div>
        <div className="fiche">
          <div>
            <div className="fiche-head">
              <div className="logo">{company.name.slice(0, 2).toUpperCase()}</div>
              <div className="grow">
                <h1>{company.name}</h1>
                <div className="row wrap muted" style={{ marginTop: 4 }}>
                  <span>{company.activity}</span>·<span>{categoryLabel(live.data!.categories, company.sector)}</span>
                </div>
                <div className="row wrap small" style={{ marginTop: 8 }}>
                  <Badge tone="neutral">
                    <MapPin size={12} /> {company.city}
                  </Badge>
                  <Badge tone="neutral">
                    <Star size={12} /> {company.rating.toFixed(1)} / 5
                  </Badge>
                  <Badge tone="outline">Fiche {company.ficheId}</Badge>
                </div>
              </div>
            </div>

            <p style={{ marginTop: 20, fontSize: 15, maxWidth: 640 }}>{company.description}</p>

            <div className="fiche-contact">
              <span className="btn">
                <Phone size={15} /> {formatPhone(company.phone)}
              </span>
              <span className="btn">
                <Mail size={15} /> {company.email}
              </span>
              <span className="btn">
                <Globe size={15} /> {company.website}
              </span>
            </div>

            <div className="section-title">Produits et services</div>
            <div className="tags">
              {company.products.map((p) => (
                <span key={p} className="tag-pill">
                  {p}
                </span>
              ))}
            </div>

            <div className="section-title">Adresse</div>
            <div className="muted">{company.address}</div>

            <div className="how">
              {[
                ['Le visiteur clique', 'Le bouton WhatsApp ouvre une conversation avec le numéro central Telecontact.'],
                ['Le bot qualifie', 'Besoin, consentement, nom, numéro et détails — en 1 minute.'],
                ['Telecontact distribue', 'La demande est proposée à l’entreprise demandée ou à des professionnels pertinents.'],
                ['L’entreprise reçoit', 'Notification WhatsApp et suivi dans son espace.'],
              ].map(([t, d], i) => (
                <div key={t}>
                  <div className="n">{i + 1}</div>
                  <b>{t}</b>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="fiche-aside">
            {!chat.open ? (
              <div className="card" style={{ width: '100%', padding: 16 }}>
                <button className="wa-cta" onClick={openWhatsApp}>
                  <span className="ic">
                    <MessageCircle size={22} />
                  </span>
                  <span className="grow">
                    <b>Contacter sur WhatsApp</b>
                    <span>Réponse rapide · {company.name}</span>
                  </span>
                </button>
                <p className="subtle small" style={{ marginTop: 10 }}>
                  Le message est envoyé au service WhatsApp de Telecontact, qui transmet votre demande à {company.name} ou à des professionnels capables d’y répondre.
                </p>
              </div>
            ) : (
              <>
                <WhatsAppSimulator
                  key={identity.waNumber}
                  conversationId={chat.conversationId}
                  waNumber={identity.waNumber}
                  profileName={identity.profileName}
                  prefill={chat.prefill}
                  referral={chat.referral}
                  onConversation={onConversation}
                  onEvent={(e) => setLastEvent(e)}
                  onClose={() => {
                    setChat({ open: false, conversationId: null });
                    setParams({}, { replace: true });
                  }}
                />
                <div className="simtools">
                  <div className="row">
                    <span className="strong">Outils de simulation</span>
                    <span className="mono subtle">{formatPhone(identity.waNumber)}</span>
                  </div>
                  {conv && (
                    <div className="subtle" style={{ marginTop: 4 }}>
                      État : <b className="muted">{STATE_LABELS[conv.state]}</b> · {conv.status === 'ABANDONED' ? 'abandonnée' : conv.status.toLowerCase()}
                      {conv.demandId && ' · demande créée'}
                    </div>
                  )}
                  <div className="btns">
                    <Button size="sm" icon={<Copy size={13} />} disabled={!lastEvent} onClick={replayLastEvent} title="Renvoie exactement le même événement entrant (même identifiant)">
                      Rejouer le dernier événement
                    </Button>
                    <Button
                      size="sm"
                      icon={<WifiOff size={13} />}
                      onClick={() => {
                        runtime.transport.forceFailures(1);
                        toast({ kind: 'info', message: 'Le prochain message du bot échouera' });
                      }}
                    >
                      Faire échouer le prochain envoi
                    </Button>
                    <Button
                      size="sm"
                      icon={<Clock4 size={13} />}
                      disabled={!conv || conv.status !== 'ACTIVE'}
                      onClick={async () => {
                        await app.simulateInactivity(conv!.id, 45);
                        setChat({ open: false, conversationId: null });
                        setParams({}, { replace: true });
                        toast({ kind: 'info', message: 'Client parti 45 min : conversation abandonnée. Recliquez sur WhatsApp pour reprendre.' });
                      }}
                    >
                      Partir 45 min
                    </Button>
                    <Button
                      size="sm"
                      icon={<UserRoundPlus size={13} />}
                      onClick={() => {
                        renew();
                        setChat({ open: false, conversationId: null });
                        setParams({}, { replace: true });
                        toast({ kind: 'info', message: 'Nouveau client simulé (nouveau numéro WhatsApp)' });
                      }}
                    >
                      Nouveau client
                    </Button>
                    {conv?.demandId && (
                      <Link className="btn sm primary" to={`/admin/demandes/${conv.demandId}`}>
                        Voir la demande dans l’admin <ArrowRight size={13} />
                      </Link>
                    )}
                    {conv && !conv.demandId && (
                      <Link className="btn sm" to={`/admin/conversations/${conv.id}`}>
                        Voir dans l’admin <ExternalLink size={13} />
                      </Link>
                    )}
                  </div>
                  {conv && <div className="xs subtle" style={{ marginTop: 8 }}>Dernière activité {fmt.relative(conv.updatedAt)}</div>}
                </div>
              </>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
