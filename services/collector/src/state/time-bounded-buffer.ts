export class TimeBoundedBuffer<T> {
  private readonly items: T[] = [];
  private startIndex = 0;

  constructor(
    private readonly maxAgeMs: number,
    private readonly maxItems: number,
    private readonly timestampOf: (item: T) => number,
  ) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      throw new Error('maxAgeMs must be positive');
    }
    if (!Number.isInteger(maxItems) || maxItems <= 0) {
      throw new Error('maxItems must be a positive integer');
    }
  }

  push(item: T, nowMs: number): void {
    this.items.push(item);
    this.prune(nowMs);

    const activeCount = this.items.length - this.startIndex;
    if (activeCount > this.maxItems) {
      this.startIndex = this.items.length - this.maxItems;
    }

    this.compactIfNeeded();
  }

  prune(nowMs: number): void {
    const cutoff = nowMs - this.maxAgeMs;
    while (this.startIndex < this.items.length) {
      const item = this.items[this.startIndex];
      if (item === undefined || this.timestampOf(item) >= cutoff) break;
      this.startIndex += 1;
    }
    this.compactIfNeeded();
  }

  values(): readonly T[] {
    return this.items.slice(this.startIndex);
  }

  get size(): number {
    return this.items.length - this.startIndex;
  }

  clear(): void {
    this.items.length = 0;
    this.startIndex = 0;
  }

  private compactIfNeeded(): void {
    if (this.startIndex < 4096 || this.startIndex < this.items.length / 2) return;
    this.items.splice(0, this.startIndex);
    this.startIndex = 0;
  }
}
