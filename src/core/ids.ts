/** Id generation is injectable so seeds and tests stay deterministic. */
export interface IdGenerator {
  next(prefix: string): string;
}

export function createIdGenerator(seed = Date.now()): IdGenerator {
  let counter = 0;
  const base = seed.toString(36).slice(-5);
  return {
    next(prefix: string) {
      counter += 1;
      const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
      return `${prefix}_${base}${counter.toString(36).padStart(3, '0')}${rand}`;
    },
  };
}

/** Fully deterministic generator (tests, seed). */
export function createSequentialIds(start = 0): IdGenerator {
  let counter = start;
  return {
    next(prefix: string) {
      counter += 1;
      return `${prefix}_${counter.toString(36).padStart(5, '0')}`;
    },
  };
}
