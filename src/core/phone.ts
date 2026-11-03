/**
 * Phone helpers. Moroccan numbers are normalised to E.164 (+212XXXXXXXXX).
 * Other international numbers are accepted when they look like valid E.164.
 */

export interface PhoneResult {
  ok: boolean;
  e164?: string;
  error?: string;
}

export function normalizePhone(raw: string): PhoneResult {
  const cleaned = raw.trim().replace(/[\s.\-()/]/g, '');
  if (!cleaned) return { ok: false, error: 'empty' };
  let digits = cleaned;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^0[5-7]\d{8}$/.test(digits)) digits = `212${digits.slice(1)}`;
  else if (/^[5-7]\d{8}$/.test(digits)) digits = `212${digits}`;
  else if (!/^212/.test(digits)) return { ok: false, error: 'format' };

  if (!/^\d+$/.test(digits)) return { ok: false, error: 'format' };

  if (digits.startsWith('212')) {
    const national = digits.slice(3).replace(/^0/, '');
    if (!/^[5-7]\d{8}$/.test(national)) return { ok: false, error: 'format' };
    return { ok: true, e164: `+212${national}` };
  }
  if (digits.length < 8 || digits.length > 15) return { ok: false, error: 'format' };
  return { ok: true, e164: `+${digits}` };
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw).ok;
}

/** +212661234567 → +212 6 61 23 45 67 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = /^\+212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  if (m) return `+212 ${m.slice(1).join(' ')}`;
  return e164;
}

/** +212 6 XX XX XX 67 — used where the full number should not be exposed. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = /^\+212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  if (m) return `+212 ${m[1]} XX XX ${m[4]} ${m[5]}`;
  return e164.replace(/\d(?=\d{4})/g, 'X');
}
