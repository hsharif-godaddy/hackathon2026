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
  console.log('Sending error message to parent from error-client:', errorMessage);
  try {
    safePostMessage(window.parent, {
      type: 'error-fix-request',
      errorMessage,
    });
  } catch (err) {
    console.error('Failed to send message to parent from error-client:', err);
  }
}

function renderErrorOverlay(rawError: any) {
  const root = document.getElementById('app') || document.body;
  if (!root) return;

  const errorMessage = formatErrorMessage(rawError);

  // Clear existing content safely
  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  // Create container
  const container = document.createElement('div');
  container.style.cssText = `
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #ffffff;
    padding: 1rem;
    box-sizing: border-box;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  // Create inner content wrapper
  const innerWrapper = document.createElement('div');
  innerWrapper.style.cssText = `
    max-width: 56rem;
    margin: 0 auto;
    text-align: center;
  `;

  // Create heading
  const heading = document.createElement('h1');
  heading.style.cssText = `
    font-size: 1.5rem;
    font-weight: bold;
    color: #dc2626;
    margin-bottom: 1rem;
  `;
  heading.textContent = 'Something went wrong';

  // Create error message pre element
  const pre = document.createElement('pre');
  pre.style.cssText = `
    color: #6b7280;
    margin-bottom: 1.5rem;
    background-color: #f3f4f6;
    padding: 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    white-space: pre-wrap;
    text-align: left;
    max-width: 100%;
    max-height: 400px;
    overflow-y: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  `;
  // Use textContent for safe text rendering - automatically escapes HTML
  pre.textContent = errorMessage;

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    justify-content: center;
    margin-top: 0.5rem;
  `;

  // Create button
  const button = document.createElement('button');
  button.id = 'ask-airo-fix-btn';
  button.style.cssText = `
    background-color: #6b46c1;
    color: #ffffff;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: none;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
  `;
  button.textContent = 'Ask Airo to Fix Code';
  button.addEventListener('click', () => {
    sendErrorToParent(errorMessage);
  });

  // Assemble the DOM structure
  buttonContainer.appendChild(button);
  innerWrapper.appendChild(heading);
  innerWrapper.appendChild(pre);
  innerWrapper.appendChild(buttonContainer);
  container.appendChild(innerWrapper);
  root.appendChild(container);
}

// Catch initial page load failures (import errors before HMR is connected)
if (import.meta.env.MODE === 'development') {
  window.addEventListener('vite:initial-error', ((event: CustomEvent) => {
    renderErrorOverlay(event.detail);
    sendErrorToParent(formatErrorMessage(event.detail));
  }) as EventListener);
}

// Hook into Vite HMR for errors during development
if (import.meta.env.MODE === 'development' && import.meta.hot) {
  let hasErrorOverlay = false;
  let reloadScheduled = false;

  const handleHmrError = (data: any) => {
    console.error('Vite compile error (standalone client):', data);
    hasErrorOverlay = true;
    renderErrorOverlay(data);
  };

  const handleAfterUpdate = () => {
    if (hasErrorOverlay && !reloadScheduled) {
      hasErrorOverlay = false;
      reloadScheduled = true;
      safePostMessage(window.parent, { type: 'error-fix-resolved' });
      // Defer reload to avoid interrupting the HMR event handler
      setTimeout(() => window.location.reload(), 0);
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
    reloadScheduled = false;
    import.meta.hot!.off('vite:error', handleHmrError);
    import.meta.hot!.off('compile-error', handleHmrError);
    import.meta.hot!.off('vite:afterUpdate', handleAfterUpdate);
  });
}
