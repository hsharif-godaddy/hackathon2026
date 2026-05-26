/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

vi.mock('../../utils/postMessage', () => ({
  safePostMessage: vi.fn(),
  isOriginAllowed: vi.fn(),
}));

import { useSpeechBridge } from '../useSpeechBridge';
import { safePostMessage, isOriginAllowed } from '../../utils/postMessage';

const ALLOWED_ORIGIN = 'http://localhost:3000';

function dispatchMessage(data: unknown, origin: string = ALLOWED_ORIGIN): void {
  const event = new MessageEvent('message', { data, origin });
  window.dispatchEvent(event);
}

describe('useSpeechBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default treat the allowed-origin sender as trusted, anything else as untrusted.
    (isOriginAllowed as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (event: MessageEvent) => event.origin === ALLOWED_ORIGIN,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('starts with isSupported=false, isListening=false, transcript="" before any messages', () => {
    const { result } = renderHook(() => useSpeechBridge());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
  });

  it('updates isSupported when SPEECH_SUPPORT messages arrive', () => {
    const { result } = renderHook(() => useSpeechBridge());

    act(() => {
      dispatchMessage({ type: 'SPEECH_SUPPORT', data: { supported: true } });
    });
    expect(result.current.isSupported).toBe(true);

    act(() => {
      dispatchMessage({ type: 'SPEECH_SUPPORT', data: { supported: false } });
    });
    expect(result.current.isSupported).toBe(false);
  });

  it('updates isListening from SPEECH_LISTENING and clears transcript when listening stops', () => {
    const { result } = renderHook(() => useSpeechBridge());

    act(() => {
      dispatchMessage({ type: 'SPEECH_LISTENING', data: { listening: true } });
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      dispatchMessage({ type: 'SPEECH_TRANSCRIPT', data: { transcript: 'hi there' } });
    });
    expect(result.current.transcript).toBe('hi there');

    act(() => {
      dispatchMessage({ type: 'SPEECH_LISTENING', data: { listening: false } });
    });
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
  });

  it('updates transcript on SPEECH_TRANSCRIPT messages', () => {
    const { result } = renderHook(() => useSpeechBridge());

    act(() => {
      dispatchMessage({ type: 'SPEECH_TRANSCRIPT', data: { transcript: 'hello world' } });
    });
    expect(result.current.transcript).toBe('hello world');
  });

  it('ignores messages from disallowed origins', () => {
    const { result } = renderHook(() => useSpeechBridge());

    act(() => {
      dispatchMessage(
        { type: 'SPEECH_SUPPORT', data: { supported: true } },
        'https://malicious.com',
      );
      dispatchMessage(
        { type: 'SPEECH_LISTENING', data: { listening: true } },
        'https://malicious.com',
      );
      dispatchMessage(
        { type: 'SPEECH_TRANSCRIPT', data: { transcript: 'pwned' } },
        'https://malicious.com',
      );
    });

    expect(result.current.isSupported).toBe(false);
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
  });

  it('toggle() posts SPEECH_START when not listening and SPEECH_STOP when listening', () => {
    const { result } = renderHook(() => useSpeechBridge());

    // Pretend we're inside an iframe so window.parent !== window.
    const fakeParent = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(window, 'parent', { configurable: true, value: fakeParent });

    act(() => {
      result.current.toggle();
    });
    expect(safePostMessage).toHaveBeenCalledTimes(1);
    expect(safePostMessage).toHaveBeenLastCalledWith(fakeParent, { type: 'SPEECH_START' });

    act(() => {
      dispatchMessage({ type: 'SPEECH_LISTENING', data: { listening: true } });
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(safePostMessage).toHaveBeenCalledTimes(2);
    expect(safePostMessage).toHaveBeenLastCalledWith(fakeParent, { type: 'SPEECH_STOP' });
  });

  it('toggle() is a no-op at the top level (window.parent === window)', () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window });
    const { result } = renderHook(() => useSpeechBridge());

    act(() => {
      result.current.toggle();
    });

    expect(safePostMessage).not.toHaveBeenCalled();
  });
});
