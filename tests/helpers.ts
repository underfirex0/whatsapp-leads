import { MemoryRepository } from '../src/core/store/memory';
import { SimulatedTransport } from '../src/core/transport/transport';
import { RuleBasedInterpreter } from '../src/core/ai/interpreter';
import { AppService } from '../src/core/services/app';
import { ManualClock } from '../src/core/clock';
import { createSequentialIds } from '../src/core/ids';
import { emptyDatabase } from '../src/core/seed/base';
import { SimulatedCustomer } from '../src/core/simulation/customer';
import type { Database } from '../src/core/types';

export const NOW = new Date('2026-11-03T10:00:00Z');

export function setup(mutate?: (db: Database) => void) {
  const db = emptyDatabase(NOW);
  db.settings.simulatedLatencyMs = 0;
  mutate?.(db);
  const repo = new MemoryRepository(db);
  const clock = new ManualClock(NOW);
  const transport = new SimulatedTransport(() => 0);
  const companyTransport = new SimulatedTransport(() => 0);
  const app = new AppService({ repo, transport, companyTransport, interpreter: new RuleBasedInterpreter(), clock, ids: createSequentialIds() });
  const customer = (num = '+212661234567', name = 'Ahmed') => new SimulatedCustomer(app, num, name);
  const company = async (name: string) => (await repo.listCompanies()).find((c) => c.name === name)!;
  const lastBot = async (conversationId: string) => {
    const msgs = await repo.listMessages(conversationId);
    return msgs.filter((m) => m.direction === 'OUT').at(-1)!;
  };
  return { app, repo, clock, transport, companyTransport, customer, company, lastBot };
}
