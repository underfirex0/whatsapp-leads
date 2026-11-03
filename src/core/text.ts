/** Lower-case, strip accents and collapse whitespace — for matching, never for display. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export const ARABIC_RE = /[\u0600-\u06FF]/;

export function hasArabic(input: string): boolean {
  return ARABIC_RE.test(input);
}

export function titleCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function tokens(input: string): string[] {
  return normalize(input)
    .split(/[^a-z0-9\u0600-\u06FF]+/)
    .filter((t) => t.length > 1);
}

export function truncate(input: string, max: number): string {
  return input.length > max ? `${input.slice(0, max - 1)}…` : input;
}
