import type { Category } from './types';
import { normalize } from './text';

/**
 * Reference catalogue: sectors, Moroccan cities and a product lexicon.
 * This is configuration, not business logic — it can move to a database table.
 */

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'climatisation', label: 'Climatisation & froid', keywords: ['climatiseur', 'clim', 'climatisation', 'split', 'pompe a chaleur', 'froid', 'chambre froide', 'btu', 'مكيف'] },
  { id: 'electronique', label: 'Équipement électronique & électroménager', keywords: ['electronique', 'electromenager', 'tv', 'televiseur', 'refrigerateur', 'frigo', 'machine a laver', 'ordinateur', 'imprimante', 'smartphone', 'reparation', 'ثلاجة'] },
  { id: 'energie_solaire', label: 'Énergie solaire', keywords: ['solaire', 'panneau', 'photovoltaique', 'onduleur', 'batterie', 'chauffe-eau solaire', 'pompage', 'kwc'] },
  { id: 'electricite', label: 'Électricité & installation', keywords: ['electricite', 'electrique', 'tableau', 'cablage', 'eclairage', 'groupe electrogene', 'electricien'] },
  { id: 'btp', label: 'Bâtiment & rénovation', keywords: ['renovation', 'peinture', 'carrelage', 'plomberie', 'maconnerie', 'etancheite', 'faux plafond', 'construction', 'travaux'] },
  { id: 'web_design', label: 'Web, design & communication', keywords: ['site web', 'site internet', 'logo', 'application', 'design', 'graphisme', 'identite visuelle', 'e-commerce'] },
  { id: 'securite', label: 'Sécurité & vidéosurveillance', keywords: ['camera', 'videosurveillance', 'alarme', 'controle d\'acces', 'interphone', 'كاميرا'] },
  { id: 'amenagement', label: 'Aménagement & menuiserie', keywords: ['cuisine', 'menuiserie', 'aluminium', 'placard', 'dressing', 'amenagement', 'mobilier'] },
];

export interface CityDef {
  name: string;
  aliases: string[];
}

export const CITIES: CityDef[] = [
  { name: 'Casablanca', aliases: ['casablanca', 'casa', 'dar el beida', 'الدار البيضاء', 'كازا', 'البيضاء'] },
  { name: 'Rabat', aliases: ['rabat', 'الرباط'] },
  { name: 'Marrakech', aliases: ['marrakech', 'marrakesh', 'مراكش'] },
  { name: 'Fès', aliases: ['fes', 'fez', 'فاس'] },
  { name: 'Tanger', aliases: ['tanger', 'tangier', 'طنجة'] },
  { name: 'Agadir', aliases: ['agadir', 'أكادير', 'اكادير'] },
  { name: 'Meknès', aliases: ['meknes', 'مكناس'] },
  { name: 'Oujda', aliases: ['oujda', 'وجدة'] },
  { name: 'Kénitra', aliases: ['kenitra', 'القنيطرة'] },
  { name: 'Tétouan', aliases: ['tetouan', 'تطوان'] },
  { name: 'Salé', aliases: ['sale', 'سلا'] },
  { name: 'Mohammedia', aliases: ['mohammedia', 'المحمدية'] },
  { name: 'El Jadida', aliases: ['el jadida', 'eljadida', 'الجديدة'] },
  { name: 'Témara', aliases: ['temara', 'تمارة'] },
  { name: 'Bouskoura', aliases: ['bouskoura', 'بوسكورة'] },
];

export const CITY_NAMES = CITIES.map((c) => c.name);

/** Find a known city mentioned anywhere in the text. */
export function findCity(text: string): string | null {
  const n = ` ${normalize(text)} `;
  for (const c of CITIES) {
    for (const a of c.aliases) {
      const alias = normalize(a);
      // Word boundary for latin aliases, substring for Arabic script.
      const re = /^[a-z\s]+$/.test(alias) ? new RegExp(`[^a-z]${alias}[^a-z]`) : null;
      if (re ? re.test(n) : n.includes(alias)) return c.name;
    }
  }
  return null;
}

export function canonicalCity(text: string): string | null {
  return findCity(text);
}

export interface ProductDef {
  label: string;
  category: string;
  patterns: RegExp[];
}

/** Product lexicon used for deterministic extraction (FR, darija transliteration and Arabic). */
export const PRODUCTS: ProductDef[] = [
  { label: 'Climatiseur', category: 'climatisation', patterns: [/climatiseurs?/, /\bclims?\b/, /\bsplits?\b/, /climatisation/, /مكيف/, /كليماتيزور/] },
  { label: 'Pompe à chaleur', category: 'climatisation', patterns: [/pompes? a chaleur/] },
  { label: 'Chambre froide', category: 'climatisation', patterns: [/chambres? froides?/] },
  { label: 'Panneaux solaires', category: 'energie_solaire', patterns: [/panneaux? solaires?/, /photovoltaique/, /\bpv\b/, /الطاقة الشمسية/, /ألواح شمسية/] },
  { label: 'Onduleur', category: 'energie_solaire', patterns: [/onduleurs?/] },
  { label: 'Chauffe-eau solaire', category: 'energie_solaire', patterns: [/chauffe[- ]eau solaire/] },
  { label: 'Pompage solaire', category: 'energie_solaire', patterns: [/pompage solaire/, /pompe solaire/] },
  { label: 'Réfrigérateur', category: 'electronique', patterns: [/refrigerateurs?/, /\bfrigos?\b/, /ثلاجة/] },
  { label: 'Téléviseur', category: 'electronique', patterns: [/televiseurs?/, /\btv\b/, /television/, /تلفاز/] },
  { label: 'Machine à laver', category: 'electronique', patterns: [/machines? a laver/, /lave[- ]linge/] },
  { label: 'Ordinateur', category: 'electronique', patterns: [/ordinateurs?/, /\bpc\b/, /laptop/, /portable hp|portable dell|pc portable/] },
  { label: 'Imprimante', category: 'electronique', patterns: [/imprimantes?/] },
  { label: 'Réparation électronique', category: 'electronique', patterns: [/reparation/, /reparer/, /en panne/, /إصلاح/] },
  { label: 'Installation électrique', category: 'electricite', patterns: [/installation electrique/, /cablage/, /tableau electrique/, /electricien/] },
  { label: 'Groupe électrogène', category: 'electricite', patterns: [/groupes? electrogenes?/] },
  { label: 'Éclairage LED', category: 'electricite', patterns: [/eclairage/, /\bled\b/, /luminaires?/] },
  { label: 'Caméras de surveillance', category: 'securite', patterns: [/cameras?/, /videosurveillance/, /كاميرا/] },
  { label: 'Alarme', category: 'securite', patterns: [/alarmes?/] },
  { label: 'Site web', category: 'web_design', patterns: [/site (web|internet|e-?commerce)/, /\bsite\b/, /موقع/] },
  { label: 'Logo & identité visuelle', category: 'web_design', patterns: [/\blogo\b/, /identite visuelle/, /charte graphique/] },
  { label: 'Application mobile', category: 'web_design', patterns: [/application mobile/, /\bapp\b/] },
  { label: 'Peinture', category: 'btp', patterns: [/peinture/, /peindre/, /صباغة/] },
  { label: 'Carrelage', category: 'btp', patterns: [/carrelage/, /zellige/] },
  { label: 'Plomberie', category: 'btp', patterns: [/plomberie/, /plombier/, /fuite/] },
  { label: 'Étanchéité', category: 'btp', patterns: [/etancheite/] },
  { label: 'Rénovation', category: 'btp', patterns: [/renovation/, /renover/, /travaux/] },
  { label: 'Cuisine équipée', category: 'amenagement', patterns: [/cuisines?( equipee)?/] },
  { label: 'Menuiserie aluminium', category: 'amenagement', patterns: [/aluminium/, /menuiserie/] },
];

export function categoryLabel(categories: Category[], id: string | null | undefined): string {
  if (!id) return '—';
  return categories.find((c) => c.id === id)?.label ?? id;
}
