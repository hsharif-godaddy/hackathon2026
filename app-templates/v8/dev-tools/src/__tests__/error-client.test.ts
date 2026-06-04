/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCompileError, presentCompileError, resetErrorClientForTest } from '../error-client';

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
      expect(el!.textContent).toContain('Unexpected token (3:10)');
      expect(el!.textContent).toContain('src/App.tsx:3:10');
      expect(findButton('Ask Airo to Fix Code')).toBeTruthy();
      expect(findButton('Dismiss')).toBeTruthy();
    });

    it('posts error-fix-user-requested and disables the button when the user asks Airo to fix', () => {
      const fakeParent = makeEmbedded();
      presentCompileError(makeParsedError());
      broadcastProcessingState(false);

      findButton('Ask Airo to Fix Code')!.click();

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
      expect(findButton('Give this error to Airo to fix')).toBeTruthy();
      // No parent agent to ask, so the embedded fix button is absent.
      expect(findButton('Ask Airo to Fix Code')).toBeUndefined();
    });
  });

  it('clearCompileError tears down the overlay', () => {
    presentCompileError(makeParsedError());
    expect(overlay()).not.toBeNull();

    clearCompileError();
    expect(overlay()).toBeNull();
  });
});
