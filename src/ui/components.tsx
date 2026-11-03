import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, Inbox } from 'lucide-react';
import type { Tone } from '../core/status';
import type { Toast } from './runtime';

// ───────────────────────── Buttons & badges ─────────────────────────

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'wa' | 'default';
  size?: 'sm' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
  solid?: boolean;
};

export function Button({ variant = 'default', size, icon, loading, iconOnly, solid, className = '', children, disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' && variant, size, iconOnly && 'icon', solid && 'solid', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 size={15} className="spin" /> : icon}
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', dot, children, title, square }: { tone?: Tone | 'outline'; dot?: boolean; children: ReactNode; title?: string; square?: boolean }) {
  return (
    <span className={`badge ${tone} ${square ? 'square' : ''}`} title={title}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function StatusBadge<K extends string>({ map, value }: { map: Record<K, { label: string; tone: Tone }>; value: K }) {
  const s = map[value];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

// ───────────────────────── Feedback ─────────────────────────

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">{icon ?? <Inbox size={20} />}</div>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <Notice tone="danger" title="Impossible de charger ces données">
        {error.message}
        {onRetry && (
          <div style={{ marginTop: 8 }}>
            <Button size="sm" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        )}
      </Notice>
    </div>
  );
}

export function Notice({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'accent'; title?: string; children?: ReactNode; icon?: ReactNode }) {
  const Ico = tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`notice ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {icon ?? <Ico size={16} />}
      <div className="grow">
        {title && <div className="strong" style={{ marginBottom: children ? 2 : 0 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="col" style={{ padding: 16, gap: 14 }} aria-label="Chargement">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="row" style={{ gap: 16 }}>
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} w={j === 0 ? '28%' : `${12 + ((i + j) % 3) * 4}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page">
      <Skeleton w={220} h={22} />
      <Skeleton w={340} h={13} style={{ marginTop: 10 }} />
      <div className="card" style={{ marginTop: 20 }}>
        <TableSkeleton />
      </div>
    </div>
  );
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          {t.kind === 'error' ? <XCircle size={16} /> : t.kind === 'success' ? <CheckCircle2 size={16} color="#6ce9a6" /> : <Info size={16} />}
          <span>{t.message}</span>
          <button className="x" onClick={() => dismiss(t.id)} aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Dialogs ─────────────────────────

export function Dialog({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button.primary, button');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog-h">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {children && <div className="dialog-b">{children}</div>}
        {footer && <div className="dialog-f">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, description, confirmLabel = 'Confirmer', danger, loading, children,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant={danger ? 'danger' : 'primary'} solid={danger} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

// ───────────────────────── Forms ─────────────────────────

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function ChipToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip-toggle" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

export function MultiToggle<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="checks">
      {options.map((o) => (
        <ChipToggle key={o.value} pressed={value.includes(o.value)} onClick={() => onChange(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value])}>
          {o.label}
        </ChipToggle>
      ))}
    </div>
  );
}

// ───────────────────────── Misc ─────────────────────────

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, company, lg }: { name: string; company?: boolean; lg?: boolean }) {
  const initials = name
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return <span className={`avatar ${company ? 'company' : ''} ${lg ? 'lg' : ''}`}>{initials || '?'}</span>;
}

export function ScoreMeter({ score }: { score: number }) {
  return (
    <span className="score" title={`Score de pertinence ${score}/100`}>
      <span className="meter">
        <div style={{ width: `${score}%` }} />
      </span>
      {score}
    </span>
  );
}

export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ───────────────────────── Formatting ─────────────────────────

const dtf = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const tf = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const fmt = {
  dateTime: (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : '—'),
  date: (iso: string | null | undefined) => (iso ? df.format(new Date(iso)) : '—'),
  time: (iso: string) => tf.format(new Date(iso)),
  relative(iso: string | null | undefined) {
    if (!iso) return '—';
    const diff = Date.now() - Date.parse(iso);
    const m = Math.round(diff / 60000);
    if (m < 1) return 'à l’instant';
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.round(h / 24);
    if (d < 7) return `il y a ${d} j`;
    return df.format(new Date(iso));
  },
  pct: (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)} %`),
  num: (v: number) => new Intl.NumberFormat('fr-FR').format(v),
};

export function RelTime({ iso }: { iso: string | null | undefined }) {
  return (
    <time dateTime={iso ?? undefined} title={fmt.dateTime(iso)}>
      {fmt.relative(iso)}
    </time>
  );
}
