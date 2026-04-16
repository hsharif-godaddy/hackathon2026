import { safePostMessage } from './utils/postMessage';

function parseViteError(data: any): { message: string; file?: string; frame?: string } {
  const err = data?.err || data || {};
  const message = err.message || 'Unknown compilation error occurred';
  const frame = err.frame || '';

  const loc = err.loc;
  const file =
    loc && loc.file
      ? `${loc.file}${loc.line != null ? `:${loc.line}` : ''}${loc.column != null ? `:${loc.column}` : ''}`
      : undefined;

  return { message, file, frame };
}

function sendCompileErrorToParent(data: any) {
  try {
    const { message, file, frame } = parseViteError(data);
    const stack = [file && `  at ${file}`, frame && `\n${frame}`].filter(Boolean).join('\n');

    safePostMessage(window.parent, {
      type: 'error-fix-request',
      errorData: {
        message,
        name: 'CompileError',
        stack: stack || undefined,
        url: file,
        timestamp: Date.now(),
      },
    });
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

// Catch initial page load failures (import errors before HMR is connected)
if (import.meta.env.MODE === 'development') {
  window.addEventListener('vite:initial-error', ((event: CustomEvent) => {
    if (hasDetailedError) return; // HMR already sent a detailed error; ignore the generic import failure
    showInactiveOverlay();
    sendCompileErrorToParent(event.detail);

    // The error may be transient (e.g. Vite dep optimization). Watch for React
    // mounting into #app -- if children appear, the app recovered on its own.
    const appEl = document.getElementById('app');
    if (appEl) {
      const observer = new MutationObserver(() => {
        if (appEl.children.length > 0) {
          observer.disconnect();
          removeInactiveOverlay();
          safePostMessage(window.parent, { type: 'error-fix-resolved' });
        }
      });
      observer.observe(appEl, { childList: true });
      // Stop watching after 30s if nothing mounts
      setTimeout(() => observer.disconnect(), 30000);
    }
  }) as EventListener);

  // After a full page reload (e.g., recovering from a compile error), the module
  // re-initializes with clean state and the parent never receives error-fix-resolved.
  // Wait for React to actually mount into #app before signaling — sending too early
  // creates a race where error-fix-resolved clears parent dedup state, then the same
  // runtime error immediately fires error-fix-request and gets auto-sent again.
  window.addEventListener('load', () => {
    const appEl = document.getElementById('app');
    if (appEl && appEl.children.length > 0) {
      safePostMessage(window.parent, { type: 'error-fix-resolved' });
      return;
    }
    if (appEl) {
      let resolved = false;
      const observer = new MutationObserver(() => {
        if (appEl.children.length > 0) {
          resolved = true;
          observer.disconnect();
          safePostMessage(window.parent, { type: 'error-fix-resolved' });
        }
      });
      observer.observe(appEl, { childList: true });
      setTimeout(() => {
        observer.disconnect();
        // Only signal if React actually mounted — if children are still absent,
        // there's likely still an error and firing here would clear parent dedup
        // state, re-triggering the auto-send loop we're preventing.
        if (!resolved && appEl.children.length > 0) {
          safePostMessage(window.parent, { type: 'error-fix-resolved' });
        }
      }, 5000);
    }
  });
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
    // Check both hasErrorOverlay (for HMR errors) and overlayElement (for initial-error,
    // where hasErrorOverlay is not set because it's scoped to this block).
    // Sends error-fix-resolved immediately (no deferral) because compile errors flow
    // through useErrorFixState's non-runtime branch — no dedup signature is set, so a
    // premature signal can't trigger the auto-send loop.
    if (hasErrorOverlay || overlayElement) {
      hasErrorOverlay = false;
      hasDetailedError = false;
      removeInactiveOverlay();
      safePostMessage(window.parent, { type: 'error-fix-resolved' });
    }
  };

  // Handle on-demand tsc type check results from vite-tsc-plugin
  const handleTscError = (data: any) => {
    const errors = data?.errors;
    if (!errors || errors.length === 0) return;

    const first = errors[0];
    const errorLines = errors
      .map((e: any) => `${e.file}(${e.line},${e.column}): error ${e.code}: ${e.message}`);
    if (errors.length > 1) {
      const fileCount = new Set(errors.map((e: any) => e.file)).size;
      errorLines.push(`[+${errors.length - 1} more error${errors.length > 2 ? 's' : ''} across ${fileCount} file${fileCount > 1 ? 's' : ''}]`);
    }
    const message = errorLines.join('\n');

    hasErrorOverlay = true;
    hasDetailedError = true;
    showInactiveOverlay();
    sendCompileErrorToParent({
      err: {
        message,
        loc: { file: first.file, line: first.line, column: first.column },
      },
    });
  };

  // Standard Vite error event
  import.meta.hot.on('vite:error', handleHmrError);

  // Custom compile error event emitted by our error interceptor plugin
  import.meta.hot.on('compile-error', handleHmrError);

  // On-demand tsc type check errors from vite-tsc-plugin
  import.meta.hot.on('tsc-error', handleTscError);

  // tsc errors resolved (0 errors after a previous failure)
  import.meta.hot.on('tsc-error-resolved', handleAfterUpdate);

  // Recover after a successful HMR update clears a previous error
  import.meta.hot.on('vite:afterUpdate', handleAfterUpdate);

  // Clear overlay before full reload -- the reloaded page sends error-fix-resolved on load
  const handleBeforeFullReload = () => {
    if (hasErrorOverlay || overlayElement) {
      hasErrorOverlay = false;
      hasDetailedError = false;
      removeInactiveOverlay();
    }
  };
  import.meta.hot.on('vite:beforeFullReload', handleBeforeFullReload);

  // Clean up listeners on module disposal to prevent accumulation
  import.meta.hot.dispose(() => {
    hasErrorOverlay = false;
    hasDetailedError = false;
    removeInactiveOverlay();
    import.meta.hot!.off('vite:error', handleHmrError);
    import.meta.hot!.off('compile-error', handleHmrError);
    import.meta.hot!.off('tsc-error', handleTscError);
    import.meta.hot!.off('tsc-error-resolved', handleAfterUpdate);
    import.meta.hot!.off('vite:afterUpdate', handleAfterUpdate);
    import.meta.hot!.off('vite:beforeFullReload', handleBeforeFullReload);
  });
}
