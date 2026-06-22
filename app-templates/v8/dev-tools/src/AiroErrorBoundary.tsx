import React, { Component, ReactNode } from 'react';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { isOriginAllowed } from './utils/postMessage';
import { send } from './utils/eventBus';
import type { RuntimeErrorData } from './types';
import MessageOverlay from './components/MessageOverlay';
import Button from './components/Button';
import { getCurrentCycleId } from './cycle-state';
import { claim, isClaimed, reset as resetClaims } from './error-claims';
import { setTranslations, t } from './utils/translations';

interface Props {
  children: ReactNode;
  /**
   * Whether this boundary installs the global `window.onerror` /
   * `unhandledrejection` handlers that surface async errors. Defaults to
   * `true`.
   *
   * The template mounts two boundaries: a ROOT boundary (above the
   * providers, in `main.tsx`) and an INNER one (inside the route element,
   * in `App.tsx`). Global error events fire once on `window` regardless of
   * subtree, so exactly one boundary must own them — otherwise an async
   * error is forwarded twice and two overlays stack. The root boundary
   * keeps the default (`true`) because it mounts reliably even when the
   * app's first render throws; the inner boundary passes `false` and is
   * left to catch only route render errors via `componentDidCatch`.
   */
  captureGlobalErrors?: boolean;
}

/**
 * Where the captured error came from.
 *  - `render`: thrown during render/lifecycle of user code, caught by
 *    `componentDidCatch`. The subtree is invalid so we must replace it
 *    with the overlay fallback.
 *  - `async`: thrown in an event handler, `setTimeout`, rejected promise,
 *    etc., and surfaced via `window.onerror` / `unhandledrejection`. The
 *    child tree is still valid and continues to render; the overlay
 *    floats on top.
 *  - `platform-suppressed`: a dev-tools render error was caught by
 *    componentDidCatch. The subtree is invalid and we must NOT return
 *    children from render (React would re-render the crashing child and
 *    loop). The overlay is also hidden because the agent can't edit
 *    platform files. Render returns null in this state.
 */
type ErrorSource = 'render' | 'async' | 'platform-suppressed';

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

// Hard caps for the nested fields inside the `errorData` payload forwarded
// to the parent. Framework stacks and deep-recursion errors can balloon
// into hundreds of kilobytes, bloating Loki entries and parent payloads.
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 20000;

// Grace window after the agent finishes a fix before we hard-reload the
// iframe to recover a render-error overlay. A top-of-tree render crash
// (e.g. a hook used outside its provider) replaces the whole tree with the
// overlay, and React Fast Refresh can't hot-recover it — the fixed module
// is swapped in but nothing re-renders the dead tree, so the overlay sticks.
// The delay lets a `vite:afterUpdate` recovery win for the cases HMR *can*
// handle (in-route edits), falling back to a reload only when it doesn't.
export const RENDER_RECOVERY_RELOAD_GRACE_MS = 500;

// Cap on consecutive automatic recovery reloads for the same error so an
// unfixable top-level crash can't reload-loop and hammer the agent. An
// explicit "Ask Airo to Fix" click resets the budget (the retry is
// intentional), and a clean HMR recovery clears it (the environment healed).
export const MAX_CONSECUTIVE_RECOVERY_RELOADS = 2;

// sessionStorage key holding `{ signature, count }` so the reload budget
// survives the reloads it triggers. sessionStorage (not localStorage) scopes
// it to this preview tab/session and clears when the preview closes.
const RECOVERY_RELOAD_STORAGE_KEY = 'airo-dev-recovery-reload';

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
   * Pending grace-window timer before an automatic recovery reload. Held so
   * it can be cancelled when an HMR `afterUpdate` recovers the overlay first
   * and on unmount.
   */
  private recoveryReloadTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Synchronous dedup flag. Set inside `componentDidCatch` and
   * `captureAsyncError` before `setState` queues its update, so React 18's
   * same-tick re-dispatch of boundary-caught errors to `window.onerror`
   * can't race ahead of the not-yet-committed state and clobber
   * `source: 'render'` with `'async'`.
   *
   * True only while an overlay-eligible error is claimed. Platform
   * suppression does NOT set this flag — those errors are tracked in
   * `platformErrors` by identity instead, so a later genuine user error
   * gets its own fresh overlay + forward.
   */
  private hasActiveError = false;
  /**
   * Errors that have already been forwarded to the parent as
   * `error-platform-report` (dev-tools internal). Tracked by Error
   * identity because React 18 re-dispatches a boundary-caught error to
   * `window.onerror` using the same Error reference. Re-dispatches would
   * otherwise reach `captureAsyncError`, fail `isDevToolsOriginError`
   * if the stack was mangled, and leak into the agent's runtime-error
   * buffer as `error-fix-request`. WeakSet so GC handles cleanup.
   */
  private platformErrors = new WeakSet<Error>();

  componentDidMount() {
    injectDevToolsStyles();
    if (import.meta.hot && typeof import.meta.hot.on === 'function') {
      this.hmrAfterUpdateHandler = () => this.handleHotUpdate();
      import.meta.hot.on('vite:afterUpdate', this.hmrAfterUpdateHandler);
    }

    // React error boundaries only catch render/lifecycle errors. Event
    // handler throws, setTimeout callbacks, fetch rejections, etc. skip
    // `componentDidCatch` entirely. Capture those here so the overlay
    // still shows — otherwise the user sees a silently-broken app.
    //
    // `window` error events are global, not subtree-scoped, so only the
    // boundary with `captureGlobalErrors !== false` (the root) installs
    // these. The inner route boundary opts out to avoid double-forwarding
    // and stacked overlays.
    if (this.props.captureGlobalErrors !== false) {
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
    }

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
      if (event.data?.type === 'DEVTOOLS_TRANSLATIONS') {
        if (event.data.translations && typeof event.data.translations === 'object') {
          setTranslations(event.data.translations);
          this.forceUpdate();
        }
        return;
      }
      if (event.data?.type === 'AGENT_PROCESSING_STATE') {
        const nowProcessing = Boolean(event.data.isProcessing);
        // Read the prior value before `setState` queues the update so we can
        // detect the processing → idle transition that marks the end of a
        // fix attempt.
        const finishedProcessing = this.state.isAgentProcessing && !nowProcessing;
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
        // A render-error overlay can't be hot-recovered when the crash is at
        // the top of the tree, so the fixed code never repaints. Once the
        // agent finishes, reload the iframe to pick up the fix — gated behind
        // a grace window (HMR may still recover) and a budget (no loops).
        if (finishedProcessing) {
          this.maybeScheduleRecoveryReload();
        }
      }
    };
    window.addEventListener('message', this.agentProcessingMessageHandler);

    try {
      send({ type: 'request-processing-state' });
    } catch (requestErr) {
      // Parent unreachable — the sync timeout below will unblock the overlay.
      // Log so cross-origin misconfigurations (wrong VITE_PARENT_ORIGIN →
      // SecurityError now that safePostMessage re-throws those) are
      // diagnosable rather than silent.
      console.warn('[dev-tools] request-processing-state postMessage failed:', requestErr);
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
    if (import.meta.hot && typeof import.meta.hot.off === 'function' && this.hmrAfterUpdateHandler) {
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
    if (this.recoveryReloadTimer) {
      clearTimeout(this.recoveryReloadTimer);
      this.recoveryReloadTimer = null;
    }
  }

  /**
   * True when the error was thrown from dev-tools' own code (internal
   * platform file, not user's app). We still forward to the parent for
   * platform-side Loki visibility, but we don't show the overlay — the
   * agent can't edit these files so "Ask Airo to Fix Code" would just
   * loop. Top-frame check avoids suppressing user errors that happen to
   * pass through dev-tools mid-stack; fail-open (empty stack returns
   * false) keeps unknown errors visible.
   *
   * Frame format matching covers both V8/Chrome (`    at func (file:line:col)`)
   * and Firefox/Safari (`func@file:line:col`). V8 prefixes the stack with
   * `Error: message` which neither pattern matches, so `.find` naturally
   * skips it; Firefox has no such prefix line.
   */
  private isDevToolsOriginError(error: Error): boolean {
    const stack = error.stack ?? '';
    const firstFrame = stack
      .split('\n')
      .map(line => line.trim())
      .find(line => /^at\s/.test(line) || /@.*:\d+(:\d+)?$/.test(line));
    return firstFrame ? /\/dev-tools\/(src|dist)\//.test(firstFrame) : false;
  }

  /**
   * Reset boundary state after a hot module update. Extracted so the
   * behavior can be covered by a unit test — the `vite:afterUpdate`
   * registration only fires when `import.meta.hot` is a live Vite dev
   * HMR API, which vitest does not provide.
   */
  private handleHotUpdate() {
    // Reset identity-tracked platform errors unconditionally. Platform
    // async errors add to `platformErrors` without calling setState, so
    // `state.error` stays null — gating on that would let WeakSet
    // entries survive HMR. A cached Error reference held in a
    // long-lived closure (event listener, retained rejection) would
    // then permanently short-circuit captureAsyncError with no overlay
    // and no forwarded report. WeakSet has no `.clear()` so we replace
    // the instance.
    this.hasActiveError = false;
    this.platformErrors = new WeakSet<Error>();
    // Drop cross-instance claims too: a claimed Error retained in a
    // long-lived closure must not permanently suppress a genuinely new
    // occurrence after a hot update. Mirrors the `platformErrors` reset.
    resetClaims();
    if (this.state.error) {
      // A live HMR recovery means the environment healed without a reload,
      // so any pending recovery reload is moot and the budget resets.
      if (this.recoveryReloadTimer !== null) {
        clearTimeout(this.recoveryReloadTimer);
        this.recoveryReloadTimer = null;
      }
      this.clearRecoveryReloadBudget();
      this.setState({ error: null, errorInfo: null, source: null, isFixing: false });
    }
  }

  /**
   * Stable identity for an error used to scope the recovery-reload budget.
   * Name + message is enough to recognize "the same crash recurred after a
   * reload" without depending on volatile stack frame offsets.
   */
  private static recoveryReloadSignature(error: Error): string {
    return `${error.name}:${error.message}`;
  }

  /**
   * Consecutive auto-reload count already spent on this error signature.
   * Fails closed (returns the cap) when sessionStorage is unreadable so a
   * storage failure disables auto-reload rather than risking a loop.
   */
  private recoveryReloadCount(signature: string): number {
    try {
      const raw = sessionStorage.getItem(RECOVERY_RELOAD_STORAGE_KEY);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { signature?: string; count?: number };
      return parsed.signature === signature && typeof parsed.count === 'number'
        ? parsed.count
        : 0;
    } catch {
      return MAX_CONSECUTIVE_RECOVERY_RELOADS;
    }
  }

  private recordRecoveryReload(signature: string, count: number): void {
    try {
      sessionStorage.setItem(RECOVERY_RELOAD_STORAGE_KEY, JSON.stringify({ signature, count }));
    } catch {
      // sessionStorage unavailable — auto-reload is best-effort.
    }
  }

  private clearRecoveryReloadBudget(): void {
    try {
      sessionStorage.removeItem(RECOVERY_RELOAD_STORAGE_KEY);
    } catch {
      // No-op when storage is unavailable.
    }
  }

  /**
   * Schedule an iframe reload to recover a stuck render-error overlay after
   * the agent finishes a fix. Only render errors qualify: async errors keep a
   * valid tree (a state reset suffices) and platform-suppressed errors can't
   * be fixed by the agent. The grace window prefers an HMR recovery when one
   * is in flight; the per-signature budget prevents reload loops on an
   * error the agent can't actually fix.
   */
  private maybeScheduleRecoveryReload(): void {
    const { error, source } = this.state;
    if (source !== 'render' || !error) return;
    if (this.recoveryReloadTimer !== null) return;

    const signature = AiroErrorBoundary.recoveryReloadSignature(error);
    const spent = this.recoveryReloadCount(signature);
    if (spent >= MAX_CONSECUTIVE_RECOVERY_RELOADS) return;

    this.recoveryReloadTimer = setTimeout(() => {
      this.recoveryReloadTimer = null;
      // HMR may have cleared the overlay during the grace window — if the
      // render error is gone, the fix landed without needing a reload.
      if (this.state.source !== 'render' || !this.state.error) return;
      this.recordRecoveryReload(signature, spent + 1);
      window.location.reload();
    }, RENDER_RECOVERY_RELOAD_GRACE_MS);
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Claim across instances first: React 18 re-dispatches this exact
    // Error to `window.onerror`, where the ROOT boundary's global handler
    // would otherwise re-forward and re-overlay an error this boundary
    // already owns. The shared registry suppresses that re-dispatch
    // regardless of which boundary caught the render error.
    claim(error);
    if (this.isDevToolsOriginError(error)) {
      console.error('[dev-tools internal render error, suppressed from overlay]', error, errorInfo);
      // Track by identity so React 18's same-frame re-dispatch to
      // window.onerror (which routes through captureAsyncError) sees
      // this as already-handled and short-circuits — even if the
      // re-dispatched copy carries a mangled stack that no longer
      // matches `isDevToolsOriginError`.
      this.platformErrors.add(error);
      this.notifyParentOfError(error, errorInfo, 'platform');
      // Must setState so React swaps the crashing subtree for our
      // fallback (render returns null for this source). Without it,
      // React re-renders children using current state, the broken
      // subtree mounts again, throws again, and componentDidCatch
      // fires in a loop until React's internal loop-breaker kicks in.
      this.setState({ error, errorInfo, source: 'platform-suppressed', isFixing: false });
      return;
    }
    console.error('Error caught by AiroErrorBoundary (render):', error, errorInfo);
    // Render errors always win over any outstanding async error — React
    // has invalidated the subtree so we must replace it with a fallback.
    this.hasActiveError = true;
    this.setState({ error, errorInfo, source: 'render', isFixing: false });
    this.notifyParentOfError(error, errorInfo);
  }

  private captureAsyncError(error: Error) {
    // Cross-instance short-circuit: a boundary's `componentDidCatch`
    // (this one or another instance — e.g. the inner route boundary
    // whose render error React 18 re-dispatches to this root boundary's
    // global handler in the same frame) already claimed this exact Error.
    // Skip entirely so we don't double-forward or stack a second overlay.
    if (isClaimed(error)) {
      return;
    }
    // React 18 re-dispatches a boundary-caught render error to
    // window.onerror in the same frame with the same Error reference.
    // If we already handled it as a platform error in componentDidCatch,
    // short-circuit here — don't re-forward, don't show an overlay.
    if (this.platformErrors.has(error)) {
      console.warn('[dev-tools] suppressed re-dispatch of platform render error', error);
      return;
    }
    if (this.isDevToolsOriginError(error)) {
      console.error('[dev-tools internal async error, suppressed from overlay]', error);
      this.platformErrors.add(error);
      this.notifyParentOfError(error, null, 'platform');
      return;
    }

    // Forward user-code async errors to the parent unconditionally so
    // every runtime error reaches the server-side buffer, including
    // ones that fire while a render error is already on screen. The
    // buffer's push-dedup collapses identical signatures, so the
    // duplicate POST is safe.
    this.notifyParentOfError(error, null, 'user');

    // State dedup: if `componentDidCatch` or an earlier user async error
    // already claimed the overlay, keep the richer info on screen
    // rather than overwriting with this view.
    if (this.hasActiveError) {
      console.warn('[AiroErrorBoundary] secondary async error while boundary is already claimed; overlay kept, payload forwarded as user', error);
      return;
    }
    console.error('Error caught by AiroErrorBoundary (async):', error);
    this.hasActiveError = true;
    this.setState({ error, errorInfo: null, source: 'async', isFixing: false });
  }

  /**
   * Build a size-capped `RuntimeErrorData` payload from an Error +
   * optional ErrorInfo. Deep recursion and chained framework stacks can
   * produce multi-hundred-kilobyte strings that waste bandwidth, bloat
   * Loki entries, and in extreme cases exceed postMessage size limits.
   * Caps (MAX_MESSAGE_LENGTH / MAX_STACK_LENGTH) are enforced here
   * because `safePostMessage` does not size-check nested payload
   * fields.
   */
  private buildErrorData(error: Error, errorInfo: React.ErrorInfo | null): RuntimeErrorData {
    const truncate = (value: string | undefined): string | undefined =>
      value && value.length > MAX_STACK_LENGTH ? `${value.slice(0, MAX_STACK_LENGTH)}\n…[truncated]` : value;
    return {
      message: (error.message || 'An unexpected error occurred').slice(0, MAX_MESSAGE_LENGTH),
      name: error.name || 'Error',
      stack: truncate(error.stack ?? undefined),
      componentStack: truncate(errorInfo?.componentStack ?? undefined),
      url: window.location.href,
      timestamp: Date.now(),
      cycleId: getCurrentCycleId(),
    };
  }

  /**
   * Forward the error payload to the parent.
   *
   * `errorOrigin` controls routing:
   *   - `'user'` (default): posts `error-fix-request`, which the parent
   *     forwards to the agents' runtime-error buffer
   *     (`POST /apps/:id/runtime-errors`). The post-stream validator
   *     picks it up on the next turn so the agent can attempt a fix.
   *   - `'platform'`: posts `error-platform-report`. Dev-tools-origin
   *     errors route here — the agent cannot edit platform files, so
   *     feeding them to the runtime-error buffer would just waste
   *     turns. The parent logs these for Loki visibility but does
   *     not forward them to the agent pipeline.
   */
  private notifyParentOfError(
    error: Error,
    errorInfo: React.ErrorInfo | null,
    errorOrigin: 'user' | 'platform' = 'user',
  ) {
    if (isStandalonePreview()) return;
    try {
      // Stamp with the cycleId that was active when this error was
      // caught. If a later HMR advances the cycle before the server
      // processes this POST, the buffer will treat this entry as stale
      // and drop it — which is exactly what we want: by then, whatever
      // the user was looking at is no longer what's rendering.
      const errorData = this.buildErrorData(error, errorInfo);
      send({
        type: errorOrigin === 'platform' ? 'error-platform-report' : 'error-fix-request',
        errorData,
      });
    } catch (notifyErr) {
      // Never let error-reporting bubble back into the boundary. Log so
      // failures (e.g. SecurityError from a cross-origin parent, or any
      // non-DataCloneError now that safePostMessage re-throws those) are
      // diagnosable instead of silently lost.
      console.warn('Failed to notify parent of error from AiroErrorBoundary:', notifyErr);
    }
  }

  /**
   * Secondary escape hatch on the error overlay. Matches the
   * PageNotFound "Go Back" pattern (secondary button alongside the
   * primary action). For async errors the child tree is still valid, so
   * clearing state lets the preview keep working. For render errors the
   * subtree is dead — `window.location.reload()` is the only real
   * recovery, so Dismiss triggers a reload and the user doesn't need to
   * know the internal difference.
   */
  private handleDismiss = () => {
    const { source } = this.state;
    if (source === 'platform-suppressed') {
      // Unreachable from UI today (render returns null in this state so
      // no Dismiss button renders), but defend the invariant: the
      // subtree is invalid, there is no in-iframe recovery path, and
      // falling through would reset state to children-rendering and
      // re-mount the broken tree.
      return;
    }
    if (source === 'render') {
      // Reload is asynchronous. If we reset `hasActiveError` first, any
      // async throw during teardown (pending timer, listener cleanup)
      // would slip into `captureAsyncError` with the boundary appearing
      // unclaimed and re-open the overlay. Leave the flag true — the
      // page is about to unload and nothing will read it afterward.
      window.location.reload();
      return;
    }
    this.hasActiveError = false;
    // Drop any platform-error identities carried from prior suppressions
    // so a later Error constructed with the same reference (dev-tools
    // module caching the instance) doesn't silently short-circuit
    // through captureAsyncError.
    this.platformErrors = new WeakSet<Error>();
    this.setState({
      error: null,
      errorInfo: null,
      source: null,
      isFixing: false,
    });
  };

  private handleAskAiroToFix = () => {
    const { error, errorInfo, isFixing } = this.state;
    if (isFixing || !error) return;

    // An explicit retry is intentional — reset the auto-reload budget so the
    // overlay reloads after this attempt finishes even if prior automatic
    // reloads already hit the cap.
    this.clearRecoveryReloadBudget();
    this.setState({ isFixing: true });

    // The user-requested fix path doesn't hit the runtime-error buffer
    // (the parent sends a chat message on the user's behalf), so
    // `cycleId` is informational here rather than load-bearing. Payload
    // is size-capped via the shared builder so a deep-recursion stack
    // can't balloon the chat send.
    const errorData = this.buildErrorData(error, errorInfo);

    try {
      send({
        type: 'error-fix-user-requested',
        errorData,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        // Cross-origin misconfiguration (wrong VITE_PARENT_ORIGIN).
        // Re-enabling the button would let the user click again and
        // hit the exact same failure — leave `isFixing` true so the
        // button stays disabled and log a diagnostic pointing at the
        // likely cause instead.
        console.error('Failed to send fix request to parent: SecurityError (check VITE_PARENT_ORIGIN):', err);
        return;
      }
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

  private formatOverlayMessage(error: Error, standalone: boolean): string {
    const intro = standalone
      ? t('devtools_error_overlay_standalone_intro', 'Copy this error and paste it into Airo to get help.')
      : t('devtools_error_overlay_intro', 'Airo caught an error and is ready to help sort it out.');
    const detail = error.message
      || t('devtools_error_overlay_fallback_message', 'An unexpected error occurred');
    return `${intro}\n\n${detail}`;
  }

  render() {
    const { error, source, isFixing, isAgentProcessing, hasProcessingStateSync, copiedToClipboard } = this.state;

    // Platform-suppressed render error: the crashing subtree is invalid
    // and we must NOT return children (React would retry the broken
    // render and loop). Overlay is hidden because the agent can't edit
    // platform files. Render nothing — iframe goes blank until HMR
    // reloads or the user refreshes.
    if (source === 'platform-suppressed') return null;

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
          title={t('devtools_error_overlay_title', 'Something hit a snag')}
          message={this.formatOverlayMessage(error, standalone)}
          button={
            standalone ? (
              <>
                <Button
                  text={t('devtools_error_overlay_dismiss', 'Dismiss')}
                  variant="secondary"
                  onClick={this.handleDismiss}
                />
                <Button
                  text={copiedToClipboard
                    ? t('devtools_error_overlay_copied', 'Copied — paste into Airo')
                    : t('devtools_error_overlay_copy', 'Copy Error for Airo')}
                  onClick={this.handleCopyErrorForAiro}
                />
              </>
            ) : (
              <>
                <Button
                  text={t('devtools_error_overlay_dismiss', 'Dismiss')}
                  variant="secondary"
                  onClick={this.handleDismiss}
                />
                <Button
                  text={isFixing
                    ? t('devtools_error_overlay_processing', 'Processing...')
                    : t('devtools_error_overlay_ask_airo_fix', 'Ask Airo to Fix It')}
                  onClick={this.handleAskAiroToFix}
                  loading={isFixing}
                />
              </>
            )
          }
        />
      </>
    );
  }
}
