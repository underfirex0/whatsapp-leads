import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppRuntime } from '../core';
import type { AppService } from '../core/services/app';

/**
 * UI ⇄ core bridge. Components read data through `useLive` (re-runs when the
 * store changes) and mutate through `useAction` (pending state + toasts).
 * The UI never writes to the store directly.
 */

const RuntimeCtx = createContext<AppRuntime | null>(null);

export function RuntimeProvider({ runtime, children }: { runtime: AppRuntime; children: ReactNode }) {
  return <RuntimeCtx.Provider value={runtime}>{children}</RuntimeCtx.Provider>;
}

export function useRuntime(): AppRuntime {
  const r = useContext(RuntimeCtx);
  if (!r) throw new Error('RuntimeProvider missing');
  return r;
}

export function useApp(): AppService {
  return useRuntime().app;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Live<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/**
 * Live query. First load waits for the simulated latency (so loading states
 * are real); subsequent store changes refresh silently in place.
 */
export function useLive<T>(query: (app: AppService) => Promise<T>, deps: unknown[] = []): Live<T> {
  const runtime = useRuntime();
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: Error | null }>({ data: undefined, loading: true, error: null });
  const seq = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const run = useCallback(
    async (initial: boolean) => {
      const id = ++seq.current;
      if (initial) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        if (initial) {
          const settings = await runtime.repo.getSettings();
          if (settings.simulatedLatencyMs > 0) await sleep(settings.simulatedLatencyMs);
        }
        const data = await queryRef.current(runtime.app);
        if (id === seq.current) setState({ data, loading: false, error: null });
      } catch (err) {
        if (id === seq.current) setState({ data: undefined, loading: false, error: err as Error });
      }
    },
    [runtime],
  );

  useEffect(() => {
    void run(true);
    return runtime.repo.subscribe(() => void run(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return { ...state, reload: () => void run(true) };
}

// ───────────────────────── Toasts ─────────────────────────

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children, render }: { children: ReactNode; render: (toasts: Toast[], dismiss: (id: number) => void) => ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = next.current++;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {render(toasts, dismiss)}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Wrap a mutation: pending flag, error toast, optional success toast. */
export function useAction<A extends unknown[], R>(fn: (app: AppService, ...args: A) => Promise<R>, success?: string | ((r: R) => string)) {
  const app = useApp();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      try {
        const r = await fn(app, ...args);
        if (success) toast({ kind: 'success', message: typeof success === 'function' ? success(r) : success });
        return r;
      } catch (err) {
        toast({ kind: 'error', message: (err as Error).message || 'Une erreur est survenue' });
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, toast],
  );
  return { run, pending };
}

/** Simulated visitor & customer identity for this browser (persists across refreshes). */
export function useSimIdentity() {
  const read = () => {
    try {
      const raw = localStorage.getItem('telecontact-sim-identity');
      if (raw) return JSON.parse(raw) as { visitorId: string; waNumber: string; profileName: string };
    } catch {
      /* ignore */
    }
    return null;
  };
  const make = () => ({
    visitorId: `v_${Math.random().toString(36).slice(2, 10)}`,
    waNumber: `+2126${String(Math.floor(10000000 + Math.random() * 89999999))}`,
    profileName: 'Visiteur démo',
  });
  const [identity, setIdentity] = useState(() => {
    const existing = read();
    if (existing) return existing;
    const fresh = make();
    try {
      localStorage.setItem('telecontact-sim-identity', JSON.stringify(fresh));
    } catch {
      /* ignore */
    }
    return fresh;
  });
  const renew = () => {
    const fresh = make();
    try {
      localStorage.setItem('telecontact-sim-identity', JSON.stringify(fresh));
    } catch {
      /* ignore */
    }
    setIdentity(fresh);
    return fresh;
  };
  return { identity, renew };
}
