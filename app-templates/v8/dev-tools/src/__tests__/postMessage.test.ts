/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safePostMessage } from '../utils/postMessage';

function makeTargetWindow(postMessage: (message: unknown, origin: string) => void): Window {
  return { postMessage } as unknown as Window;
}

describe('safePostMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards a cloneable payload verbatim to the target window', () => {
    const post = vi.fn();
    const target = makeTargetWindow(post);
    safePostMessage(target, { type: 'EDIT_WITH_AI', data: { className: 'card' } });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual({ type: 'EDIT_WITH_AI', data: { className: 'card' } });
  });

  it('retries with a JSON-sanitized copy when the first attempt throws DataCloneError', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const post = vi.fn().mockImplementation((message: unknown) => {
      calls += 1;
      if (calls === 1) {
        const err = new DOMException('could not be cloned', 'DataCloneError');
        throw err;
      }
      return message;
    });
    const target = makeTargetWindow(post);
    // Date coerces to an ISO string through JSON round-trip; `undefined`
    // is dropped entirely. Both are observable, so the retry can't secretly
    // skip sanitization.
    const when = new Date('2026-04-28T12:00:00.000Z');
    safePostMessage(target, { type: 'EDIT_WITH_AI', when, skipped: undefined });
    expect(post).toHaveBeenCalledTimes(2);
    const retryPayload = post.mock.calls[1][0] as { type: string; when: unknown; skipped?: unknown };
    expect(retryPayload.type).toBe('EDIT_WITH_AI');
    expect(typeof retryPayload.when).toBe('string');
    expect(retryPayload.when).toBe('2026-04-28T12:00:00.000Z');
    expect('skipped' in retryPayload).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('JSON-sanitized'),
      'EDIT_WITH_AI',
    );
  });

  it('drops the payload with a warning when JSON sanitization also fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const post = vi.fn().mockImplementation(() => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    });
    const target = makeTargetWindow(post);
    const circular: Record<string, unknown> = { type: 'CIRCULAR' };
    circular.self = circular;
    expect(() => safePostMessage(target, circular)).not.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped postMessage'),
      'CIRCULAR',
      expect.any(Error),
    );
  });

  it('logs a SecurityError-specific warning when the JSON-sanitized retry is blocked by origin policy', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const post = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        throw new DOMException('could not be cloned', 'DataCloneError');
      }
      // Retry blocked by cross-origin policy.
      throw new DOMException('blocked a frame with origin ...', 'SecurityError');
    });
    const target = makeTargetWindow(post);
    expect(() => safePostMessage(target, { type: 'EDIT_WITH_AI' })).not.toThrow();
    expect(post).toHaveBeenCalledTimes(2);
    const calledWith = warn.mock.calls.map(args => args[0] as string);
    expect(calledWith.some(msg => msg.includes('SecurityError on retry'))).toBe(true);
    expect(calledWith.some(msg => msg.includes('non-cloneable'))).toBe(false);
  });

  it('rethrows non-DataCloneError exceptions from postMessage', () => {
    const post = vi.fn().mockImplementation(() => {
      throw new DOMException('blocked a frame with origin ...', 'SecurityError');
    });
    const target = makeTargetWindow(post);
    expect(() => safePostMessage(target, { type: 'NOPE' })).toThrow(DOMException);
  });
});
