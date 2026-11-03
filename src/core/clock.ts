export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Mutable clock used by the seed generator and tests. */
export class ManualClock implements Clock {
  private t: number;
  constructor(start: Date | number) {
    this.t = typeof start === 'number' ? start : start.getTime();
  }
  now() {
    return new Date(this.t);
  }
  set(d: Date | number) {
    this.t = typeof d === 'number' ? d : d.getTime();
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
