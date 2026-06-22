/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompileError,
  MAX_CONSECUTIVE_RECOVERY_RELOADS,
  presentCompileError,
  RECOVERY_RELOAD_GRACE_MS,
  resetErrorClientForTest,
} from '../error-client';

const OVERLAY_ID = 'airo-error-overlay';

type ParsedViteError = Parameters<typeof presentCompileError>[0];

function makeParsedError(overrides: Partial<ParsedViteError> = {}): ParsedViteError {
  return {
    message: 'Unexpected token (3:10)',
    file: 'src/App.tsx:3:10',
    frame: '> 3 | const x =',
    name: undefined,
    stack: undefined,
    ...overrides,
  };
}

function overlay(): HTMLElement | null {
  return document.getElementById(OVERLAY_ID);
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(`#${OVERLAY_ID} button`)).find(
    (button) => button.textContent === label,
  );
}

/**
 * Shadow the jsdom `window.parent === window` default so the module's
 * `isStandalonePreview()` check reports an embedded preview (real builder).
 */
function makeEmbedded(): { postMessage: ReturnType<typeof vi.fn> } {
  const fakeParent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true });
  return fakeParent;
}

function broadcastProcessingState(isProcessing: boolean) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'AGENT_PROCESSING_STATE', isProcessing },
      origin: 'http://localhost:3000',
    }),
  );
}

describe('error-client compile-error overlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetErrorClientForTest();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
    // Restore the jsdom default (`window.parent === window` → standalone)
    // that the embedded tests shadow with a fake parent.
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
    vi.restoreAllMocks();
  });

  describe('embedded preview', () => {
    it('shows the quiet placeholder (no error text) while the agent is fixing', () => {
      makeEmbedded();
      presentCompileError(makeParsedError());
      broadcastProcessingState(true);

      const el = overlay();
      expect(el).not.toBeNull();
      // Placeholder is a bare dim: no message, no actionable buttons.
      expect(el!.textContent).toBe('');
      expect(document.querySelector(`#${OVERLAY_ID} button`)).toBeNull();
    });

    it('escalates to an actionable overlay with the error message once the agent is idle', () => {
      makeEmbedded();
      presentCompileError(makeParsedError());
      broadcastProcessingState(false);

      const el = overlay();
      expect(el).not.toBeNull();
      expect(el!.textContent).toContain('Airo caught an error and is ready to help sort it out.');
      expect(el!.textContent).toContain('Unexpected token (3:10)');
      expect(el!.textContent).toContain('src/App.tsx:3:10');
      expect(findButton('Ask Airo to Fix It')).toBeTruthy();
      expect(findButton('Dismiss')).toBeTruthy();
    });

    it('posts error-fix-user-requested and disables the button when the user asks Airo to fix', () => {
      const fakeParent = makeEmbedded();
      presentCompileError(makeParsedError());
      broadcastProcessingState(false);

      findButton('Ask Airo to Fix It')!.click();

      const fixCall = fakeParent.postMessage.mock.calls.find(
        ([message]) => (message as { type?: string })?.type === 'error-fix-user-requested',
      );
      expect(fixCall).toBeTruthy();
      expect((fixCall![0] as { errorData: { message: string } }).errorData.message).toBe(
        'Unexpected token (3:10)',
      );
      // Button reflects the in-flight request and is disabled to prevent double-send.
      const processing = findButton('Processing...');
      expect(processing).toBeTruthy();
      expect(processing!.disabled).toBe(true);
    });

    it('auto-forwards the error to the runtime-error buffer on first present', () => {
      const fakeParent = makeEmbedded();
      presentCompileError(makeParsedError());

      const forwarded = fakeParent.postMessage.mock.calls.find(
        ([message]) => (message as { type?: string })?.type === 'error-fix-request',
      );
      expect(forwarded).toBeTruthy();
    });

    it('removes the overlay when the user dismisses it', () => {
      makeEmbedded();
      presentCompileError(makeParsedError());
      broadcastProcessingState(false);

      findButton('Dismiss')!.click();
      expect(overlay()).toBeNull();
    });
  });

  describe('standalone preview', () => {
    it('shows the actionable overlay immediately with a clipboard affordance', () => {
      // jsdom default: window.parent === window → standalone.
      presentCompileError(makeParsedError());

      const el = overlay();
      expect(el).not.toBeNull();
      expect(el!.textContent).toContain('Unexpected token (3:10)');
      expect(findButton('Copy Error for Airo')).toBeTruthy();
      // No parent agent to ask, so the embedded fix button is absent.
      expect(findButton('Ask Airo to Fix It')).toBeUndefined();
    });
  });

  it('clearCompileError tears down the overlay', () => {
    presentCompileError(makeParsedError());
    expect(overlay()).not.toBeNull();

    clearCompileError();
    expect(overlay()).toBeNull();
  });

  describe('blank-preview recovery reload', () => {
    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      sessionStorage.clear();
      reload = vi.fn();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, reload },
      });
    });

    afterEach(() => {
      sessionStorage.clear();
    });

    // Simulate a parse error that broke the initial mount: the overlay is
    // shown, the agent fixes it (HMR clears the overlay via clearCompileError),
    // but `#app` never mounted, so it stays empty.
    function setupClearedCompileErrorWithBlankApp() {
      const appEl = document.createElement('div');
      appEl.id = 'app';
      document.body.appendChild(appEl);
      makeEmbedded();
      presentCompileError(makeParsedError());
      broadcastProcessingState(true);
      // The fix's vite:afterUpdate clears the overlay while still processing.
      clearCompileError();
    }

    it('reloads once the agent finishes and the app is still blank', () => {
      setupClearedCompileErrorWithBlankApp();
      broadcastProcessingState(false);
      expect(reload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does NOT reload when the app has mounted (HMR genuinely recovered)', () => {
      setupClearedCompileErrorWithBlankApp();
      // App mounted children before the agent finished.
      document.getElementById('app')!.appendChild(document.createElement('main'));
      broadcastProcessingState(false);
      vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);
      expect(reload).not.toHaveBeenCalled();
    });

    it('does NOT reload if a new compile error appears during the grace window', () => {
      setupClearedCompileErrorWithBlankApp();
      broadcastProcessingState(false);
      // A fresh compile error lands before the grace elapses — the overlay
      // owns this, so the reload must be cancelled.
      presentCompileError(makeParsedError({ message: 'Another error' }));
      vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);
      expect(reload).not.toHaveBeenCalled();
    });

    it('does NOT reload when no compile error was seen (healthy preview)', () => {
      const appEl = document.createElement('div');
      appEl.id = 'app';
      document.body.appendChild(appEl);
      makeEmbedded();
      // Agent does unrelated work and finishes; no compile error ever shown.
      broadcastProcessingState(true);
      broadcastProcessingState(false);
      vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);
      expect(reload).not.toHaveBeenCalled();
    });

    it('does NOT reload in standalone preview (no agent to fix it)', () => {
      const appEl = document.createElement('div');
      appEl.id = 'app';
      document.body.appendChild(appEl);
      // jsdom default: window.parent === window → standalone.
      presentCompileError(makeParsedError());
      clearCompileError();
      vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);
      expect(reload).not.toHaveBeenCalled();
    });

    it('caps consecutive reloads so an unfixable parse error cannot loop', () => {
      setupClearedCompileErrorWithBlankApp();
      // The mocked reload leaves state intact, so each finished turn on a
      // still-blank app re-evaluates the budget.
      for (let attempt = 0; attempt < MAX_CONSECUTIVE_RECOVERY_RELOADS + 2; attempt++) {
        broadcastProcessingState(true);
        broadcastProcessingState(false);
        vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);
      }
      expect(reload).toHaveBeenCalledTimes(MAX_CONSECUTIVE_RECOVERY_RELOADS);
    });

    it('clears the reload budget after a later clean mount', async () => {
      sessionStorage.setItem('airo-dev-compile-recovery-reload', JSON.stringify({ count: 1 }));
      expect(sessionStorage.length).toBe(1);
      const appEl = document.createElement('div');
      appEl.id = 'app';
      document.body.appendChild(appEl);
      resetErrorClientForTest();

      vi.resetModules();
      await import('../error-client');
      appEl.appendChild(document.createElement('main'));
      await Promise.resolve();

      expect(sessionStorage.length).toBe(0);
    });

    it('clears the reload budget immediately when the app is already mounted', async () => {
      sessionStorage.setItem('airo-dev-compile-recovery-reload', JSON.stringify({ count: 1 }));
      const appEl = document.createElement('div');
      appEl.id = 'app';
      appEl.appendChild(document.createElement('main'));
      document.body.appendChild(appEl);
      resetErrorClientForTest();

      vi.resetModules();
      await import('../error-client');

      expect(sessionStorage.length).toBe(0);
    });

    it('does NOT reload when sessionStorage cannot be read', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function warn() {});
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem() {
        throw new Error('storage unavailable');
      });
      setupClearedCompileErrorWithBlankApp();
      broadcastProcessingState(false);
      vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);

      expect(reload).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[dev-tools] compile-error recovery reload disabled: failed to read sessionStorage budget',
        expect.any(Error),
      );
    });

    it('cancels a pending reload during teardown', () => {
      setupClearedCompileErrorWithBlankApp();
      broadcastProcessingState(false);
      resetErrorClientForTest();
      vi.advanceTimersByTime(RECOVERY_RELOAD_GRACE_MS);

      expect(reload).not.toHaveBeenCalled();
    });
  });
});
