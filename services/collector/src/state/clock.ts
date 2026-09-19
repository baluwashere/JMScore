export interface MarketClock {
  nowMs(): number;
}

export class SystemMarketClock implements MarketClock {
  nowMs(): number {
    return Date.now();
  }
}

export class ReplayMarketClock implements MarketClock {
  private currentMs: number;

  constructor(initialMs = 0) {
    if (!Number.isFinite(initialMs) || initialMs < 0) {
      throw new Error('initial replay time must be a finite non-negative number');
    }
    this.currentMs = initialMs;
  }

  nowMs(): number {
    return this.currentMs;
  }

  advanceTo(timestampMs: number): void {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) {
      throw new Error('replay timestamp must be a finite non-negative number');
    }
    if (timestampMs < this.currentMs) {
      throw new Error(`replay clock cannot move backwards: ${timestampMs} < ${this.currentMs}`);
    }
    this.currentMs = timestampMs;
  }
}
