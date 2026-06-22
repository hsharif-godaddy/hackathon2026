/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import AiroErrorBoundary, {
  MAX_CONSECUTIVE_RECOVERY_RELOADS,
  RENDER_RECOVERY_RELOAD_GRACE_MS,
} from '../AiroErrorBoundary';
import { reset as resetClaims } from '../error-claims';

type Boundary = InstanceType<typeof AiroErrorBoundary>;

function makeError(stack: string, message = 'boom'): Error {
  const err = new Error(message);
  err.stack = stack;
  return err;
}

describe('AiroErrorBoundary.isDevToolsOriginError', () => {
  // `isDevToolsOriginError` is a private instance method; access via type cast.
  const boundary = new AiroErrorBoundary({ children: null }) as unknown as {
    isDevToolsOriginError: (err: Error) => boolean;
  };
  const isDevToolsOriginError = boundary.isDevToolsOriginError.bind(boundary);

  it('returns true for a V8 stack whose top frame is inside /dev-tools/src/', () => {
    const stack = [
      'Error: boom',
      '    at useHoverHint (http://localhost:3000/dev-tools/src/hooks/useHoverHint.ts:129:21)',
      '    at App (http://localhost:3000/src/App.tsx:10:5)',
    ].join('\n');
    expect(isDevToolsOriginError(makeError(stack))).toBe(true);
  });

  it('returns true for a top frame inside /dev-tools/dist/ (production bundle path)', () => {
    const stack = [
      'Error: boom',
      '    at e (http://localhost:3000/dev-tools/dist/index.js:1:4221)',
      '    at App (http://localhost:3000/src/App.tsx:10:5)',
    ].join('\n');
    expect(isDevToolsOriginError(makeError(stack))).toBe(true);
  });

  it('returns true for a Firefox-style stack whose first frame is inside /dev-tools/src/', () => {
    const stack = [
      'useHoverHint@http://localhost:3000/dev-tools/src/hooks/useHoverHint.ts:129:21',
      'App@http://localhost:3000/src/App.tsx:10:5',
    ].join('\n');
    expect(isDevToolsOriginError(makeError(stack))).toBe(true);
  });

  it('returns false when dev-tools appears only in mid-stack below a user-code top frame', () => {
    const stack = [
      'Error: boom',
      '    at MyComponent (http://localhost:3000/src/components/Thing.tsx:42:9)',
      '    at useHoverHint (http://localhost:3000/dev-tools/src/hooks/useHoverHint.ts:129:21)',
    ].join('\n');
    expect(isDevToolsOriginError(makeError(stack))).toBe(false);
  });

  it('returns false when the stack is empty (fail-open)', () => {
    const err = new Error('boom');
    err.stack = '';
    expect(isDevToolsOriginError(err)).toBe(false);
  });

  it('returns false when the stack has no recognizable frames', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\nsomething else entirely';
    expect(isDevToolsOriginError(err)).toBe(false);
  });

  it('returns false when error.stack is undefined (fail-open, no TypeError)', () => {
    const err = new Error('boom');
    (err as { stack?: string }).stack = undefined;
    // Guard against a future `??` → `||` regression: with `||` an
    // undefined stack would coalesce to '' via the falsy fallback and
    // still work, but downstream `.split` would crash if we later
    // removed the fallback. Assert no throw + fail-open.
    expect(() => isDevToolsOriginError(err)).not.toThrow();
    expect(isDevToolsOriginError(err)).toBe(false);
  });
});

// Spy on `request-processing-state` so the boundary's sync-timer path exits
// deterministically in tests.
function mockParentAvailable() {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: vi.fn() } as unknown as Window,
  });
}

describe('AiroErrorBoundary handleDismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockParentAvailable();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clears state for async errors so the preview keeps rendering', () => {
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    // Fast-forward past the 500ms processing-state sync gate.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // Dispatch an async error that originates in user code.
    const err = makeError(
      'Error: user-async\n    at handler (http://localhost:3000/src/MyComp.tsx:5:3)',
      'user-async',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'user-async' }));
    });
    expect(screen.getByText('Something hit a snag')).not.toBeNull();
    expect(screen.getByText('child')).not.toBeNull();
    act(() => {
      fireEvent.click(screen.getByText('Dismiss'));
    });
    expect(screen.queryByText('Something hit a snag')).toBeNull();
    expect(screen.getByText('child')).not.toBeNull();
  });

  it('reloads the page for render errors since React has invalidated the subtree', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    function Boom(): JSX.Element {
      throw makeError(
        'Error: render-boom\n    at Boom (http://localhost:3000/src/Boom.tsx:2:3)',
        'render-boom',
      );
    }

    // Silence the expected React error logs.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AiroErrorBoundary>
        <Boom />
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('Something hit a snag')).not.toBeNull();
    act(() => {
      fireEvent.click(screen.getByText('Dismiss'));
    });
    expect(reload).toHaveBeenCalledTimes(1);

    // Simulate a late throw between Dismiss and the actual page unload
    // (pending timer, listener cleanup). If `handleDismiss` had reset
    // `hasActiveError = false` before calling reload, `captureAsyncError`
    // would see the boundary as unclaimed, set `source: 'async'`, and
    // overwrite the render-error overlay with the late async error's
    // message. The boundary must stay claimed on the render path so the
    // original message stays on screen until the actual unload.
    const lateErr = makeError(
      'Error: late-teardown-error\n    at teardown (http://localhost:3000/src/x.tsx:1:1)',
      'late-teardown-error',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: lateErr, message: 'late-teardown-error' }));
    });
    // `reload` is mocked so the component stays mounted. The render-error
    // message must still be on screen; the late async error must NOT
    // have replaced it.
    expect(screen.queryByText('render-boom')).not.toBeNull();
    expect(screen.queryByText('late-teardown-error')).toBeNull();

    errorSpy.mockRestore();
  });
});

describe('AiroErrorBoundary dev-tools suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockParentAvailable();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not render the overlay for an async error whose top frame is in /dev-tools/src/', () => {
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const err = makeError(
      'Error: dev-tools-async\n    at useHoverHint (http://localhost:3000/dev-tools/src/hooks/useHoverHint.ts:129:21)',
      'dev-tools-async',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'dev-tools-async' }));
    });
    expect(screen.queryByText('Something hit a snag')).toBeNull();
    expect(screen.queryByText('Ask Airo to Fix It')).toBeNull();
    expect(screen.queryByText('dev-tools-async')).toBeNull();
    expect(screen.getByText('child')).not.toBeNull();
  });

  it('forwards dev-tools-origin errors to the parent as error-platform-report (not error-fix-request)', () => {
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const err = makeError(
      'Error: dev-tools-async\n    at useHoverHint (http://localhost:3000/dev-tools/src/hooks/useHoverHint.ts:129:21)',
      'dev-tools-async',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'dev-tools-async' }));
    });
    const reportCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-platform-report');
    const fixCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    expect(reportCall).not.toBeUndefined();
    expect(fixCall).toBeUndefined();
  });

  it('does not render the overlay for a render error thrown from /dev-tools/src/ and forwards as error-platform-report', () => {
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });

    function DevToolsBoom(): JSX.Element {
      throw makeError(
        'Error: dev-tools-render\n    at DevToolsBoom (http://localhost:3000/dev-tools/src/components/ElementHoverBar.tsx:42:9)',
        'dev-tools-render',
      );
    }
    // Silence React's expected error logs for the boundary-caught throw.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AiroErrorBoundary>
        <DevToolsBoom />
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByText('Something hit a snag')).toBeNull();
    expect(screen.queryByText('Ask Airo to Fix It')).toBeNull();
    const reportCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-platform-report');
    const fixCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    expect(reportCall).not.toBeUndefined();
    expect(fixCall).toBeUndefined();
    errorSpy.mockRestore();
  });

  it('suppresses the overlay for an unhandledrejection whose top frame is in /dev-tools/src/ and forwards as error-platform-report', () => {
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const err = makeError(
      'Error: dev-tools-rejection\n    at useHoverHint (http://localhost:3000/dev-tools/src/hooks/useHoverHint.ts:129:21)',
      'dev-tools-rejection',
    );
    const rejectedPromise = Promise.reject(err);
    // Swallow the actual rejection so Node/jsdom doesn't flag it.
    rejectedPromise.catch(() => {});
    // jsdom does not implement the PromiseRejectionEvent constructor.
    // Use a plain Event and attach the same properties the handler reads.
    const rejectionEvent = new Event('unhandledrejection') as Event & {
      reason?: unknown;
      promise?: Promise<unknown>;
    };
    rejectionEvent.reason = err;
    rejectionEvent.promise = rejectedPromise;
    act(() => {
      window.dispatchEvent(rejectionEvent);
    });
    expect(screen.queryByText('Something hit a snag')).toBeNull();
    expect(screen.queryByText('dev-tools-rejection')).toBeNull();
    expect(screen.getByText('child')).not.toBeNull();
    const reportCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-platform-report');
    const fixCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    expect(reportCall).not.toBeUndefined();
    expect(fixCall).toBeUndefined();
  });

  it('routes the React 18 same-frame re-dispatch of a dev-tools render error as error-platform-report even with a mangled stack', () => {
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });

    // Pre-build the Error so we can re-dispatch the same reference after
    // the render catch.
    const devToolsErr = makeError(
      'Error: dev-tools-render\n    at DevToolsBoom (http://localhost:3000/dev-tools/src/components/ElementHoverBar.tsx:42:9)',
      'dev-tools-render',
    );
    function DevToolsBoom(): JSX.Element {
      throw devToolsErr;
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <AiroErrorBoundary>
        <DevToolsBoom />
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Simulate React 18's re-dispatch to window.onerror with the SAME
    // Error reference but a stack that no longer points at dev-tools
    // (the "mangled stack" scenario). If the suppression relied on
    // re-running `isDevToolsOriginError` it would fail here and leak
    // into `error-fix-request`. Identity-based WeakSet must catch it.
    devToolsErr.stack = 'Error: dev-tools-render\n    at react-internals (http://localhost:3000/node_modules/react/cjs/react.development.js:9999:9)';
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: devToolsErr, message: 'dev-tools-render' }));
    });

    const reportCalls = postSpy.mock.calls.filter(call => (call[0] as { type?: string })?.type === 'error-platform-report');
    const fixCalls = postSpy.mock.calls.filter(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    expect(reportCalls.length).toBe(1); // only componentDidCatch forwarded; re-dispatch short-circuited
    expect(fixCalls.length).toBe(0);
    expect(screen.queryByText('Something hit a snag')).toBeNull();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('handleHotUpdate clears active error state, flag, and platformErrors WeakSet', () => {
    // Capture the boundary instance so we can invoke handleHotUpdate
    // directly. vitest does not expose a live `import.meta.hot` API,
    // so we can't exercise the vite:afterUpdate registration end-to-end
    // — but the reset logic itself is all that matters.
    let instance: InstanceType<typeof AiroErrorBoundary> | null = null;
    render(
      <AiroErrorBoundary ref={(i) => { instance = i; }}>
        <div>child</div>
      </AiroErrorBoundary> as unknown as React.ReactElement,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    if (!instance) throw new Error('boundary ref was not populated');
    const boundary = instance as unknown as {
      handleHotUpdate: () => void;
      hasActiveError: boolean;
      platformErrors: WeakSet<Error>;
    };

    // Put an overlay on screen by dispatching a user async error.
    const err = makeError(
      'Error: user-async-for-hmr\n    at handler (http://localhost:3000/src/MyComp.tsx:5:3)',
      'user-async-for-hmr',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'user-async-for-hmr' }));
    });
    expect(screen.queryByText('user-async-for-hmr')).not.toBeNull();
    expect(boundary.hasActiveError).toBe(true);

    // Seed the WeakSet with a prior platform-error identity to verify
    // it's cleared.
    const priorPlatformErr = new Error('prior');
    boundary.platformErrors.add(priorPlatformErr);
    expect(boundary.platformErrors.has(priorPlatformErr)).toBe(true);

    act(() => {
      boundary.handleHotUpdate();
    });

    expect(screen.queryByText('Something hit a snag')).toBeNull();
    expect(screen.queryByText('user-async-for-hmr')).toBeNull();
    expect(screen.getByText('child')).not.toBeNull();
    expect(boundary.hasActiveError).toBe(false);
    expect(boundary.platformErrors.has(priorPlatformErr)).toBe(false);
  });

  it('buildErrorData caps `message` at MAX_MESSAGE_LENGTH (2000) and `stack` at MAX_STACK_LENGTH (20000) with a truncation suffix', () => {
    // Covers the load-bearing caps that keep Loki entries bounded.
    // A future swap of `slice` for `substring` with wrong args, or
    // accidental removal of the truncate helper, would silently ship
    // unbounded payloads. Assert both caps by constructing strings
    // larger than each limit.
    let instance: InstanceType<typeof AiroErrorBoundary> | null = null;
    render(
      <AiroErrorBoundary ref={(i) => { instance = i; }}>
        <div>child</div>
      </AiroErrorBoundary> as unknown as React.ReactElement,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    if (!instance) throw new Error('boundary ref was not populated');
    const boundary = instance as unknown as {
      buildErrorData: (err: Error, info: null) => { message: string; stack?: string; componentStack?: string; name: string };
    };

    const longMessage = 'm'.repeat(2500);
    const longStack = 's'.repeat(25000);
    const err = new Error(longMessage);
    err.stack = longStack;

    const data = boundary.buildErrorData(err, null);
    // message capped at 2000 exactly (no suffix — we use .slice, not truncate).
    expect(data.message.length).toBe(2000);
    expect(data.message).toBe('m'.repeat(2000));
    // stack capped at 20000 + the suffix.
    expect(data.stack?.startsWith('s'.repeat(20000))).toBe(true);
    expect(data.stack?.endsWith('[truncated]')).toBe(true);
    // Short inputs untouched.
    const shortErr = new Error('short');
    shortErr.stack = 'short-stack';
    const shortData = boundary.buildErrorData(shortErr, null);
    expect(shortData.message).toBe('short');
    expect(shortData.stack).toBe('short-stack');
  });

  it('handleAskAiroToFix keeps isFixing=true and logs a SecurityError diagnostic when the parent rejects the forward', () => {
    // Pins the deliberate asymmetry: on SecurityError the button
    // stays disabled so the user cannot retry into the same failure.
    // A "cleanup" regression adding setState({ isFixing: false }) to
    // this branch would silently reintroduce the retry loop.
    const securityErr = new DOMException('blocked a frame with origin ...', 'SecurityError');
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: {
        postMessage: vi.fn().mockImplementation(() => { throw securityErr; }),
      } as unknown as Window,
    });
    let instance: InstanceType<typeof AiroErrorBoundary> | null = null;
    render(
      <AiroErrorBoundary ref={(i) => { instance = i; }}>
        <div>child</div>
      </AiroErrorBoundary> as unknown as React.ReactElement,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    if (!instance) throw new Error('boundary ref was not populated');

    const err = makeError(
      'Error: user-async\n    at handler (http://localhost:3000/src/MyComp.tsx:5:3)',
      'user-async',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'user-async' }));
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      fireEvent.click(screen.getByText('Ask Airo to Fix It'));
    });

    // Button stays disabled (shows 'Processing...' label because isFixing remains true).
    expect(screen.queryByText('Processing...')).not.toBeNull();
    expect(screen.queryByText('Ask Airo to Fix It')).toBeNull();
    const diagnosticLogged = errorSpy.mock.calls.some(args => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('SecurityError') && msg.includes('VITE_PARENT_ORIGIN');
    });
    expect(diagnosticLogged).toBe(true);

    errorSpy.mockRestore();
  });

  it('handleDismiss is a no-op when source === platform-suppressed (defensive guard)', () => {
    // Today this path is unreachable from UI — render returns null in
    // this state so no Dismiss button exists. Pin the guard so a
    // future UI change adding a dismiss path for the null-render state
    // cannot accidentally reset flags and remount the broken subtree.
    let instance: InstanceType<typeof AiroErrorBoundary> | null = null;
    render(
      <AiroErrorBoundary ref={(i) => { instance = i; }}>
        <div>child</div>
      </AiroErrorBoundary> as unknown as React.ReactElement,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    if (!instance) throw new Error('boundary ref was not populated');
    const boundary = instance as unknown as {
      handleDismiss: () => void;
      hasActiveError: boolean;
      platformErrors: WeakSet<Error>;
      state: { error: Error | null; source: string | null };
    };

    // Put the boundary into platform-suppressed state directly.
    const err = new Error('platform-render');
    act(() => {
      (instance as unknown as { setState: (s: object) => void }).setState({
        error: err,
        errorInfo: null,
        source: 'platform-suppressed',
        isFixing: false,
      });
    });
    boundary.hasActiveError = true;
    const seeded = new Error('seed');
    boundary.platformErrors.add(seeded);

    act(() => {
      boundary.handleDismiss();
    });

    expect(boundary.state.source).toBe('platform-suppressed');
    expect(boundary.state.error).toBe(err);
    expect(boundary.hasActiveError).toBe(true);
    expect(boundary.platformErrors.has(seeded)).toBe(true);
  });

  it('handleHotUpdate with no active overlay still clears platformErrors WeakSet', () => {
    // Covers the platform-async scenario: a dev-tools async error
    // adds to platformErrors without calling setState, so state.error
    // stays null. A regression that gates the WeakSet reset on
    // state.error would leave stale identities in place after HMR.
    let instance: InstanceType<typeof AiroErrorBoundary> | null = null;
    render(
      <AiroErrorBoundary ref={(i) => { instance = i; }}>
        <div>child</div>
      </AiroErrorBoundary> as unknown as React.ReactElement,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    if (!instance) throw new Error('boundary ref was not populated');
    const boundary = instance as unknown as {
      handleHotUpdate: () => void;
      hasActiveError: boolean;
      platformErrors: WeakSet<Error>;
    };
    expect(boundary.hasActiveError).toBe(false);
    const priorPlatformErr = new Error('prior-platform');
    boundary.platformErrors.add(priorPlatformErr);
    expect(boundary.platformErrors.has(priorPlatformErr)).toBe(true);

    act(() => {
      boundary.handleHotUpdate();
    });

    expect(boundary.platformErrors.has(priorPlatformErr)).toBe(false);
    expect(boundary.hasActiveError).toBe(false);
    // Child still renders — handleHotUpdate did not disturb a clean boundary.
    expect(screen.getByText('child')).not.toBeNull();
  });

  it('does not pin subsequent user async errors to the platform route when a prior platform async error left no overlay', () => {
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Step 1: dev-tools async error. Platform-suppressed, no overlay.
    const platformErr = makeError(
      'Error: dev-tools-first\n    at useHoverHint (http://localhost:3000/dev-tools/src/hooks/useHoverHint.ts:129:21)',
      'dev-tools-first',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: platformErr, message: 'dev-tools-first' }));
    });
    expect(screen.queryByText('Something hit a snag')).toBeNull();

    // Step 2: genuine user async error afterwards.
    const userErr = makeError(
      'Error: user-second\n    at handler (http://localhost:3000/src/MyComp.tsx:5:3)',
      'user-second',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: userErr, message: 'user-second' }));
    });

    // The user error MUST show the overlay and MUST route as
    // error-fix-request, not silently vanish as error-platform-report.
    expect(screen.queryByText('user-second')).not.toBeNull();
    const fixCalls = postSpy.mock.calls.filter(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    const reportCalls = postSpy.mock.calls.filter(call => (call[0] as { type?: string })?.type === 'error-platform-report');
    expect(fixCalls.length).toBe(1);
    expect(reportCalls.length).toBe(1); // only the first (platform) error
  });

  it('suppresses the overlay when the top frame is inside /dev-tools/dist/ (production bundle)', () => {
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const err = makeError(
      'Error: dev-tools-dist\n    at e (http://localhost:3000/dev-tools/dist/index.js:1:4221)',
      'dev-tools-dist',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'dev-tools-dist' }));
    });
    expect(screen.queryByText('Something hit a snag')).toBeNull();
    const reportCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-platform-report');
    const fixCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    expect(reportCall).not.toBeUndefined();
    expect(fixCall).toBeUndefined();
  });
});

describe('AiroErrorBoundary captureGlobalErrors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockParentAvailable();
    resetClaims();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does NOT register global error/unhandledrejection listeners when captureGlobalErrors is false', () => {
    // Asserting registration (rather than dispatching an ErrorEvent) keeps
    // the test side-effect-free: with no handler installed, a dispatched
    // ErrorEvent would surface as an unhandled error and pollute the run.
    const addSpy = vi.spyOn(window, 'addEventListener');
    render(
      <AiroErrorBoundary captureGlobalErrors={false}>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });

    const registeredEvents = addSpy.mock.calls.map(call => call[0]);
    expect(registeredEvents).not.toContain('error');
    expect(registeredEvents).not.toContain('unhandledrejection');
    expect(screen.getByText('child')).not.toBeNull();
  });

  it('DOES register global error/unhandledrejection listeners by default (captureGlobalErrors omitted)', () => {
    // Guards the default: a regression flipping the default to false would
    // silently disable global async capture for the root boundary.
    const addSpy = vi.spyOn(window, 'addEventListener');
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });

    const registeredEvents = addSpy.mock.calls.map(call => call[0]);
    expect(registeredEvents).toContain('error');
    expect(registeredEvents).toContain('unhandledrejection');
  });

  it('still catches route render errors via componentDidCatch when captureGlobalErrors is false', () => {
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });
    function Boom(): JSX.Element {
      throw makeError(
        'Error: route-render\n    at Page (http://localhost:3000/src/pages/Home.tsx:9:1)',
        'route-render',
      );
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AiroErrorBoundary captureGlobalErrors={false}>
        <Boom />
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // componentDidCatch is independent of window handlers, so the route
    // render error still surfaces and forwards.
    expect(screen.getByText('Something hit a snag')).not.toBeNull();
    const fixCall = postSpy.mock.calls.find(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    expect(fixCall).not.toBeUndefined();
    errorSpy.mockRestore();
  });

  it('does not double-forward or double-overlay when the inner boundary claim is re-dispatched to a root boundary window handler', () => {
    // Models the two-boundary topology: a ROOT boundary (default props,
    // owns the window handler) and an INNER boundary (captureGlobalErrors
    // false) whose route render error React 18 re-dispatches to window in
    // the same frame. The shared error-claims registry must suppress the
    // root's window-handler re-handling of that exact error.
    const postSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: postSpy } as unknown as Window,
    });

    const innerErr = makeError(
      'Error: inner-route-render\n    at Page (http://localhost:3000/src/pages/Home.tsx:9:1)',
      'inner-route-render',
    );
    function Boom(): JSX.Element {
      throw innerErr;
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <>
        <AiroErrorBoundary>
          <div>root-child</div>
        </AiroErrorBoundary>
        <AiroErrorBoundary captureGlobalErrors={false}>
          <Boom />
        </AiroErrorBoundary>
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Inner boundary caught the render error: one overlay, one forward.
    expect(screen.getAllByText('Something hit a snag')).toHaveLength(1);
    expect(screen.getByText('root-child')).not.toBeNull();

    // React 18 re-dispatches the same Error to window.onerror; the root
    // boundary's global handler receives it.
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: innerErr, message: 'inner-route-render' }));
    });

    // Still exactly one overlay and one error-fix-request — the root's
    // window handler short-circuited on the shared claim.
    expect(screen.getAllByText('Something hit a snag')).toHaveLength(1);
    const fixCalls = postSpy.mock.calls.filter(call => (call[0] as { type?: string })?.type === 'error-fix-request');
    expect(fixCalls.length).toBe(1);

    errorSpy.mockRestore();
  });
});

describe('AiroErrorBoundary render-error recovery reload', () => {
  let reload: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockParentAvailable();
    resetClaims();
    sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    // Render errors log to console.error via React; silence them.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  // Dispatch the parent's processing → idle transition that marks the end of
  // an agent fix attempt. Two `act` blocks so the `isProcessing: true`
  // setState flushes before the `false` message reads the prior value.
  function finishAgentFix() {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'AGENT_PROCESSING_STATE', isProcessing: true },
          origin: 'http://localhost:3000',
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'AGENT_PROCESSING_STATE', isProcessing: false },
          origin: 'http://localhost:3000',
        }),
      );
    });
  }

  function renderRenderError(message: string) {
    function Boom(): JSX.Element {
      throw makeError(
        `Error: ${message}\n    at Boom (http://localhost:3000/src/Boom.tsx:2:3)`,
        message,
      );
    }
    render(
      <AiroErrorBoundary>
        <Boom />
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
  }

  it('reloads the iframe after the agent finishes when a render-error overlay is stuck', () => {
    renderRenderError('stuck-render');
    finishAgentFix();
    expect(reload).not.toHaveBeenCalled();
    // Reload only fires after the grace window elapses.
    act(() => {
      vi.advanceTimersByTime(RENDER_RECOVERY_RELOAD_GRACE_MS);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload if an HMR recovery clears the error during the grace window', () => {
    function Boom(): JSX.Element {
      throw makeError(
        'Error: hmr-recovers\n    at Boom (http://localhost:3000/src/Boom.tsx:2:3)',
        'hmr-recovers',
      );
    }
    let instance: Boundary | null = null;
    render(
      <AiroErrorBoundary ref={(node) => { instance = node; }}>
        <Boom />
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    finishAgentFix();
    // HMR recovers before the grace window elapses.
    act(() => {
      (instance as unknown as { handleHotUpdate: () => void }).handleHotUpdate();
    });
    act(() => {
      vi.advanceTimersByTime(RENDER_RECOVERY_RELOAD_GRACE_MS);
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('does NOT reload for async errors — the tree is still valid', () => {
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const err = makeError(
      'Error: user-async\n    at handler (http://localhost:3000/src/MyComp.tsx:5:3)',
      'user-async',
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'user-async' }));
    });
    finishAgentFix();
    act(() => {
      vi.advanceTimersByTime(RENDER_RECOVERY_RELOAD_GRACE_MS);
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('caps consecutive automatic reloads for the same error so an unfixable crash cannot loop', () => {
    renderRenderError('unfixable');
    // The mocked reload leaves the component mounted in its error state, so
    // each finished fix attempt re-evaluates the budget.
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_RECOVERY_RELOADS + 2; attempt++) {
      finishAgentFix();
      act(() => {
        vi.advanceTimersByTime(RENDER_RECOVERY_RELOAD_GRACE_MS);
      });
    }
    expect(reload).toHaveBeenCalledTimes(MAX_CONSECUTIVE_RECOVERY_RELOADS);
  });

  it('resets the reload budget when the user explicitly clicks Ask Airo to Fix', () => {
    renderRenderError('retry-me');
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_RECOVERY_RELOADS; attempt++) {
      finishAgentFix();
      act(() => {
        vi.advanceTimersByTime(RENDER_RECOVERY_RELOAD_GRACE_MS);
      });
    }
    expect(reload).toHaveBeenCalledTimes(MAX_CONSECUTIVE_RECOVERY_RELOADS);

    // An explicit user retry clears the budget so the overlay reloads again.
    act(() => {
      fireEvent.click(screen.getByText('Ask Airo to Fix It'));
    });
    finishAgentFix();
    act(() => {
      vi.advanceTimersByTime(RENDER_RECOVERY_RELOAD_GRACE_MS);
    });
    expect(reload).toHaveBeenCalledTimes(MAX_CONSECUTIVE_RECOVERY_RELOADS + 1);
  });

  it('does not reload when the agent was never processing (no transition)', () => {
    renderRenderError('no-transition');
    // Only an idle broadcast, no preceding processing=true — not a fix
    // completion, so no reload.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'AGENT_PROCESSING_STATE', isProcessing: false },
          origin: 'http://localhost:3000',
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(RENDER_RECOVERY_RELOAD_GRACE_MS);
    });
    expect(reload).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('AiroErrorBoundary overlay copy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockParentAvailable();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function showEmbeddedAsyncError(message: string) {
    render(
      <AiroErrorBoundary>
        <div>child</div>
      </AiroErrorBoundary>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const err = makeError(
      `Error: ${message}\n    at handler (http://localhost:3000/src/MyComp.tsx:5:3)`,
      message,
    );
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: err, message }));
    });
  }

  it('prefixes embedded errors with the intro before the error message', () => {
    showEmbeddedAsyncError('user-runtime-error');
    const message = screen.getByText((_, element) => element?.tagName === 'PRE')?.textContent;
    expect(message).toBe(
      'Airo caught an error and is ready to help sort it out.\n\nuser-runtime-error',
    );
    expect(screen.getByText('Ask Airo to Fix It')).not.toBeNull();
    expect(screen.queryByText('Copy Error for Airo')).toBeNull();
  });

  it('shows standalone copy affordance and intro when there is no parent frame', () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window });
    showEmbeddedAsyncError('standalone-runtime-error');
    const message = screen.getByText((_, element) => element?.tagName === 'PRE')?.textContent;
    expect(message).toBe(
      'Copy this error and paste it into Airo to get help.\n\nstandalone-runtime-error',
    );
    expect(screen.getByText('Copy Error for Airo')).not.toBeNull();
    expect(screen.queryByText('Ask Airo to Fix It')).toBeNull();
  });

  it('applies DEVTOOLS_TRANSLATIONS to overlay strings', () => {
    showEmbeddedAsyncError('translated-runtime-error');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'DEVTOOLS_TRANSLATIONS',
            translations: {
              devtools_error_overlay_title: 'Title from parent',
              devtools_error_overlay_intro: 'Intro from parent.',
              devtools_error_overlay_ask_airo_fix: 'Ask Airo to Fix It',
            },
          },
          origin: 'http://localhost:3000',
        }),
      );
    });
    expect(screen.getByText('Title from parent')).not.toBeNull();
    expect(screen.getByText('Intro from parent.\n\ntranslated-runtime-error')).not.toBeNull();
    expect(screen.getByText('Ask Airo to Fix It')).not.toBeNull();
  });
});

// Silence unused-variable lint for `Boundary` alias — kept for documentation.
void ({} as Boundary);
