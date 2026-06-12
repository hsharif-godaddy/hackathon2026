/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';

// --- Mocks ----------------------------------------------------------------

type AuthorizeCallback = (
  error: Error | null,
  authData: { auth: string; channel_data?: string } | null
) => void;

interface MockChannel {
  name: string;
  bind: ReturnType<typeof vi.fn>;
  unbind_all: ReturnType<typeof vi.fn>;
  /** Test helper: invoke every handler bound to an event. */
  trigger: (event: string, data?: unknown) => void;
}

interface MockPusherOptions {
  cluster: string;
  authorizer: (channel: { name: string }) => {
    authorize: (socketId: string, callback: AuthorizeCallback) => Promise<void>;
  };
}

const pusherMock = vi.hoisted(() => {
  interface MockClient {
    apiKey: string;
    options: MockPusherOptions;
    channels: Map<string, MockChannel>;
    disconnect: ReturnType<typeof vi.fn>;
    subscribe: (name: string) => MockChannel;
  }

  const instances: MockClient[] = [];

  class MockPusherClient implements MockClient {
    apiKey: string;
    options: MockPusherOptions;
    channels = new Map<string, MockChannel>();
    disconnect = vi.fn();

    constructor(apiKey: string, options: MockPusherOptions) {
      this.apiKey = apiKey;
      this.options = options;
      instances.push(this);
    }

    subscribe(name: string): MockChannel {
      const handlers = new Map<string, Array<(data?: unknown) => void>>();
      const channel: MockChannel = {
        name,
        bind: vi.fn((event: string, cb: (data?: unknown) => void) => {
          const list = handlers.get(event) ?? [];
          list.push(cb);
          handlers.set(event, list);
        }),
        unbind_all: vi.fn(() => handlers.clear()),
        trigger: (event: string, data?: unknown) => {
          (handlers.get(event) ?? []).forEach((cb) => cb(data));
        },
      };
      this.channels.set(name, channel);
      return channel;
    }
  }

  return { instances, MockPusherClient };
});

vi.mock('pusher-js', () => ({
  default: pusherMock.MockPusherClient,
}));

const gasketMock = vi.hoisted(() => ({
  data: {
    pusher: { apiKey: 'test-api-key', cluster: 'test-cluster' },
  } as { pusher?: { apiKey: string; cluster: string } },
}));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => gasketMock.data,
}));

const mockAppFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

import { usePusher } from './usePusher';

// --- Helpers --------------------------------------------------------------

function latestClient() {
  const { instances } = pusherMock;
  return instances[instances.length - 1];
}

const CHANNEL_NAME = (accountId: string) => `presence-admin-account-${accountId}`;

async function invokeAuthorize(
  channelName: string,
  socketId: string,
  callback: AuthorizeCallback
): Promise<void> {
  const { authorize } = latestClient().options.authorizer({ name: channelName });
  await authorize(socketId, callback);
}

// --- Tests ----------------------------------------------------------------

describe('usePusher', function usePusherTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    pusherMock.instances.length = 0;
    gasketMock.data = {
      pusher: { apiKey: 'test-api-key', cluster: 'test-cluster' },
    };
  });

  afterEach(function teardown() {
    vi.clearAllMocks();
  });

  describe('no-op conditions', function noOpTests() {
    it('does not create a Pusher client when accountId is missing', function noAccountId() {
      const { result } = renderHookWithProviders(() => usePusher({}));

      expect(pusherMock.instances).toHaveLength(0);
      expect(result.current).toEqual({
        isConnected: false,
        isAuthenticating: false,
        error: null,
      });
    });

    it('does not create a Pusher client when pusher config is missing', function noConfig() {
      gasketMock.data = {};

      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      expect(pusherMock.instances).toHaveLength(0);
    });

    it('does not create a Pusher client when only apiKey is present', function partialConfig() {
      gasketMock.data = { pusher: { apiKey: 'k', cluster: '' } };

      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      expect(pusherMock.instances).toHaveLength(0);
    });
  });

  describe('initialization', function initTests() {
    it('creates a Pusher client with the configured key and cluster', function createsClient() {
      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      expect(pusherMock.instances).toHaveLength(1);
      expect(latestClient().apiKey).toBe('test-api-key');
      expect(latestClient().options.cluster).toBe('test-cluster');
    });

    it('subscribes to the presence channel for the account', function subscribes() {
      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      expect(latestClient().channels.has(CHANNEL_NAME('acct-1'))).toBe(true);
    });

    it('sets isAuthenticating while waiting for subscription', function authenticating() {
      const { result } = renderHookWithProviders(() =>
        usePusher({ accountId: 'acct-1' })
      );

      expect(result.current.isAuthenticating).toBe(true);
      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('binds the autoupdate_version handler', function bindsHandlers() {
      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      expect(channel?.bind).toHaveBeenCalledWith(
        'autoupdate_version',
        expect.any(Function)
      );
    });
  });

  describe('subscription lifecycle', function subscriptionTests() {
    it('marks the hook connected on subscription_succeeded', function succeeded() {
      const { result } = renderHookWithProviders(() =>
        usePusher({ accountId: 'acct-1' })
      );

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      act(function trigger() {
        channel?.trigger('pusher:subscription_succeeded');
      });

      expect(result.current.isConnected).toBe(true);
      expect(result.current.isAuthenticating).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('surfaces the error on subscription_error', function subscriptionError() {
      const { result } = renderHookWithProviders(() =>
        usePusher({ accountId: 'acct-1' })
      );

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      act(function trigger() {
        channel?.trigger('pusher:subscription_error', new Error('subscribe boom'));
      });

      expect(result.current.error).toEqual(new Error('subscribe boom'));
      expect(result.current.isAuthenticating).toBe(false);
      expect(result.current.isConnected).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'pusher.subscription.failed',
        expect.objectContaining({ accountId: 'acct-1', error: 'subscribe boom' })
      );
    });

    it('logs the autoupdate_version event payload', function logsAutoupdate() {
      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      act(function trigger() {
        channel?.trigger('autoupdate_version', { autoupdate_version: 42 });
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'pusher.event.autoupdate_version',
        expect.objectContaining({ accountId: 'acct-1', version: 42 })
      );
    });

    it('invokes onAutoupdate with the payload when the event fires', function callsOnAutoupdate() {
      const onAutoupdate = vi.fn();
      renderHookWithProviders(() => usePusher({ accountId: 'acct-1', onAutoupdate }));

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      act(function trigger() {
        channel?.trigger('autoupdate_version', { autoupdate_version: 7 });
      });

      expect(onAutoupdate).toHaveBeenCalledTimes(1);
      expect(onAutoupdate).toHaveBeenCalledWith({ autoupdate_version: 7 });
    });

    it('does not re-subscribe when the onAutoupdate identity changes', function stableSubscription() {
      const { rerender } = renderHookWithProviders(
        ({ cb }: { cb: () => void }) => usePusher({ accountId: 'acct-1', onAutoupdate: cb }),
        { initialProps: { cb: () => {} } }
      );

      // A brand-new callback identity on re-render must not tear down the connection.
      rerender({ cb: () => {} });
      rerender({ cb: () => {} });

      expect(pusherMock.instances).toHaveLength(1);
    });

    it('invokes the latest onAutoupdate after a re-render', function latestCallback() {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderHookWithProviders(
        ({ cb }: { cb: () => void }) => usePusher({ accountId: 'acct-1', onAutoupdate: cb }),
        { initialProps: { cb: first } }
      );

      rerender({ cb: second });

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      act(function trigger() {
        channel?.trigger('autoupdate_version', { autoupdate_version: 9 });
      });

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith({ autoupdate_version: 9 });
    });
  });

  describe('authorizer (BFF proxy auth)', function authorizerTests() {
    it('posts the auth request to the inbox proxy and returns auth data', async function authSuccess() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 200, data: { auth: 'auth-token' } }),
      });

      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      const callback = vi.fn();
      await invokeAuthorize(CHANNEL_NAME('acct-1'), 'socket-123', callback);

      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/inbox',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'pusher_auth',
            brandId: 'acct-1',
            body: {
              socket_id: 'socket-123',
              channel_name: CHANNEL_NAME('acct-1'),
            },
          }),
        })
      );
      expect(callback).toHaveBeenCalledWith(null, { auth: 'auth-token' });
    });

    it('fails auth when the proxy response is not ok', async function authResponseNotOk() {
      mockAppFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: 'gateway down' }),
      });

      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      const callback = vi.fn();
      await invokeAuthorize(CHANNEL_NAME('acct-1'), 'socket-123', callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Error), null);
      expect(callback.mock.calls[0][0].message).toBe('gateway down');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'pusher.auth.failed',
        expect.objectContaining({ accountId: 'acct-1' })
      );
    });

    it('fails auth when the upstream status is >= 400', async function authUpstreamError() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 403, data: { error: 'forbidden' } }),
      });

      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      const callback = vi.fn();
      await invokeAuthorize(CHANNEL_NAME('acct-1'), 'socket-123', callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Error), null);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'pusher.auth.upstream_error',
        expect.objectContaining({ accountId: 'acct-1', status: 403 })
      );
    });

    it('fails auth when the auth token is missing from the payload', async function authMissingToken() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 200, data: { channel_data: 'no-auth-here' } }),
      });

      renderHookWithProviders(() => usePusher({ accountId: 'acct-1' }));

      const callback = vi.fn();
      await invokeAuthorize(CHANNEL_NAME('acct-1'), 'socket-123', callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Error), null);
      expect(callback.mock.calls[0][0].message).toContain('missing auth token');
    });

    it('surfaces auth failure through the hook error state', async function authUpdatesState() {
      mockAppFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'auth exploded' }),
      });

      const { result } = renderHookWithProviders(() =>
        usePusher({ accountId: 'acct-1' })
      );

      const callback = vi.fn();
      await act(async function runAuthorize() {
        await invokeAuthorize(CHANNEL_NAME('acct-1'), 'socket-123', callback);
      });

      await waitFor(function waitForError() {
        expect(result.current.error).toEqual(new Error('auth exploded'));
      });
      expect(result.current.isAuthenticating).toBe(false);
    });
  });

  describe('cleanup', function cleanupTests() {
    it('disconnects and unbinds on unmount', function unmountCleansUp() {
      const { unmount } = renderHookWithProviders(() =>
        usePusher({ accountId: 'acct-1' })
      );

      const client = latestClient();
      const channel = client.channels.get(CHANNEL_NAME('acct-1'));

      unmount();

      expect(channel?.unbind_all).toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('re-subscribes when accountId changes', function accountIdChange() {
      const { rerender } = renderHookWithProviders(
        ({ accountId }: { accountId: string }) => usePusher({ accountId }),
        { initialProps: { accountId: 'acct-1' } }
      );

      expect(pusherMock.instances).toHaveLength(1);
      const firstClient = pusherMock.instances[0];

      rerender({ accountId: 'acct-2' });

      expect(firstClient.disconnect).toHaveBeenCalled();
      expect(pusherMock.instances).toHaveLength(2);
      expect(latestClient().channels.has(CHANNEL_NAME('acct-2'))).toBe(true);
    });
  });
});
