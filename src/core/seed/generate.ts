import type { Company, Database, DistributionOutcome, Intent } from '../types';
import { ManualClock, DAY, HOUR, MINUTE } from '../clock';
import { createSequentialIds } from '../ids';
import { MemoryRepository } from '../store/memory';
import { SimulatedTransport } from '../transport/transport';
import { RuleBasedInterpreter } from '../ai/interpreter';
import { AppService } from '../services/app';
import { SimulatedCustomer, runScript, type CustomerScript } from '../simulation/customer';
import { emptyDatabase } from './base';

/**
 * Generates ~30 days of consistent demo history by running scripted customers
 * through the real application service (engine, matching, distribution).
 * Every record is therefore produced by the same code paths as the live demo.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ahmed', 'Youssef', 'Fatima Zahra', 'Khadija', 'Mohamed', 'Salma', 'Omar', 'Imane', 'Hamza', 'Sanaa', 'Karim', 'Nadia', 'Mehdi', 'Houda', 'Rachid', 'Laila', 'Anas', 'Meryem', 'Soufiane', 'Zineb', 'Hicham', 'Asmae', 'Adil', 'Ghita', 'Yassine', 'Hajar'];
const LAST = ['El Amrani', 'Benali', 'Alaoui', 'Bennani', 'Tazi', 'El Idrissi', 'Chraibi', 'Berrada', 'Fassi', 'Ouazzani', 'Lahlou', 'Kettani', 'Saidi', 'Naciri', 'Bouzid', 'El Mansouri', 'Ziani', 'Rami', 'Haddad', 'Sefrioui'];
const AR_NAMES = ['أحمد العمراني', 'فاطمة الزهراء بناني', 'يوسف العلوي', 'خديجة التازي', 'محمد الإدريسي'];

type Lines = { price: [string, number | undefined, string?][]; info: string[]; callback: string[] };

/** What customers typically write, per sector. [product text, quantity, details] */
const LINES: Record<string, Lines> = {
  climatisation: {
    price: [
      ['Climatiseur 18000 BTU pour mon bureau', 2, 'Installation comprise si possible'],
      ['Clim split 12000 BTU inverter', 1],
      ['3 climatiseurs 24000 BTU pour un open space', undefined, 'Besoin avant fin du mois'],
      ['Pompe à chaleur pour villa', 1],
      ['مكيف 12000 BTU', 1],
    ],
    info: ['Est-ce que vous faites l’entretien des climatiseurs ?', 'Vous intervenez le samedi ?', 'Quelle garantie sur les climatiseurs ?'],
    callback: ['Mon climatiseur ne refroidit plus', 'Je veux un devis pour climatiser un local commercial'],
  },
  electronique: {
    price: [
      ['Réfrigérateur 500 litres', 1],
      ['Téléviseur 55 pouces', 1, 'Livraison à domicile'],
      ['Machine à laver 9 kg', 1],
      ['Climatiseur 18000 BTU', 2, 'Pour un bureau'],
      ['Ordinateurs portables pour une école', 10],
    ],
    info: ['Vous réparez les téléviseurs Samsung ?', 'Quels sont vos horaires d’ouverture ?', 'Livrez-vous à Mohammedia ?'],
    callback: ['Ma machine à laver est en panne', 'Je voudrais un conseil pour équiper une cuisine'],
  },
  energie_solaire: {
    price: [
      ['Panneaux solaires 5 kWc pour une villa', undefined, 'Toiture terrasse 60 m2'],
      ['Onduleur 3 kVA', 1],
      ['Pompage solaire pour un puits agricole', 1, 'Profondeur 80 m'],
      ['Chauffe-eau solaire 300 litres', 1],
    ],
    info: ['Proposez-vous un financement pour le solaire ?', 'Combien de temps pour une installation ?'],
    callback: ['Je veux réduire ma facture d’électricité', 'Projet solaire pour une ferme'],
  },
  electricite: {
    price: [
      ['Installation électrique appartement 120 m2', 1],
      ['Groupe électrogène 20 kVA', 1],
      ['Éclairage LED pour un entrepôt', 40],
    ],
    info: ['Faites-vous la mise aux normes électriques ?', 'Intervenez-vous en urgence ?'],
    callback: ['Coupure de courant répétée dans mon magasin', 'Devis pour câblage de bureaux'],
  },
  btp: {
    price: [
      ['Peinture appartement 90 m2', 1],
      ['Carrelage salle de bain', 1, 'Environ 12 m2'],
      ['Rénovation complète cuisine et salon', 1],
      ['Étanchéité terrasse 100 m2', 1],
    ],
    info: ['Vous faites les devis gratuits ?', 'Quels délais pour une rénovation ?'],
    callback: ['Fuite d’eau importante', 'Travaux de rénovation de bureaux'],
  },
  web_design: {
    price: [
      ['Création site web e-commerce', 1, 'Environ 200 produits'],
      ['Logo pour un restaurant', 1],
      ['Site internet vitrine', 1],
    ],
    info: ['Faites-vous l’hébergement ?', 'Combien de temps pour un site ?'],
    callback: ['Refonte de notre site', 'Application mobile pour notre hôtel'],
  },
  securite: {
    price: [
      ['4 caméras de surveillance pour un magasin', 4],
      ['Alarme maison', 1],
      ['Caméras IP pour un entrepôt', 8],
    ],
    info: ['Les caméras sont-elles visibles sur téléphone ?', 'Faites-vous la maintenance ?'],
    callback: ['Sécuriser une villa', 'Contrôle d’accès pour bureaux'],
  },
  amenagement: {
    price: [
      ['Cuisine équipée sur mesure', 1],
      ['Menuiserie aluminium pour 6 fenêtres', 6],
    ],
    info: ['Quels matériaux proposez-vous ?', 'Avez-vous un showroom ?'],
    callback: ['Projet de dressing', 'Remplacement de fenêtres'],
  },
};

interface TimedTask {
  at: number;
  order: number;
  run: () => Promise<void>;
}

export interface SeedOptions {
  days?: number;
  seed?: number;
}

export async function generateSeed(now: Date, opts: SeedOptions = {}): Promise<Database> {
  const days = opts.days ?? 30;
  const rnd = mulberry32(opts.seed ?? 20261103);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p: number) => rnd() < p;

  const base = emptyDatabase(now);
  base.settings.simulatedLatencyMs = 0;
  const repo = new MemoryRepository(base);
  const clock = new ManualClock(now.getTime() - days * DAY);
  const transport = new SimulatedTransport(() => 0, rnd);
  const companyTransport = new SimulatedTransport(() => 0, rnd);
  const app = new AppService({ repo, transport, companyTransport, interpreter: new RuleBasedInterpreter(), clock, ids: createSequentialIds() });

  const companies = await repo.listCompanies();
  const byName = (name: string) => companies.find((c) => c.name === name)!;
  const weights: Record<string, number> = { SpaceFix: 5, 'Casa Clim': 4, 'Atlas Solar': 4, ElectroPro: 3, 'SolarTech Maroc': 2, Batipro: 2, 'ÉlectroMénager Plus': 2 };
  const weighted: Company[] = companies.flatMap((c) => Array<Company>(weights[c.name] ?? 1).fill(c));

  // Priority queue of timed tasks, executed in chronological order.
  const queue: TimedTask[] = [];
  let order = 0;
  const schedule = (at: number, run: () => Promise<void>) => queue.push({ at, order: order++, run });

  let customerSeq = 0;
  const newCustomer = (arabic: boolean) => {
    customerSeq += 1;
    const num = `+2126${String(61000000 + Math.floor(rnd() * 38999999)).padStart(8, '0')}`;
    const name = arabic ? pick(AR_NAMES) : `${pick(FIRST)} ${pick(LAST)}`;
    return { customer: new SimulatedCustomer(app, num, name.split(' ')[0], `wamid.SEED${customerSeq}`), name };
  };

  const startMs = now.getTime() - days * DAY;
  const lastSafe = now.getTime() - 25 * MINUTE;

  // ── Story beats that make the subscription funnel tangible ──
  const story: { daysAgo: number; company: string; intent: Intent; then?: 'free' | 'free+subscribe' }[] = [
    { daysAgo: 24, company: 'ÉlectroMénager Plus', intent: 'PRICE', then: 'free+subscribe' },
    { daysAgo: 21, company: 'Batipro', intent: 'PRICE', then: 'free' },
    { daysAgo: 27, company: 'Agadir Clim', intent: 'CALLBACK', then: 'free' },
    { daysAgo: 12, company: 'Rabat Froid Services', intent: 'INFO' },
  ];

  const storyNames = new Set(story.map((s) => s.company));

  const scriptFor = (company: Company, intent: Intent, arabic: boolean): Omit<CustomerScript, 'name' | 'consent'> => {
    const lines = LINES[company.sector] ?? LINES.electronique;
    if (intent === 'PRICE') {
      const [product, qty, details] = pick(lines.price);
      return {
        intent,
        product: arabic && company.sector === 'climatisation' ? 'مكيف 12000 BTU' : product,
        quantity: qty ?? 'button',
        city: chance(0.85) ? 'fiche' : pick(company.coveredCities.length ? company.coveredCities : [company.city]),
        details: details ?? (chance(0.3) ? 'Merci de me contacter le matin' : undefined),
      };
    }
    if (intent === 'INFO') return { intent, question: pick(lines.info) };
    return { intent, reason: pick(lines.callback), callbackTime: pick(['ASAP', 'TODAY', 'TOMORROW'] as const) };
  };

  type Outcome = 'complete' | 'refuse' | 'abandon';
  const runConversation = (at: number, company: Company, intent: Intent, outcome: Outcome, after?: (demandId: string, at: number) => void) => {
    schedule(at, async () => {
      const arabic = chance(0.1);
      const { customer, name } = newCustomer(arabic);
      await customer.openFromFiche(company.id);
      const tick = () => clock.advance(15_000 + Math.floor(rnd() * 70_000));
      const script: CustomerScript = {
        ...scriptFor(company, intent, arabic),
        name,
        consent: outcome !== 'refuse',
        otherPhone: chance(0.12) ? `07${String(Math.floor(10000000 + rnd() * 89999999))}` : undefined,
      };
      if (outcome === 'abandon') {
        script.stopAt = pick(['AWAIT_NAME', 'AWAIT_PHONE_CONFIRM', 'PRICE_PRODUCT', 'AWAIT_CONSENT'] as const);
        if (script.stopAt === 'PRICE_PRODUCT' && intent !== 'PRICE') script.stopAt = 'AWAIT_NAME';
      }
      // Occasionally the provider re-delivers an event: must be a no-op.
      if (chance(0.06)) await customer.say('Bonjour', `wamid.DUP${customerSeq}`).then(() => customer.say('Bonjour', `wamid.DUP${customerSeq}`));
      const conv = await runScript(customer, script, tick);
      if (conv.demandId && after) after(conv.demandId, clock.now().getTime());
    });
  };

  // Admin follow-up rules for demands that were not auto-distributed.
  const adminFollowUp = (demandId: string, at: number) => {
    schedule(at + HOUR + rnd() * 5 * HOUR, async () => {
      if (clock.now().getTime() > lastSafe) return;
      const demand = await repo.getDemand(demandId);
      if (!demand) return;
      if (demand.status === 'DISTRIBUTED') {
        scheduleOutcomes(demandId);
        return;
      }
      if (demand.status !== 'NEW' && demand.status !== 'IN_REVIEW') return;
      if (chance(0.05)) {
        await app.setDemandStatus(demandId, 'REJECTED', pick(['Message de test', 'Doublon d’une demande précédente', 'Hors périmètre Telecontact']), 'Sara (Telecontact)');
        return;
      }
      if (demand.status === 'IN_REVIEW') return;
      const match = await app.getMatches(demandId);
      const rec = match.recommendation;
      const requested = match.candidates.find((c) => c.isRequested);
      // SpaceFix keeps its free opportunity for the live journey. Its older demands were
      // served by subscribed competitors — the core of the sales pitch to SpaceFix.
      if (requested?.companyName === 'SpaceFix') {
        if (at > now.getTime() - 3 * DAY) return;
        const alts = match.candidates.filter((c) => !c.isRequested && c.eligible && c.mode === 'SUBSCRIPTION').slice(0, 2);
        if (alts.length) {
          await app.distribute(demandId, alts.map((c) => c.companyId), 'Sara (Telecontact)');
          scheduleOutcomes(demandId);
        }
        return;
      }
      // Story companies keep their free opportunity for their scripted beat.
      if (rec.action === 'SEND_REQUESTED' && storyNames.has(requested?.companyName ?? '')) return;
      if (rec.action === 'SEND_REQUESTED' && chance(0.6)) {
        await app.distribute(demandId, rec.companyIds, 'Sara (Telecontact)');
        scheduleOutcomes(demandId);
      } else if (rec.action === 'SEND_ALTERNATIVES' && chance(0.8)) {
        await app.distribute(demandId, rec.companyIds.slice(0, chance(0.5) ? 2 : 1), 'Sara (Telecontact)');
        scheduleOutcomes(demandId);
      }
    });
  };

  const scheduleOutcomes = (demandId: string) => {
    const t0 = clock.now().getTime();
    schedule(t0 + 2 * HOUR + rnd() * 20 * HOUR, async () => {
      for (const dist of await repo.listDistributions({ demandId })) {
        if (dist.deliveryStatus === 'FAILED' || clock.now().getTime() > lastSafe) continue;
        const r = rnd();
        const outcome: DistributionOutcome = r < 0.15 ? 'SENT' : r < 0.35 ? 'VIEWED' : r < 0.7 ? 'CONTACTED' : r < 0.85 ? 'WON' : r < 0.95 ? 'LOST' : 'DECLINED';
        if (outcome !== 'SENT') await app.setDistributionOutcome(dist.id, outcome, dist.companyId);
      }
      const demand = await repo.getDemand(demandId);
      if (demand?.status === 'ACCEPTED' && t0 < now.getTime() - 7 * DAY && chance(0.6)) {
        schedule(clock.now().getTime() + 2 * DAY, async () => {
          if (clock.now().getTime() < lastSafe) await app.setDemandStatus(demandId, 'CLOSED', 'Traitée', 'Sara (Telecontact)');
        });
      }
    });
  };

  // ── Organic traffic ──
  for (let d = days; d >= 0; d--) {
    const dayStart = startMs + (days - d) * DAY;
    const weekday = new Date(dayStart).getDay();
    const views = Math.round((weekday === 0 ? 7 : 13) + rnd() * 9);
    for (let v = 0; v < views; v++) {
      const at = dayStart + 8 * HOUR + rnd() * 13 * HOUR;
      if (at > lastSafe) continue;
      const company = pick(weighted);
      const visitor = `v_seed_${d}_${v}`;
      const clicks = chance(0.3);
      schedule(at, async () => {
        await app.recordFicheView(company.id, visitor);
        if (!clicks) return;
        if (chance(0.12)) {
          await app.clickWhatsApp(company.id, visitor); // clicked but never sent the message
          return;
        }
      });
      if (clicks && chance(0.88)) {
        const r = rnd();
        const outcome: Outcome = r < 0.74 ? 'complete' : r < 0.86 ? 'refuse' : 'abandon';
        const ir = rnd();
        const intent: Intent = ir < 0.58 ? 'PRICE' : ir < 0.8 ? 'INFO' : 'CALLBACK';
        runConversation(at + 30_000, company, intent, outcome, adminFollowUp);
      }
    }
  }

  // ── Story beats ──
  for (const beat of story) {
    const company = byName(beat.company);
    const at = now.getTime() - beat.daysAgo * DAY + 10 * HOUR;
    runConversation(at, company, beat.intent, 'complete', (demandId, t) => {
      if (!beat.then) return;
      schedule(t + 2 * HOUR, async () => {
        await app.distribute(demandId, [company.id], 'Sara (Telecontact)');
        await app.addCompanyNote(company.id, 'Opportunité gratuite envoyée. Rappel commercial prévu pour présenter les abonnements.', 'Sara (Telecontact)');
        scheduleOutcomes(demandId);
      });
      if (beat.then === 'free+subscribe') {
        schedule(t + 6 * DAY, async () => {
          await app.setSubscription(company.id, 'ACTIVE', 'plan_essentiel', 'Sara (Telecontact)');
          await app.addCompanyNote(company.id, 'A souscrit au plan Essentiel après l’opportunité gratuite (client contacté et vente conclue).', 'Sara (Telecontact)');
        });
      }
    });
  }

  // A failed delivery the admin can retry, on a subscribed company.
  schedule(now.getTime() - 3 * DAY, async () => {
    companyTransport.forceFailures(1);
  });

  // A subscription request waiting for the sales team.
  schedule(now.getTime() - 2 * DAY, async () => {
    await app.requestSubscription(byName('VisioGuard').id, 'plan_essentiel');
  });

  // Process the queue in chronological order (tasks may schedule further tasks).
  while (queue.length) {
    queue.sort((a, b) => a.at - b.at || a.order - b.order);
    const task = queue.shift()!;
    if (task.at > clock.now().getTime()) clock.set(task.at);
    await task.run();
  }

  // Two conversations in progress right now, to show live states.
  clock.set(now.getTime() - 4 * MINUTE);
  for (const [company, stop] of [
    ['Casa Clim', 'PRICE_QUANTITY'],
    ['Atlas Solar', 'AWAIT_PHONE_CONFIRM'],
  ] as const) {
    const { customer, name } = newCustomer(false);
    await customer.openFromFiche(byName(company).id);
    await runScript(customer, { intent: 'PRICE', consent: true, name, product: company === 'Casa Clim' ? 'Climatiseur gainable 36000 BTU' : 'Panneaux solaires 3 kWc', stopAt: stop }, () => clock.advance(20_000));
  }

  clock.set(now);
  await app.sweepAbandoned();
  // Let coalesced writes settle, then return a clean snapshot.
  await Promise.resolve();
  const db = await repo.snapshot();
  db.settings.simulatedLatencyMs = 180;
  db.seededAt = now.toISOString();
  return db;
}
