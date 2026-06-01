import { logger } from '@/lib/request-context';
import { logClickEvent, logImpressionEvent } from './instrumentation';

type BusMessage = { type: string };

const handlers = new Map<string, (msg: BusMessage) => void>();

export function on<T extends BusMessage>(type: T['type'], handler: (msg: T) => void): void {
  if (handlers.has(type)) {
    logger.warn('eventBus.duplicate-registration', { type });
  }
  handlers.set(type, handler as (msg: BusMessage) => void);
}

export function dispatch(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as BusMessage;
  if (typeof m.type !== 'string') return false;
  const handler = handlers.get(m.type);
  if (!handler) return false;
  try {
    handler(m);
  } catch (err) {
    logger.error('eventBus.handler-failure', {
      type: m.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

export function _resetForTests(): void {
  handlers.clear();
}

// ── Tracking event family ─────────────────────────────────────────────────

export const TRACK_EVENT_TYPE = 'TRACK_EVENT' as const;

export type TrackEventMessage = {
  type: typeof TRACK_EVENT_TYPE;
  kind: 'click' | 'impression';
  eid: string;
  properties?: Record<string, string | number | boolean>;
};

export function registerTrackEventBus(): void {
  on<TrackEventMessage>(TRACK_EVENT_TYPE, (m) => {
    if (typeof m.eid !== 'string' || !m.eid) {
      logger.warn('eventBus.track.invalid-eid', { eid: m.eid, kind: m.kind });
      return;
    }
    if (m.kind === 'click') {
      logClickEvent(m.eid, m.properties)();
    } else if (m.kind === 'impression') {
      logImpressionEvent(m.eid, m.properties)();
    } else {
      logger.warn('eventBus.track.unknown-kind', { kind: m.kind, eid: m.eid });
    }
  });
}
