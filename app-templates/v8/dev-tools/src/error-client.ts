import { advanceCycleId, getCurrentCycleId } from './cycle-state';
import { type BusEventType, type BusMessage, send } from './utils/eventBus';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { isOriginAllowed } from './utils/postMessage';

/**
 * postMessage helper that short-circuits when the preview is loaded
 * standalone (`window.parent === window`). Posting to self would be
 * picked up by any listeners installed on this same window and could
 * cause spurious state transitions.
 */
function postToParent<K extends BusEventType>(message: BusMessage<K>): void {
  if (window.parent === window) {
    return;
  }
  send(message);
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

type ParsedViteError = ReturnType<typeof parseViteError>;

/**
 * Build the parent-bound payload for a parsed Vite error. Shared by the
 * automatic runtime-error buffer POST (`error-fix-request`) and the
 * user-initiated fix (`error-fix-user-requested`) so both describe the
 * error identically.
 *
 * Prefer the underlying error's name (TypeError, ReferenceError, etc.)
 * when available — `vite:initial-error` wraps a genuine runtime throw
 * from the entry module, and the agent fixes it better when it sees the
 * real class. Fall back to `CompileError` only for true Vite compile
 * failures (err.name missing).
 */
function buildForwardedError(parsed: ParsedViteError): ForwardedErrorData {
  const { message, file, frame, name, stack } = parsed;
  const composedStack = [file && `  at ${file}`, frame && `\n${frame}`]
    .filter(Boolean)
    .join('\n');
  return {
    message,
    name: name ?? 'CompileError',
    stack: stack ?? (composedStack || undefined),
    url: file,
    timestamp: Date.now(),
    cycleId: getCurrentCycleId(),
  };
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

function sendCompileErrorToParent(parsed: ParsedViteError) {
  try {
    notifyParentOfError(buildForwardedError(parsed));
  } catch (err) {
    console.error('Failed to send message to parent from error-client:', err);
  }
}

// Mirrors AiroErrorBoundary.PROCESSING_STATE_SYNC_TIMEOUT_MS so compile and
// runtime error overlays behave identically: show a quiet placeholder until
// the parent reports whether the agent is actively fixing, then either keep
// the placeholder (processing) or upgrade to the actionable overlay (idle).
const PROCESSING_STATE_SYNC_TIMEOUT_MS = 500;

const isStandalonePreview = () => window.parent === window;

let overlayElement: HTMLDivElement | null = null;
// True once an HMR error has been sent — suppresses the generic dynamic-import error
// that fires moments later from index.html's import().catch().
let hasDetailedError = false;
// The compile error currently on screen (null when the preview is healthy).
let currentError: ParsedViteError | null = null;
// Parent agent state, learned via `AGENT_PROCESSING_STATE`. While the agent is
// fixing we keep the quiet placeholder instead of flashing a scary error card;
// compile errors fire transiently mid-edit as the agent rewrites a file.
let isAgentProcessing = false;
let hasProcessingSync = false;
let isFixRequested = false;
let copiedToClipboard = false;
let processingSyncTimer: ReturnType<typeof setTimeout> | null = null;
let processingStateHandler: ((event: MessageEvent) => void) | null = null;

function removeErrorOverlay() {
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
}

/**
 * Tear down the compile-error surface and reset all related state. Called
 * when an HMR update clears the error, when React recovers on its own, or
 * when the user dismisses the overlay.
 *
 * Exported for tests; at runtime it's driven by the HMR/initial-error
 * handlers below.
 */
export function clearCompileError() {
  currentError = null;
  isFixRequested = false;
  copiedToClipboard = false;
  hasDetailedError = false;
  if (processingSyncTimer !== null) {
    clearTimeout(processingSyncTimer);
    processingSyncTimer = null;
  }
  removeErrorOverlay();
}

/**
 * Full state reset for tests. Clears the current error and the agent-state
 * singletons that `clearCompileError` intentionally leaves intact at
 * runtime (processing state outlives any single error), and detaches the
 * `AGENT_PROCESSING_STATE` listener so each test starts clean.
 */
export function resetErrorClientForTest() {
  clearCompileError();
  isAgentProcessing = false;
  hasProcessingSync = false;
  if (processingStateHandler) {
    window.removeEventListener('message', processingStateHandler);
    processingStateHandler = null;
  }
}

function createOverlayButton(
  text: string,
  variant: 'primary' | 'secondary',
  onClick: () => void,
  opts: { disabled?: boolean } = {},
): HTMLButtonElement {
  const isPrimary = variant === 'primary';
  const disabled = Boolean(opts.disabled);
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-airo-dev-tools', '');
  button.disabled = disabled;
  button.textContent = text;
  button.style.cssText = `
    background-color: ${isPrimary ? 'var(--color-primary)' : 'var(--color-surface)'};
    color: ${isPrimary ? 'var(--color-surface)' : 'var(--color-primary)'};
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: ${isPrimary ? 'none' : '2px solid var(--color-primary)'};
    cursor: ${disabled ? 'not-allowed' : 'pointer'};
    transition: all 0.2s ease-in-out;
    font-size: 0.875rem;
    font-weight: 500;
    opacity: ${disabled ? '0.6' : '1'};
  `;
  if (!disabled) {
    button.addEventListener('click', onClick);
  }
  return button;
}

/**
 * Quiet translucent placeholder shown while the agent is actively fixing
 * (or before the first processing-state sync). The old `#app` content stays
 * visible underneath; we only dim it so the user knows the preview is being
 * worked on without flashing a full error card on every mid-edit HMR.
 */
function buildPlaceholderOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'airo-error-overlay';
  overlay.setAttribute('data-airo-dev-tools', '');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    background-color: rgba(255, 255, 255, 0.7);
    pointer-events: all;
  `;
  return overlay;
}

/**
 * The actionable error overlay shown when the agent is idle and the compile
 * error is unresolved. Mirrors `AiroErrorBoundary`'s `MessageOverlay`: title,
 * the error message + location, and a "Ask Airo to Fix Code" action (or a
 * clipboard-copy affordance when the preview is loaded standalone).
 */
function buildActionableOverlay(parsed: ParsedViteError): HTMLDivElement {
  const standalone = isStandalonePreview();

  const overlay = document.createElement('div');
  overlay.id = 'airo-error-overlay';
  overlay.setAttribute('data-airo-dev-tools', '');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999998;
    background-color: rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(2px);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 40rem;
    text-align: left;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: var(--color-surface);
    padding: 2rem;
    border-radius: 1rem;
    box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);
    width: calc(100vw - 2em);
  `;

  const title = document.createElement('h1');
  title.textContent = 'Something went wrong';
  title.style.cssText = 'font-size: 1.5rem; font-weight: 600; color: var(--color-text-primary); margin: 0;';

  const message = document.createElement('pre');
  message.textContent = parsed.file ? `${parsed.message}\n\n${parsed.file}` : parsed.message;
  message.style.cssText = `
    color: var(--color-text-tertiary);
    font-size: 0.875rem;
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
    line-height: 1.4;
  `;

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 1rem; justify-content: flex-end; flex-wrap: wrap;';
  actions.appendChild(createOverlayButton('Dismiss', 'secondary', clearCompileError));
  if (standalone) {
    actions.appendChild(
      createOverlayButton(
        copiedToClipboard ? 'Copied — paste into Airo' : 'Give this error to Airo to fix',
        'primary',
        () => copyErrorToClipboard(parsed),
      ),
    );
  } else {
    actions.appendChild(
      createOverlayButton(
        isFixRequested ? 'Processing...' : 'Ask Airo to Fix Code',
        'primary',
        () => requestAgentFix(parsed),
        { disabled: isFixRequested },
      ),
    );
  }

  card.appendChild(title);
  card.appendChild(message);
  card.appendChild(actions);
  overlay.appendChild(card);
  return overlay;
}

/**
 * Render (or re-render) the overlay for `currentError`. While the agent is
 * processing — or before the first processing-state sync, and never in
 * standalone mode where there's no agent — we show the quiet placeholder;
 * otherwise the actionable overlay. Rebuilt from scratch each call so stale
 * click handlers and button states never linger.
 */
function renderErrorOverlay() {
  if (!currentError) {
    removeErrorOverlay();
    return;
  }
  injectDevToolsStyles();
  removeErrorOverlay();
  const showPlaceholder = !isStandalonePreview() && (!hasProcessingSync || isAgentProcessing);
  overlayElement = showPlaceholder
    ? buildPlaceholderOverlay()
    : buildActionableOverlay(currentError);
  document.body.appendChild(overlayElement);
}

function ensureProcessingStateListener() {
  if (processingStateHandler) return;
  processingStateHandler = (event: MessageEvent) => {
    if (!event.origin || !isOriginAllowed(event)) return;
    if (event.data?.type !== 'AGENT_PROCESSING_STATE') return;
    const nowProcessing = Boolean(event.data.isProcessing);
    isAgentProcessing = nowProcessing;
    hasProcessingSync = true;
    // The agent stopped while a fix was outstanding: it either applied a
    // fix (HMR/reload will clear us) or gave up. Re-enable the button so
    // the user can retry from the re-shown overlay.
    if (!nowProcessing) isFixRequested = false;
    renderErrorOverlay();
  };
  window.addEventListener('message', processingStateHandler);
}

function requestProcessingState() {
  try {
    send({ type: 'request-processing-state' });
  } catch (err) {
    console.warn('[dev-tools] request-processing-state postMessage failed:', err);
  }
}

/**
 * Present a parsed Vite compile/parse error to the user. Forwards the
 * payload to the parent for the runtime-error buffer (auto-fix path) and,
 * when embedded, syncs the agent's processing state so the overlay only
 * escalates to the actionable card once the agent is idle.
 *
 * Exported for tests; at runtime it's driven by the HMR/initial-error
 * handlers below.
 */
export function presentCompileError(parsed: ParsedViteError) {
  currentError = parsed;
  isFixRequested = false;
  copiedToClipboard = false;
  sendCompileErrorToParent(parsed);

  if (isStandalonePreview()) {
    hasProcessingSync = true;
    isAgentProcessing = false;
    renderErrorOverlay();
    return;
  }

  ensureProcessingStateListener();
  requestProcessingState();
  if (!hasProcessingSync && processingSyncTimer === null) {
    processingSyncTimer = setTimeout(() => {
      processingSyncTimer = null;
      if (!hasProcessingSync) {
        hasProcessingSync = true;
        renderErrorOverlay();
      }
    }, PROCESSING_STATE_SYNC_TIMEOUT_MS);
  }
  renderErrorOverlay();
}

function requestAgentFix(parsed: ParsedViteError) {
  if (isFixRequested) return;
  isFixRequested = true;
  try {
    send({
      type: 'error-fix-user-requested',
      errorData: buildForwardedError(parsed),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'SecurityError') {
      // Cross-origin misconfiguration (wrong VITE_PARENT_ORIGIN). Leave the
      // button disabled — re-clicking would hit the same failure — and log
      // a diagnostic pointing at the likely cause.
      console.error('Failed to send fix request to parent: SecurityError (check VITE_PARENT_ORIGIN):', err);
    } else {
      console.error('Failed to send fix request to parent:', err);
      isFixRequested = false;
    }
  }
  renderErrorOverlay();
}

async function copyErrorToClipboard(parsed: ParsedViteError) {
  const parts = [
    `${parsed.name ?? 'CompileError'}: ${parsed.message}`,
    parsed.file && `\nLocation: ${parsed.file}`,
    parsed.frame && `\n${parsed.frame}`,
  ].filter(Boolean);
  try {
    await navigator.clipboard.writeText(parts.join('\n'));
    copiedToClipboard = true;
    renderErrorOverlay();
    setTimeout(() => {
      copiedToClipboard = false;
      if (currentError) renderErrorOverlay();
    }, 2000);
  } catch (err) {
    console.error('Failed to copy error to clipboard:', err);
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
    presentCompileError(parseViteError(event.detail));

    // The error may be transient (e.g. Vite dep optimization). Watch for React
    // mounting into #app -- if children appear, the app recovered on its own,
    // so we can tear down the local overlay.
    const appEl = document.getElementById('app');
    if (appEl) {
      const observer = new MutationObserver(() => {
        if (appEl.children.length > 0) {
          observer.disconnect();
          clearCompileError();
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
  const handleHmrError = (data: any) => {
    const parsed = parseViteError(data);
    console.error('Vite compile error:', parsed.file ? `${parsed.message} (${parsed.file})` : parsed.message);
    hasDetailedError = true;
    presentCompileError(parsed);
  };

  const handleAfterUpdate = () => {
    // On a successful HMR update that follows an error, tear down the
    // overlay we showed (covers both HMR and initial-error surfaces).
    if (currentError || overlayElement) {
      clearCompileError();
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
    if (currentError || overlayElement) {
      clearCompileError();
    }
    beginNewRenderCycle();
  };
  import.meta.hot.on('vite:beforeFullReload', handleBeforeFullReload);

  // Clean up listeners on module disposal to prevent accumulation
  import.meta.hot.dispose(() => {
    clearCompileError();
    if (processingStateHandler) {
      window.removeEventListener('message', processingStateHandler);
      processingStateHandler = null;
    }
    import.meta.hot!.off('vite:error', handleHmrError);
    import.meta.hot!.off('compile-error', handleHmrError);
    import.meta.hot!.off('vite:afterUpdate', handleAfterUpdate);
    import.meta.hot!.off('vite:beforeUpdate', handleBeforeUpdate);
    import.meta.hot!.off('vite:beforeFullReload', handleBeforeFullReload);
  });
}
