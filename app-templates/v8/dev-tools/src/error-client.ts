import { safePostMessage } from './utils/postMessage';

function formatErrorMessage(data: any): string {
  const err = data?.err || data || {};
  const message = err.message || 'Unknown compilation error occurred';
  const frame = err.frame || '';

  const loc = err.loc;
  const locString =
    loc && loc.file
      ? `\n\nFile: ${loc.file}${loc.line != null ? `:${loc.line}` : ''}${
          loc.column != null ? `:${loc.column}` : ''
        }`
      : '';

  return `${message}${frame ? `\n\n${frame}` : ''}${locString}`.trim();
}

function sendErrorToParent(errorMessage: string) {
  try {
    safePostMessage(window.parent, {
      type: 'error-fix-request',
      errorMessage,
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
    sendErrorToParent(formatErrorMessage(event.detail));
  }) as EventListener);
}

// Hook into Vite HMR for errors during development
if (import.meta.env.MODE === 'development' && import.meta.hot) {
  let hasErrorOverlay = false;

  const handleHmrError = (data: any) => {
    console.error('Vite compile error:', formatErrorMessage(data));
    hasErrorOverlay = true;
    hasDetailedError = true;
    showInactiveOverlay();
    sendErrorToParent(formatErrorMessage(data));
  };

  const handleAfterUpdate = () => {
    // Check both hasErrorOverlay (for HMR errors) and overlayElement (for initial-error,
    // where hasErrorOverlay is not set because it's scoped to this block)
    if (hasErrorOverlay || overlayElement) {
      hasErrorOverlay = false;
      hasDetailedError = false;
      removeInactiveOverlay();
      safePostMessage(window.parent, { type: 'error-fix-resolved' });
    }
  };

  // Standard Vite error event
  import.meta.hot.on('vite:error', handleHmrError);

  // Custom compile error event emitted by our error interceptor plugin
  import.meta.hot.on('compile-error', handleHmrError);

  // Recover after a successful HMR update clears a previous error
  import.meta.hot.on('vite:afterUpdate', handleAfterUpdate);

  // Clean up listeners on module disposal to prevent accumulation
  import.meta.hot.dispose(() => {
    hasErrorOverlay = false;
    hasDetailedError = false;
    removeInactiveOverlay();
    import.meta.hot!.off('vite:error', handleHmrError);
    import.meta.hot!.off('compile-error', handleHmrError);
    import.meta.hot!.off('vite:afterUpdate', handleAfterUpdate);
  });
}
