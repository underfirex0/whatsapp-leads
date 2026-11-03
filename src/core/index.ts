import { MemoryRepository, localStorageDriver, noPersistence } from './store/memory';
import { SimulatedTransport } from './transport/transport';
import { RuleBasedInterpreter } from './ai/interpreter';
import { AppService } from './services/app';
import { systemClock } from './clock';
import { createIdGenerator } from './ids';
import { generateSeed } from './seed/generate';
import { DB_VERSION } from './seed/base';
import type { Database } from './types';

export const STORAGE_KEY = 'telecontact-leads-demo';

export interface AppRuntime {
  app: AppService;
  repo: MemoryRepository;
  transport: SimulatedTransport;
  companyTransport: SimulatedTransport;
  reset(): Promise<void>;
}

/**
 * Composition root: wires the simulated adapters together.
 * To go to production, replace MemoryRepository → Supabase repository,
 * SimulatedTransport → Meta WhatsApp Cloud API transport,
 * RuleBasedInterpreter → LLM interpreter (behind the same validator).
 */
export async function createRuntime(opts: { persist?: boolean } = {}): Promise<AppRuntime> {
  const driver = opts.persist === false ? noPersistence : localStorageDriver(STORAGE_KEY);
  let initial: Database | null = driver.load();
  if (!initial || initial.version !== DB_VERSION) {
    initial = await generateSeed(new Date());
    driver.save(initial);
  }
  const repo = new MemoryRepository(initial, driver);
  let failureRate = initial.settings.simulatedFailureRate;
  repo.subscribe(() => {
    void repo.getSettings().then((s) => (failureRate = s.simulatedFailureRate));
  });
  const transport = new SimulatedTransport(() => failureRate);
  const companyTransport = new SimulatedTransport(() => failureRate);
  const app = new AppService({
    repo,
    transport,
    companyTransport,
    interpreter: new RuleBasedInterpreter(),
    clock: systemClock,
    ids: createIdGenerator(),
  });
  await app.sweepAbandoned();
  return {
    app,
    repo,
    transport,
    companyTransport,
    async reset() {
      const fresh = await generateSeed(new Date());
      await repo.replaceAll(fresh);
      repo.flush();
    },
  };
}
