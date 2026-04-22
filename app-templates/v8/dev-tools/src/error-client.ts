import { safePostMessage } from './utils/postMessage';
import { advanceCycleId, getCurrentCycleId } from './cycle-state';

/**
 * postMessage helper that short-circuits when the preview is loaded
 * standalone (`window.parent === window`). Posting to self would be
 * picked up by any listeners installed on this same window and could
 * cause spurious state transitions.
 */
function postToParent(message: unknown): void {
  if (window.parent === window) {
    return;
  }
  safePostMessage(window.parent, message);
}

/**
 * Advance to a new render generation and announce it to the parent.
 * Called from Vite HMR events (`vite:beforeUpdate`, `vite:beforeFullReload`)
 * and once at module init to cover cold-start / full-reload scenarios.
 *
 * The parent is responsible for forwarding the announcement to
 * `POST /apps/:id/runtime-errors/cycle`; that server endpoint then
 * evicts buffered errors tagged with an older cycleId so the post-stream
 * validator only ever sees errors from the currently rendering code.
 *
 * The counter itself lives in `./cycle-state.ts` so `AiroErrorBoundary`
 * can read it without pulling this module's import-time side effects
 * (HMR listeners, initial cycle beacon) into production bundles.
 */
function beginNewRenderCycle(): void {
  const cycleId = advanceCycleId();
  try {
    postToParent({ type: 'runtime-errors-cycle', cycleId });
  } catch (err) {
    console.error('Failed to announce runtime-error cycle to parent:', err);
  }
}

function parseViteError(data: any): {
  message: string;
  file?: string;
  frame?: string;
  name?: string;
  stack?: string;
} {
  const err = data?.err || data || {};
  const message = err.message || 'Unknown compilation error occurred';
  const frame = err.frame || '';
  const name = typeof err.name === 'string' && err.name.length > 0 ? err.name : undefined;
  const stack = typeof err.stack === 'string' && err.stack.length > 0 ? err.stack : undefined;

  const loc = err.loc;
  const file =
    loc && loc.file
      ? `${loc.file}${loc.line != null ? `:${loc.line}` : ''}${loc.column != null ? `:${loc.column}` : ''}`
      : undefined;

  return { message, file, frame, name, stack };
}

interface ForwardedErrorData {
  message: string;
  name: string;
  stack?: string;
  url?: string;
  timestamp: number;
  cycleId: number;
}

/**
 * Forward a Vite compile/initial error to the parent builder so it can
 * post the payload to the agents' authenticated runtime-error buffer for
 * the next-turn post-hook. Async runtime errors take a different path —
 * `AiroErrorBoundary` handles those once React has mounted — so this
 * helper is only used for the Vite-specific events below.
 *
 * On top-level pages (preview loaded standalone rather than embedded in
 * the builder) `window.parent === window`; `postToParent` short-circuits
 * so we don't post messages to ourself.
 */
function notifyParentOfError(errorData: ForwardedErrorData): void {
  try {
    postToParent({
      type: 'error-fix-request',
      errorData
    });
  } catch (err) {
    console.error('Failed to notify parent of error:', err);
  }
}

function sendCompileErrorToParent(data: any) {
  try {
    const parsed = parseViteError(data);
    const { message, file, frame, name: parsedName, stack: parsedStack } = parsed;
    // Prefer the underlying error's name (TypeError, ReferenceError, etc.)
    // when available — `vite:initial-error` wraps a genuine runtime throw
    // from the entry module, and the agent fixes it better when it sees
    // the real class. Fall back to `CompileError` only for true Vite
    // compile failures (err.name missing).
    const name = parsedName ?? 'CompileError';
    const composedStack = [file && `  at ${file}`, frame && `\n${frame}`]
      .filter(Boolean)
      .join('\n');
    const errorData: ForwardedErrorData = {
      message,
      name,
      stack: parsedStack ?? (composedStack || undefined),
      url: file,
      timestamp: Date.now(),
      cycleId: getCurrentCycleId()
    };

    notifyParentOfError(errorData);
  } catch (err) {
    console.error('Failed to send message to parent from error-client:', err);
  }
}

let overlayElement: HTMLDivElement | null = null;
// True once an HMR error has been sent — suppresses the generic dynamic-import error
// that fires moments later from index.html's import().catch().
let hasDetailedError = false;

function showInactiveOverlay() {
  if (overlayElement) return; // Already showing

  const overlay = document.createElement('div');
  overlay.id = 'airo-error-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    background-color: rgba(255, 255, 255, 0.7);
    pointer-events: all;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  document.body.appendChild(overlay);
  overlayElement = overlay;
}

function removeInactiveOverlay() {
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
}

// Announce the initial cycle to the parent as soon as this module loads.
// Full-page reloads re-run this module (it's dynamically imported from
// `index.html` under the dev-mode guard) and the server sees a fresh
// cycleId, so any stale entries from the prior page session are evicted
// before the next render starts throwing.
beginNewRenderCycle();

// Catch initial page load failures (import errors before HMR is connected).
//
// Global `window.error` / `unhandledrejection` capture is owned by
// `AiroErrorBoundary` (see its `componentDidMount`) so there's a single
// path from "async error" → parent POST, which also drives the in-iframe
// overlay. Doubling the capture here would produce two POSTs per error
// (the buffer's push-dedup window collapses them today, but that's a
// correctness trap if the dedup ever loosens). This file is now solely
// responsible for Vite-specific events.
if (import.meta.env.MODE === 'development') {
  window.addEventListener('vite:initial-error', ((event: CustomEvent) => {
    if (hasDetailedError) return; // HMR already sent a detailed error; ignore the generic import failure
    showInactiveOverlay();
    sendCompileErrorToParent(event.detail);

    // The error may be transient (e.g. Vite dep optimization). Watch for React
    // mounting into #app -- if children appear, the app recovered on its own,
    // so we can tear down the local overlay.
    const appEl = document.getElementById('app');
    if (appEl) {
      const observer = new MutationObserver(() => {
        if (appEl.children.length > 0) {
          observer.disconnect();
          removeInactiveOverlay();
        }
      });
      observer.observe(appEl, { childList: true });
      // Stop watching after 30s if nothing mounts
      setTimeout(() => observer.disconnect(), 30000);
    }
  }) as EventListener);
}

// Hook into Vite HMR for errors during development
if (import.meta.env.MODE === 'development' && import.meta.hot) {
  let hasErrorOverlay = false;

  const handleHmrError = (data: any) => {
    const { message, file } = parseViteError(data);
    console.error('Vite compile error:', file ? `${message} (${file})` : message);
    hasErrorOverlay = true;
    hasDetailedError = true;
    showInactiveOverlay();
    sendCompileErrorToParent(data);
  };

  const handleAfterUpdate = () => {
    // Check both hasErrorOverlay (for HMR errors) and overlayElement (for
    // initial-error, where hasErrorOverlay is not set because it's scoped
    // to this block). On a successful HMR update that follows an error,
    // tear down the inactive overlay we showed.
    if (hasErrorOverlay || overlayElement) {
      hasErrorOverlay = false;
      hasDetailedError = false;
      removeInactiveOverlay();
    }
  };

  // Start a fresh render generation before each HMR update applies.
  // Fires BEFORE the new module code runs, so the cycle rotation lands
  // at the server first and any buffered errors from the about-to-be-
  // replaced render are evicted. Errors thrown by the subsequent render
  // will be POSTed under the new cycleId and surface on the next
  // validator drain.
  const handleBeforeUpdate = () => {
    beginNewRenderCycle();
  };

  // Standard Vite error event
  import.meta.hot.on('vite:error', handleHmrError);

  // Custom compile error event emitted by our error interceptor plugin
  import.meta.hot.on('compile-error', handleHmrError);

  // Recover after a successful HMR update clears a previous error
  import.meta.hot.on('vite:afterUpdate', handleAfterUpdate);

  // New render generation marker
  import.meta.hot.on('vite:beforeUpdate', handleBeforeUpdate);

  // Clear overlay before full reload so a stale one doesn't flash as the
  // new page is initializing. Also start a new cycle here: even though
  // the full reload will re-run this module (and fire `beginNewRenderCycle`
  // again at top-level), announcing it now guarantees a rotation lands
  // at the server even if the new page's init never runs (e.g. the
  // reload fails partway).
  const handleBeforeFullReload = () => {
    if (hasErrorOverlay || overlayElement) {
      hasErrorOverlay = false;
      hasDetailedError = false;
      removeInactiveOverlay();
    }
    beginNewRenderCycle();
  };
  import.meta.hot.on('vite:beforeFullReload', handleBeforeFullReload);

  // Clean up listeners on module disposal to prevent accumulation
  import.meta.hot.dispose(() => {
    hasErrorOverlay = false;
    hasDetailedError = false;
    removeInactiveOverlay();
    import.meta.hot!.off('vite:error', handleHmrError);
    import.meta.hot!.off('compile-error', handleHmrError);
    import.meta.hot!.off('vite:afterUpdate', handleAfterUpdate);
    import.meta.hot!.off('vite:beforeUpdate', handleBeforeUpdate);
    import.meta.hot!.off('vite:beforeFullReload', handleBeforeFullReload);
  });
}
