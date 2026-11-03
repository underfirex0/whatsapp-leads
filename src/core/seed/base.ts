import type { Company, Database, Intent, Plan, Settings, SubscriptionStatus } from '../types';
import { DEFAULT_CATEGORIES } from '../catalog';

/**
 * Fictional demonstration data. None of these companies, people or numbers are
 * real. Numbers use the +212 5 22 00 xx xx / +212 6 00 xx xx xx ranges.
 */

export const DB_VERSION = 3;

export const DEFAULT_SETTINGS: Settings = {
  autoDistribution: true,
  maxCompaniesPerDemand: 3,
  simulatedFailureRate: 0,
  simulatedLatencyMs: 180,
  abandonAfterMinutes: 30,
  centralNumber: '+212522000100',
  privacyUrl: 'https://www.telecontact.ma/service_whatsapp',
};

export const DEFAULT_PLANS: Plan[] = [
  {
    id: 'plan_decouverte',
    name: 'Découverte',
    priceLabel: 'À définir',
    monthlyQuota: 5,
    maxCities: 1,
    autoDistribution: false,
    description: 'Demandes validées une à une par l’équipe Telecontact.',
    active: true,
  },
  {
    id: 'plan_essentiel',
    name: 'Essentiel',
    priceLabel: 'À définir',
    monthlyQuota: 15,
    maxCities: 2,
    autoDistribution: true,
    description: 'Réception automatique des demandes de sa ville.',
    active: true,
  },
  {
    id: 'plan_pro',
    name: 'Pro',
    priceLabel: 'À définir',
    monthlyQuota: 50,
    maxCities: 6,
    autoDistribution: true,
    description: 'Plusieurs villes, quota étendu.',
    active: true,
  },
  {
    id: 'plan_premium',
    name: 'Premium',
    priceLabel: 'À définir',
    monthlyQuota: null,
    maxCities: null,
    autoDistribution: true,
    description: 'Demandes illimitées, priorité de distribution.',
    active: true,
  },
];

interface CompanySeed {
  name: string;
  city: string;
  sector: string;
  activity: string;
  products: string[];
  accepted: string[];
  covered: string[];
  sub: SubscriptionStatus;
  plan?: string;
  /** Days ago the subscription started. */
  since?: number;
  freeUsedDaysAgo?: number;
  rating: number;
  intents?: Intent[];
  address: string;
  description: string;
}

const COMPANIES: CompanySeed[] = [
  {
    name: 'SpaceFix', city: 'Casablanca', sector: 'electronique', activity: 'Vente et maintenance d’équipements électroniques',
    products: ['Climatiseurs', 'Réfrigérateurs', 'Téléviseurs', 'Machines à laver', 'Réparation électronique'],
    accepted: ['electronique', 'climatisation'], covered: ['Mohammedia', 'Bouskoura'], sub: 'NONE', rating: 4.3,
    address: '112, boulevard Zerktouni, Maârif', description: 'Équipements électroniques et électroménagers pour particuliers et professionnels : vente, installation et service après-vente.',
  },
  {
    name: 'Atlas Solar', city: 'Rabat', sector: 'energie_solaire', activity: 'Installation photovoltaïque',
    products: ['Panneaux solaires', 'Onduleurs', 'Chauffe-eau solaire', 'Pompage solaire', 'Batteries'],
    accepted: ['energie_solaire'], covered: ['Salé', 'Témara', 'Kénitra', 'Casablanca'], sub: 'ACTIVE', plan: 'plan_pro', since: 70, rating: 4.7,
    address: '23, avenue Annakhil, Hay Riad', description: 'Études et installations solaires résidentielles, agricoles et industrielles.',
  },
  {
    name: 'ElectroPro', city: 'Casablanca', sector: 'electricite', activity: 'Électricité générale et climatisation',
    products: ['Installation électrique', 'Climatiseurs', 'Éclairage LED', 'Groupes électrogènes', 'Tableaux électriques'],
    accepted: ['electricite', 'climatisation', 'electronique'], covered: ['Mohammedia'], sub: 'ACTIVE', plan: 'plan_essentiel', since: 45, rating: 4.4,
    address: '8, rue Ibnou Mounir, Gauthier', description: 'Installations électriques tertiaires et résidentielles, pose de climatiseurs.',
  },
  {
    name: 'Casa Clim', city: 'Casablanca', sector: 'climatisation', activity: 'Climatisation et froid',
    products: ['Climatiseurs split', 'Climatiseurs gainables', 'Pompes à chaleur', 'Chambres froides', 'Entretien climatisation'],
    accepted: ['climatisation'], covered: ['Mohammedia', 'Bouskoura', 'El Jadida'], sub: 'ACTIVE', plan: 'plan_premium', since: 120, rating: 4.8,
    address: '45, boulevard Brahim Roudani', description: 'Spécialiste de la climatisation résidentielle et professionnelle depuis 2009.',
  },
  {
    name: 'TechDesign', city: 'Marrakech', sector: 'web_design', activity: 'Agence web et design',
    products: ['Site web', 'Site e-commerce', 'Logo et identité visuelle', 'Application mobile'],
    accepted: ['web_design'], covered: ['Casablanca', 'Rabat', 'Agadir'], sub: 'TRIAL', plan: 'plan_pro', since: 6, rating: 4.5,
    address: 'Résidence Al Massira, Guéliz', description: 'Sites, applications et identités visuelles pour PME et hôtels.',
  },
  {
    name: 'Batipro', city: 'Casablanca', sector: 'btp', activity: 'Rénovation et travaux',
    products: ['Rénovation', 'Peinture', 'Carrelage', 'Étanchéité', 'Faux plafond'],
    accepted: ['btp'], covered: ['Mohammedia', 'Bouskoura'], sub: 'NONE', rating: 4.1,
    address: '17, rue Soumaya, Palmier', description: 'Travaux de rénovation clés en main pour appartements, villas et bureaux.',
  },
  {
    name: 'Rabat Froid Services', city: 'Rabat', sector: 'climatisation', activity: 'Climatisation',
    products: ['Climatiseurs', 'Entretien climatisation', 'Chambres froides'],
    accepted: ['climatisation'], covered: ['Salé', 'Témara'], sub: 'NONE', rating: 4.2,
    address: '5, avenue Fal Ould Oumeir, Agdal', description: 'Installation et maintenance de climatisation à Rabat-Salé.',
  },
  {
    name: 'Marrakech Clim Confort', city: 'Marrakech', sector: 'climatisation', activity: 'Climatisation',
    products: ['Climatiseurs', 'Pompes à chaleur'], accepted: ['climatisation'], covered: [], sub: 'NONE', rating: 3.9,
    address: 'Route de Safi, Daoudiate', description: 'Vente et pose de climatiseurs à Marrakech.',
  },
  {
    name: 'SolarTech Maroc', city: 'Casablanca', sector: 'energie_solaire', activity: 'Énergie solaire',
    products: ['Panneaux solaires', 'Onduleurs', 'Batteries'], accepted: ['energie_solaire'], covered: ['Mohammedia', 'El Jadida', 'Bouskoura'],
    sub: 'ACTIVE', plan: 'plan_pro', since: 90, rating: 4.6,
    address: 'Technopark, route de Nouaceur', description: 'Solutions photovoltaïques pour résidences et entreprises.',
  },
  {
    name: 'Souss Énergie', city: 'Agadir', sector: 'energie_solaire', activity: 'Pompage et énergie solaire',
    products: ['Pompage solaire', 'Panneaux solaires'], accepted: ['energie_solaire'], covered: [], sub: 'TRIAL', plan: 'plan_essentiel', since: 9, rating: 4.0,
    address: 'Zone industrielle Tassila', description: 'Pompage solaire agricole dans la région Souss-Massa.',
  },
  {
    name: 'Digital Atlas Agency', city: 'Casablanca', sector: 'web_design', activity: 'Agence digitale',
    products: ['Site web', 'Site e-commerce', 'Logo et identité visuelle'], accepted: ['web_design'], covered: ['Rabat'],
    sub: 'ACTIVE', plan: 'plan_essentiel', since: 30, rating: 4.3,
    address: 'Twin Center, boulevard Zerktouni', description: 'Création de sites et campagnes digitales.',
  },
  {
    name: 'Fès Électricité Générale', city: 'Fès', sector: 'electricite', activity: 'Électricité',
    products: ['Installation électrique', 'Tableaux électriques', 'Éclairage LED'], accepted: ['electricite'], covered: ['Meknès'], sub: 'NONE', rating: 4.0,
    address: 'Avenue Hassan II, Ville nouvelle', description: 'Électricité bâtiment, mise aux normes.',
  },
  {
    name: 'Tanger Sécurité Systèmes', city: 'Tanger', sector: 'securite', activity: 'Vidéosurveillance et alarmes',
    products: ['Caméras de surveillance', 'Alarmes', 'Contrôle d’accès'], accepted: ['securite'], covered: ['Tétouan'],
    sub: 'ACTIVE', plan: 'plan_essentiel', since: 50, rating: 4.4,
    address: 'Boulevard Mohammed V', description: 'Systèmes de sécurité pour commerces et résidences.',
  },
  {
    name: 'VisioGuard', city: 'Casablanca', sector: 'securite', activity: 'Vidéosurveillance',
    products: ['Caméras de surveillance', 'Alarmes', 'Interphones'], accepted: ['securite'], covered: ['Mohammedia'], sub: 'NONE', rating: 4.1,
    address: '62, rue Abou Hanifa, Derb Ghallef', description: 'Installation de caméras IP et alarmes.',
  },
  {
    name: 'Rénov’Habitat', city: 'Rabat', sector: 'btp', activity: 'Rénovation',
    products: ['Rénovation', 'Peinture', 'Plomberie', 'Carrelage'], accepted: ['btp'], covered: ['Salé', 'Témara'],
    sub: 'ACTIVE', plan: 'plan_pro', since: 60, rating: 4.5,
    address: 'Avenue Mohammed VI, Souissi', description: 'Rénovation d’appartements et villas.',
  },
  {
    name: 'Maison Alu Design', city: 'Casablanca', sector: 'amenagement', activity: 'Menuiserie aluminium et cuisines',
    products: ['Menuiserie aluminium', 'Cuisines équipées', 'Placards'], accepted: ['amenagement'], covered: ['Mohammedia'], sub: 'NONE', rating: 4.2,
    address: 'Lissasfa, zone industrielle', description: 'Menuiserie aluminium et cuisines sur mesure.',
  },
  {
    name: 'Cuisines Andalouses', city: 'Fès', sector: 'amenagement', activity: 'Cuisines sur mesure',
    products: ['Cuisines équipées', 'Dressings'], accepted: ['amenagement'], covered: ['Meknès'], sub: 'PAUSED', plan: 'plan_essentiel', since: 100, rating: 4.0,
    address: 'Route d’Imouzzer', description: 'Cuisines et dressings sur mesure.',
  },
  {
    name: 'ÉlectroMénager Plus', city: 'Rabat', sector: 'electronique', activity: 'Électroménager',
    products: ['Réfrigérateurs', 'Machines à laver', 'Téléviseurs', 'Climatiseurs'], accepted: ['electronique', 'climatisation'], covered: ['Salé', 'Témara'],
    sub: 'NONE', rating: 4.2,
    address: 'Avenue de France, Agdal', description: 'Électroménager toutes marques, livraison et installation.',
  },
  {
    name: 'InfoTech Services', city: 'Tanger', sector: 'electronique', activity: 'Informatique et réparation',
    products: ['Ordinateurs', 'Imprimantes', 'Réparation électronique'], accepted: ['electronique'], covered: ['Tétouan'], sub: 'NONE', rating: 3.8,
    address: 'Place des Nations', description: 'Vente et réparation de matériel informatique.',
  },
  {
    name: 'Agadir Clim', city: 'Agadir', sector: 'climatisation', activity: 'Climatisation',
    products: ['Climatiseurs', 'Entretien climatisation'], accepted: ['climatisation'], covered: [], sub: 'CANCELLED', plan: 'plan_essentiel', rating: 3.7,
    address: 'Hay Dakhla', description: 'Climatisation résidentielle à Agadir.',
  },
  {
    name: 'PlombiNet', city: 'Casablanca', sector: 'btp', activity: 'Plomberie',
    products: ['Plomberie', 'Chauffe-eau', 'Détection de fuites'], accepted: ['btp'], covered: ['Mohammedia', 'Bouskoura'],
    sub: 'TRIAL', plan: 'plan_essentiel', since: 4, rating: 4.3, intents: ['PRICE', 'CALLBACK'],
    address: '9, rue Ahmed Charci, Bourgogne', description: 'Dépannage plomberie 7j/7.',
  },
  {
    name: 'Oriental Solaire', city: 'Oujda', sector: 'energie_solaire', activity: 'Énergie solaire',
    products: ['Panneaux solaires', 'Chauffe-eau solaire'], accepted: ['energie_solaire'], covered: [], sub: 'NONE', rating: 4.0,
    address: 'Boulevard Allal El Fassi', description: 'Installations solaires dans l’Oriental.',
  },
];

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildCompanies(now: Date): Company[] {
  const ago = (d: number | undefined) => (d === undefined ? null : new Date(now.getTime() - d * 86_400_000).toISOString());
  return COMPANIES.map((c, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `cmp_${slug(c.name)}`,
      ficheId: `F${1040 + i}`,
      slug: slug(c.name),
      name: c.name,
      city: c.city,
      address: `${c.address}, ${c.city}`,
      sector: c.sector,
      activity: c.activity,
      description: c.description,
      products: c.products,
      phone: `+2125220010${n}`,
      email: `contact@${slug(c.name).replace(/-/g, '')}.example.ma`,
      website: `www.${slug(c.name).replace(/-/g, '')}.example.ma`,
      whatsappNumber: `+2126000010${n}`,
      coveredCities: c.covered,
      acceptedCategories: c.accepted,
      acceptedIntents: c.intents ?? ['PRICE', 'INFO', 'CALLBACK'],
      subscription: {
        status: c.sub,
        planId: c.plan ?? null,
        startedAt: ago(c.since),
        requestedAt: null,
        requestedPlanId: null,
      },
      freeOpportunityUsedAt: ago(c.freeUsedDaysAgo),
      notes: [],
      rating: c.rating,
      createdAt: ago(200 - i * 3)!,
      updatedAt: ago(10)!,
    };
  });
}

export function emptyDatabase(now: Date): Database {
  return {
    version: DB_VERSION,
    seededAt: now.toISOString(),
    counters: { demandNumber: 140 },
    settings: { ...DEFAULT_SETTINGS },
    categories: DEFAULT_CATEGORIES,
    plans: DEFAULT_PLANS,
    companies: buildCompanies(now),
    contacts: [],
    conversations: [],
    messages: [],
    demands: [],
    distributions: [],
    tracking: [],
    activity: [],
    inboundLedger: [],
  };
}
