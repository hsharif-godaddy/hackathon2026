import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./instrumentation', () => ({
  logClickEvent: vi.fn(function () { return vi.fn(); }),
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));

import { logger } from '@/lib/request-context';
import {
  _resetForTests,
  dispatch,
  on,
  registerTrackEventBus,
  TRACK_EVENT_TYPE,
} from './eventBus';
import { logClickEvent, logImpressionEvent } from './instrumentation';

describe('eventBus dispatch primitive', () => {
  beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
  });

  it('dispatch returns false when input is not a message-shaped object', () => {
    expect(dispatch(null)).toBe(false);
    expect(dispatch(undefined)).toBe(false);
    expect(dispatch('string')).toBe(false);
    expect(dispatch(42)).toBe(false);
    expect(dispatch({})).toBe(false);
    expect(dispatch({ type: 123 })).toBe(false);
  });

  it('dispatch returns false for unregistered type', () => {
    expect(dispatch({ type: 'UNKNOWN' })).toBe(false);
  });

  it('on registers a handler and dispatch invokes it with the full message', () => {
    const handler = vi.fn();
    on<{ type: 'X'; payload: number }>('X', handler);
    expect(dispatch({ type: 'X', payload: 7 })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ type: 'X', payload: 7 });
  });

  it('dispatch returns true when handler runs', () => {
    on('Y', () => {});
    expect(dispatch({ type: 'Y' })).toBe(true);
  });

  it('handler exception is caught and logged, dispatch still returns true', () => {
    on('Z', () => {
      throw new Error('boom');
    });
    expect(dispatch({ type: 'Z' })).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      'eventBus.handler-failure',
      expect.objectContaining({ type: 'Z', error: 'boom' }),
    );
  });

  it('duplicate registration logs a warning', () => {
    on('DUP', () => {});
    on('DUP', () => {});
    expect(logger.warn).toHaveBeenCalledWith('eventBus.duplicate-registration', { type: 'DUP' });
  });
});

describe('eventBus track family', () => {
  beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
    registerTrackEventBus();
  });

  it('TRACK_EVENT_TYPE is "TRACK_EVENT"', () => {
    expect(TRACK_EVENT_TYPE).toBe('TRACK_EVENT');
  });

  it('routes click events to logClickEvent', () => {
    dispatch({
      type: TRACK_EVENT_TYPE,
      kind: 'click',
      eid: 'devtools.toolbar.bold',
      properties: { surface: 'text' },
    });
    expect(logClickEvent).toHaveBeenCalledWith('devtools.toolbar.bold', { surface: 'text' });
  });

  it('routes impression events to logImpressionEvent', () => {
    dispatch({
      type: TRACK_EVENT_TYPE,
      kind: 'impression',
      eid: 'devtools.toolbar.view',
      properties: { surface: 'image' },
    });
    expect(logImpressionEvent).toHaveBeenCalledWith('devtools.toolbar.view', { surface: 'image' });
  });

  it('drops events with empty/non-string eid and warns', () => {
    dispatch({ type: TRACK_EVENT_TYPE, kind: 'click', eid: '' });
    dispatch({ type: TRACK_EVENT_TYPE, kind: 'click', eid: 123 as unknown as string });
    expect(logClickEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('eventBus.track.invalid-eid', expect.any(Object));
  });

  it('drops events with unknown kind and warns', () => {
    dispatch({ type: TRACK_EVENT_TYPE, kind: 'rumble' as 'click', eid: 'x.y.z' });
    expect(logClickEvent).not.toHaveBeenCalled();
    expect(logImpressionEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'eventBus.track.unknown-kind',
      expect.objectContaining({ kind: 'rumble' }),
    );
  });

  it('dispatch returns true even when track event is dropped (consumed)', () => {
    expect(dispatch({ type: TRACK_EVENT_TYPE, kind: 'click', eid: '' })).toBe(true);
    expect(dispatch({ type: TRACK_EVENT_TYPE, kind: 'rumble' as 'click', eid: 'x.y.z' })).toBe(true);
  });
});
