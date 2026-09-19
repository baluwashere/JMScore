import type { MarketDataEvent } from '../types.js';
import type { ReplayMarketClock } from '../state/clock.js';
import type { RollingMarketSnapshot, RollingMarketState } from '../state/rolling-market-state.js';

export interface ReplayOptions {
  snapshotEveryMs?: number;
  onSnapshot?: (snapshot: RollingMarketSnapshot) => void;
}

export interface ReplaySummary {
  eventsSeen: number;
  eventsAccepted: number;
  eventsRejected: number;
  firstEventTime: number | null;
  lastEventTime: number | null;
  snapshotsEmitted: number;
}

export async function replayMarketEvents(
  events: AsyncIterable<MarketDataEvent>,
  state: RollingMarketState,
  clock: ReplayMarketClock,
  options: ReplayOptions = {},
): Promise<ReplaySummary> {
  const interval = options.snapshotEveryMs;
  if (interval !== undefined && (!Number.isFinite(interval) || interval <= 0)) {
    throw new Error('snapshotEveryMs must be positive when provided');
  }

  let eventsSeen = 0;
  let eventsAccepted = 0;
  let eventsRejected = 0;
  let firstEventTime: number | null = null;
  let lastEventTime: number | null = null;
  let snapshotsEmitted = 0;
  let nextSnapshotAt: number | null = null;

  for await (const event of events) {
    if (lastEventTime !== null && event.eventTime < lastEventTime) {
      throw new Error(
        `historical stream is not monotonic: ${event.eventTime} < ${lastEventTime}`,
      );
    }

    clock.advanceTo(event.eventTime);
    firstEventTime ??= event.eventTime;
    lastEventTime = event.eventTime;
    eventsSeen += 1;

    const result = state.ingest(event);
    if (result.accepted) eventsAccepted += 1;
    else eventsRejected += 1;

    if (interval !== undefined && options.onSnapshot !== undefined) {
      nextSnapshotAt ??= event.eventTime;
      if (event.eventTime >= nextSnapshotAt) {
        options.onSnapshot(state.snapshot());
        snapshotsEmitted += 1;
        nextSnapshotAt = event.eventTime + interval;
      }
    }
  }

  return {
    eventsSeen,
    eventsAccepted,
    eventsRejected,
    firstEventTime,
    lastEventTime,
    snapshotsEmitted,
  };
}

export async function* mergeSortedEventStreams(
  streams: readonly AsyncIterable<MarketDataEvent>[],
): AsyncGenerator<MarketDataEvent> {
  const iterators = streams.map((stream) => stream[Symbol.asyncIterator]());
  const heads = await Promise.all(iterators.map((iterator) => iterator.next()));

  try {
    while (true) {
      let selected = -1;
      let selectedEvent: MarketDataEvent | null = null;

      for (let index = 0; index < heads.length; index += 1) {
        const head = heads[index];
        if (head === undefined || head.done || head.value === undefined) continue;
        if (
          selectedEvent === null ||
          head.value.eventTime < selectedEvent.eventTime ||
          (head.value.eventTime === selectedEvent.eventTime && index < selected)
        ) {
          selected = index;
          selectedEvent = head.value;
        }
      }

      if (selected === -1 || selectedEvent === null) return;
      yield selectedEvent;

      const iterator = iterators[selected];
      if (iterator === undefined) return;
      heads[selected] = await iterator.next();
    }
  } finally {
    await Promise.all(
      iterators.map(async (iterator) => {
        if (iterator.return !== undefined) await iterator.return();
      }),
    );
  }
}
