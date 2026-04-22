import React, { Component, ReactNode } from 'react';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { isOriginAllowed, safePostMessage } from './utils/postMessage';
import type { RuntimeErrorData } from './types';
import MessageOverlay from './components/MessageOverlay';
import Button from './components/Button';
import { getCurrentCycleId } from './cycle-state';

interface Props {
  children: ReactNode;
}

/**
 * Where the captured error came from.
 *  - `render`: thrown during React render/lifecycle and caught by
 *    `componentDidCatch`. React has invalidated the child subtree, so we
 *    must render a fallback in place of children.
 *  - `async`: thrown in an event handler, `setTimeout`, rejected promise,
 *    etc., and surfaced via `window.onerror` / `unhandledrejection`. The
 *    child tree is still valid and can continue to render; we overlay on
 *    top of it so the user still sees the working parts of the app.
 */
type ErrorSource = 'render' | 'async';

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  source: ErrorSource | null;
  isFixing: boolean;
  isAgentProcessing: boolean;
  /**
   * True once we've either received the first `AGENT_PROCESSING_STATE`
   * broadcast from the parent, the short initial-sync timeout elapsed,
   * or we're running standalone (no parent). Gates the overlay so that
   * on first mount we don't flash the manual popup before learning the
   * agent's actual state.
   */
  hasProcessingStateSync: boolean;
  /** Standalone-mode feedback after copying the error to the clipboard. */
  copiedToClipboard: boolean;
}

// Upper bound on how long we wait for the parent's first
// `AGENT_PROCESSING_STATE` broadcast before showing the overlay. Just big
// enough to cover the postMessage round-trip after `request-processing-state`.
const PROCESSING_STATE_SYNC_TIMEOUT_MS = 500;

// The preview is considered "standalone" when it isn't embedded in the
// builder iframe. In that case there's no parent to receive fix requests,
// so the overlay offers a clipboard-copy affordance instead.
const isStandalonePreview = () => typeof window !== 'undefined' && window.parent === window;

export default class AiroErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    errorInfo: null,
    source: null,
    isFixing: false,
    isAgentProcessing: false,
    hasProcessingStateSync: false,
    copiedToClipboard: false,
  };
  private hmrAfterUpdateHandler?: () => void;
  private agentProcessingMessageHandler?: (event: MessageEvent) => void;
  private windowErrorHandler?: (event: ErrorEvent) => void;
  private unhandledRejectionHandler?: (event: PromiseRejectionEvent) => void;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Synchronous dedup flag. Set inside `componentDidCatch` and
   * `captureAsyncError` before `setState` queues its update, so React 18's
   * same-tick re-dispatch of boundary-caught errors to `window.onerror`
   * can't race ahead of the not-yet-committed state and clobber
   * `source: 'render'` with `'async'`.
   */
  private hasActiveError = false;

  componentDidMount() {
    injectDevToolsStyles();
    if (import.meta.hot) {
      this.hmrAfterUpdateHandler = () => {
        if (this.state.error) {
          this.hasActiveError = false;
          this.setState({ error: null, errorInfo: null, source: null, isFixing: false });
        }
      };
      import.meta.hot.on('vite:afterUpdate', this.hmrAfterUpdateHandler);
    }

    // React error boundaries only catch render/lifecycle errors. Event
    // handler throws, setTimeout callbacks, fetch rejections, etc. skip
    // `componentDidCatch` entirely. Capture those here so the overlay
    // still shows — otherwise the user sees a silently-broken app.
    this.windowErrorHandler = (event: ErrorEvent) => {
      // Resource-load failures (img/script 404) fire 'error' with
      // `event.error === null` and `event.message === ''` — skip them.
      if (!event.error && (!event.message || event.message.length === 0)) return;
      const err = event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Uncaught runtime error');
      this.captureAsyncError(err);
    };
    this.unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const err = reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
      this.captureAsyncError(err);
    };
    window.addEventListener('error', this.windowErrorHandler);
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);

    if (isStandalonePreview()) {
      // No parent → no agent, no broadcast to wait for. Show the overlay
      // immediately when errors occur.
      this.setState({ hasProcessingStateSync: true });
      return;
    }

    // Track the parent builder's agent-processing state so we can suppress
    // the "Something went wrong" popup while the agent is actively fixing
    // errors. When processing ends and the error still persists, the popup
    // shows as a manual escape hatch.
    this.agentProcessingMessageHandler = (event: MessageEvent) => {
      if (!event.origin || !isOriginAllowed(event)) return;
      if (event.data?.type === 'AGENT_PROCESSING_STATE') {
        const nowProcessing = Boolean(event.data.isProcessing);
        // If processing ended while we had an outstanding "Ask Airo to Fix"
        // request, the agent either applied a fix (HMR or iframe reload
        // will clear us) or gave up. In the latter case the overlay
        // re-appears — `isFixing` must be cleared so the button shows
        // "Ask Airo to Fix Code" again and the user can retry.
        this.setState(prev => ({
          isAgentProcessing: nowProcessing,
          isFixing: nowProcessing ? prev.isFixing : false,
          hasProcessingStateSync: true,
        }));
      }
    };
    window.addEventListener('message', this.agentProcessingMessageHandler);

    try {
      safePostMessage(window.parent, { type: 'request-processing-state' });
    } catch {
      // Parent unreachable — the sync timeout below will unblock the overlay.
    }

    // Failsafe: if no broadcast arrives (parent not listening, stale
    // handler, etc.), unblock the overlay after a short delay so the user
    // isn't staring at a blank iframe.
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (!this.state.hasProcessingStateSync) {
        this.setState({ hasProcessingStateSync: true });
      }
    }, PROCESSING_STATE_SYNC_TIMEOUT_MS);
  }

  componentWillUnmount() {
    if (import.meta.hot && this.hmrAfterUpdateHandler) {
      import.meta.hot.off('vite:afterUpdate', this.hmrAfterUpdateHandler);
    }
    if (this.agentProcessingMessageHandler) {
      window.removeEventListener('message', this.agentProcessingMessageHandler);
    }
    if (this.windowErrorHandler) {
      window.removeEventListener('error', this.windowErrorHandler);
    }
    if (this.unhandledRejectionHandler) {
      window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by AiroErrorBoundary (render):', error, errorInfo);
    // Render errors always win over any outstanding async error — React
    // has invalidated the subtree so we must replace it with a fallback.
    this.hasActiveError = true;
    this.setState({ error, errorInfo, source: 'render', isFixing: false });
    this.notifyParentOfError(error, errorInfo);
  }

  private captureAsyncError(error: Error) {
    // Forward to the parent unconditionally so every async runtime error
    // reaches the server-side buffer, including ones that fire while a
    // render error (or earlier async error) is already on screen. React
    // 18's same-frame re-dispatch of a boundary-caught error lands here
    // too; the buffer's push-dedup collapses it (identical
    // `name::message::firstFrame` signature), so the duplicate POST is
    // safe.
    this.notifyParentOfError(error, null);

    // State dedup: if `componentDidCatch` or an earlier async error
    // already claimed the boundary, keep the richer info on screen
    // rather than overwriting with the async view. `hasActiveError` is
    // flipped synchronously inside `componentDidCatch` before React 18
    // re-dispatches, so the flag is visible by the time we get here.
    if (this.hasActiveError) return;
    console.error('Error caught by AiroErrorBoundary (async):', error);
    this.hasActiveError = true;
    this.setState({ error, errorInfo: null, source: 'async', isFixing: false });
  }

  private notifyParentOfError(error: Error, errorInfo: React.ErrorInfo | null) {
    // Notify the parent so it can forward the payload to the agents'
    // authenticated runtime-error buffer (`POST /apps/:id/runtime-errors`).
    // The server-side post-hook then picks it up on the next turn. Purely
    // informational — the overlay itself is driven by this boundary.
    if (isStandalonePreview()) return;
    try {
      // Stamp with the cycleId that was active when this error was
      // caught. If a later HMR advances the cycle before the server
      // processes this POST, the buffer will treat this entry as stale
      // and drop it — which is exactly what we want: by then, whatever
      // the user was looking at is no longer what's rendering.
      const errorData: RuntimeErrorData = {
        message: error.message || 'An unexpected error occurred',
        name: error.name || 'Error',
        stack: error.stack ?? undefined,
        componentStack: errorInfo?.componentStack ?? undefined,
        url: window.location.href,
        timestamp: Date.now(),
        cycleId: getCurrentCycleId(),
      };
      safePostMessage(window.parent, {
        type: 'error-fix-request',
        errorData,
      });
    } catch {
      // Never let error-reporting bubble back into the boundary.
    }
  }

  private handleAskAiroToFix = () => {
    const { error, errorInfo, isFixing } = this.state;
    if (isFixing || !error) return;

    this.setState({ isFixing: true });

    // The user-requested fix path doesn't hit the runtime-error buffer
    // (the parent sends a chat message on the user's behalf), so
    // `cycleId` is informational here rather than load-bearing.
    const errorData: RuntimeErrorData = {
      message: error.message || 'An unexpected error occurred',
      name: error.name || 'Error',
      stack: error.stack ?? undefined,
      componentStack: errorInfo?.componentStack ?? undefined,
      url: window.location.href,
      timestamp: Date.now(),
      cycleId: getCurrentCycleId(),
    };

    try {
      safePostMessage(window.parent, {
        type: 'error-fix-user-requested',
        errorData,
      });
    } catch (err) {
      console.error('Failed to send message to parent from AiroErrorBoundary:', err);
      this.setState({ isFixing: false });
    }
  };

  private handleCopyErrorForAiro = async () => {
    const { error, errorInfo } = this.state;
    if (!error) return;

    const parts = [
      `${error.name || 'Error'}: ${error.message || 'An unexpected error occurred'}`,
      error.stack && `\nStack:\n${error.stack}`,
      errorInfo?.componentStack && `\nComponent stack:${errorInfo.componentStack}`,
      `\nURL: ${window.location.href}`,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(parts.join('\n'));
      this.setState({ copiedToClipboard: true });
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => {
        this.copiedTimer = null;
        this.setState({ copiedToClipboard: false });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy error to clipboard:', err);
    }
  };

  render() {
    const { error, source, isFixing, isAgentProcessing, hasProcessingStateSync, copiedToClipboard } = this.state;

    // For async errors the child tree is still valid (React didn't catch
    // anything). Keep it rendering underneath so the app remains partially
    // usable — the overlay floats on top via fixed positioning.
    const childrenIfAny = source === 'async' ? this.props.children : null;

    if (!error) return this.props.children as React.ReactElement;

    // Suppress while the agent is actively fixing (embedded) or before the
    // first processing-state broadcast lands (brief mount race, capped by
    // `PROCESSING_STATE_SYNC_TIMEOUT_MS`). Render errors force-suppress
    // children too (React already invalidated them).
    if (isAgentProcessing || !hasProcessingStateSync) {
      return <>{childrenIfAny}</>;
    }

    const standalone = isStandalonePreview();
    return (
      <>
        {childrenIfAny}
        <MessageOverlay
          title="Something went wrong"
          message={error.message}
          button={
            standalone ? (
              <Button
                text={copiedToClipboard ? 'Copied — paste into Airo' : 'Give this error to Airo to fix'}
                onClick={this.handleCopyErrorForAiro}
              />
            ) : (
              <Button
                text={isFixing ? 'Processing...' : 'Ask Airo to Fix Code'}
                onClick={this.handleAskAiroToFix}
                loading={isFixing}
              />
            )
          }
        />
      </>
    );
  }
}
