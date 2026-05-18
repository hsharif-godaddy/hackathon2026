/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addStyleEditListener, StyleMessageEventType, STYLE_REPLY_TIMEOUT_MS } from '../elementStyleListeners';

function dispatch(data: Record<string, unknown>, source: unknown = window.parent): void {
  const event = new MessageEvent('message', { data, source: source as MessageEventSource });
  window.dispatchEvent(event);
}

describe('addStyleEditListener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a non-empty commitId string', () => {
    const commitId = addStyleEditListener(() => {});
    expect(typeof commitId).toBe('string');
    expect(commitId.length).toBeGreaterThan(0);
  });

  it('returns a unique commitId on each call', () => {
    const ids = new Set(Array.from({ length: 20 }, () => addStyleEditListener(() => {})));
    expect(ids.size).toBe(20);
  });

  it('calls handler on EDIT_SUCCEEDED with matching commitId', () => {
    const handler = vi.fn();
    const commitId = addStyleEditListener(handler);

    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('calls handler on EDIT_FAILED with matching commitId', () => {
    const handler = vi.fn();
    const commitId = addStyleEditListener(handler);

    dispatch({ type: StyleMessageEventType.EDIT_FAILED, commitId });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call handler for a different commitId', () => {
    const handler = vi.fn();
    addStyleEditListener(handler);

    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId: 'wrong-id' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not call handler for unrelated message types', () => {
    const handler = vi.fn();
    const commitId = addStyleEditListener(handler);

    dispatch({ type: StyleMessageEventType.UPDATED, commitId });
    dispatch({ type: 'SOME_OTHER_EVENT', commitId });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not call handler for messages from a source other than window.parent', () => {
    const handler = vi.fn();
    const commitId = addStyleEditListener(handler);

    // Use an object that is definitely not window.parent (jsdom sets window.parent === window,
    // so we need a distinct reference to simulate a different source frame).
    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId }, {} as MessageEventSource);

    expect(handler).not.toHaveBeenCalled();
  });

  it('only fires once — detaches after the first matching reply', () => {
    const handler = vi.fn();
    const commitId = addStyleEditListener(handler);

    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId });
    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not cross-talk between two concurrent listeners', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const commitIdA = addStyleEditListener(handlerA);
    const commitIdB = addStyleEditListener(handlerB);

    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId: commitIdA });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).not.toHaveBeenCalled();

    dispatch({ type: StyleMessageEventType.EDIT_FAILED, commitId: commitIdB });

    expect(handlerB).toHaveBeenCalledOnce();
  });

  it('auto-detaches after STYLE_REPLY_TIMEOUT_MS without a reply', () => {
    const handler = vi.fn();
    addStyleEditListener(handler);

    vi.advanceTimersByTime(STYLE_REPLY_TIMEOUT_MS);

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire handler after the timeout has already detached it', () => {
    const handler = vi.fn();
    const commitId = addStyleEditListener(handler);

    vi.advanceTimersByTime(STYLE_REPLY_TIMEOUT_MS);
    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId });

    expect(handler).not.toHaveBeenCalled();
  });

  it('cancels the timeout when the reply arrives before it fires', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const commitId = addStyleEditListener(() => {});

    dispatch({ type: StyleMessageEventType.EDIT_SUCCEEDED, commitId });
    vi.advanceTimersByTime(STYLE_REPLY_TIMEOUT_MS);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a warning when the timeout fires', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    addStyleEditListener(() => {});

    vi.advanceTimersByTime(STYLE_REPLY_TIMEOUT_MS);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('timed out');
  });
});
