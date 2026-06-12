'use client';

import Pusher, { Channel } from 'pusher-js';
import { useCallback,useEffect, useRef, useState } from 'react';

import { useGasketData } from '@/hooks/useGasketData';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import {
  type AutoupdateVersionPayload,
  type UsePusherOptions,
  type UsePusherResult,
} from '@/types/pusher';
import { getRootDomain } from '@/utils/getRootDomain';

const isNotProd = process.env.NODE_ENV !== 'production';

export function usePusher(options: UsePusherOptions): UsePusherResult {
  const { accountId } = options;
  const { pusher } = useGasketData();

  // Destructure primitives to avoid object identity issues in effect deps
  const pusherApiKey = pusher?.apiKey;
  const pusherCluster = pusher?.cluster;

  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const pusherClientRef = useRef<Pusher | null>(null);
  const channelRef = useRef<Channel | null>(null);

  // Hold the latest onAutoupdate callback in a ref so handleAutoupdateVersion can
  // stay referentially stable. The subscribe effect depends on that handler;
  // depending on the caller's callback identity directly would tear down and
  // rebuild the entire Pusher connection on every parent re-render.
  const onAutoupdateRef = useRef<UsePusherOptions['onAutoupdate']>(options.onAutoupdate);
  // Sync every render so the ref always holds the freshest callback.
  useEffect(() => {
    onAutoupdateRef.current = options.onAutoupdate;
  });

  // Pusher auth goes through BFF proxy at /api/inbox
  const PUSHER_AUTH_URL = '/api/inbox';

  // Helper to build channel name
  const getChannelName = useCallback((accountId: string): string => {
    return `presence-admin-account-${accountId}`;
  }, []);

  // Event handler for autoupdate_version
  const handleAutoupdateVersion = useCallback(
    (data: AutoupdateVersionPayload) => {
      if (isNotProd) {
        logger.info('pusher.event.autoupdate_version', {
          accountId,
          version: data.autoupdate_version,
        });
      }
      // Guard the caller callback so a throw can't escape into pusher-js's
      // dispatch loop — matches the error boundary on every other handler here.
      try {
        onAutoupdateRef.current?.(data);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('pusher.autoupdate.callback_failed', { accountId, error: error.message });
      }
    },
    [accountId]
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unbind_all();
      channelRef.current = null;
    }

    if (pusherClientRef.current) {
      pusherClientRef.current.disconnect();
      pusherClientRef.current = null;
    }

    setIsConnected(false);
    setIsAuthenticating(false);
    // Note: error state is NOT cleared here — initializePusher clears it at the top
    // (line 99). Clearing here would wipe init failures and subscription errors.
  }, []);

  useEffect(() => {
    // No-op if accountId or pusher config not provided
    if (!accountId || !pusherApiKey || !pusherCluster) {
      return;
    }

    let isMounted = true;

    const initializePusher = async () => {
      try {
        if (isNotProd) {
          logger.info('pusher.connection.initializing', { accountId });
        }
        setIsAuthenticating(true);
        setError(null);

        const channelName = getChannelName(accountId);

        // Create Pusher client with custom authorizer that proxies through BFF
        const client = new Pusher(pusherApiKey, {
          cluster: pusherCluster,
          authorizer: (channel) => ({
            authorize: async (socketId: string, callback) => {
              try {
                if (isNotProd) {
                  logger.info('pusher.auth.authenticating', { accountId, channel: channel.name });
                }

                const response = await appFetch(PUSHER_AUTH_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    operation: 'pusher_auth',
                    brandId: accountId,
                    body: {
                      socket_id: socketId,
                      channel_name: channel.name,
                    },
                  }),
                });

                if (!response.ok) {
                  const errorData = await response.json().catch(() => ({ error: 'Auth failed' }));
                  throw new Error(errorData.error || `Auth failed with status ${response.status}`);
                }

                // BFF returns { status, data }; extract the auth data
                const result = await response.json() as { status: number; data: unknown };

                if (result.status >= 400) {
                  // Include error body snippet for debugging
                  const dataSnippet = result.data ? JSON.stringify(result.data).slice(0, 200) : 'null';
                  const error = new Error(`Pusher auth failed with status ${result.status}: ${dataSnippet}`);
                  logger.error('pusher.auth.upstream_error', {
                    accountId,
                    status: result.status,
                    errorData: result.data,
                  });
                  throw error;
                }

                // Validate auth payload before passing to Pusher
                if (!result.data || typeof result.data !== 'object') {
                  throw new Error(`Pusher auth response missing data object: ${JSON.stringify(result.data)}`);
                }

                const authData = result.data as Record<string, unknown>;
                if (typeof authData.auth !== 'string') {
                  throw new Error(`Pusher auth response missing auth token: ${JSON.stringify(result.data).slice(0, 200)}`);
                }

                callback(null, authData as { auth: string; channel_data?: string });
              } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.error('pusher.auth.failed', { accountId, error: error.message });
                callback(error, null);
                // Update state so auth failures surface via the hook's return value
                if (isMounted) {
                  setError(error);
                  setIsAuthenticating(false);
                }
              }
            },
          }),
        });

        pusherClientRef.current = client;

        // Subscribe to channel
        const channel = client.subscribe(channelName);
        channelRef.current = channel;

        // Bind event handlers
        channel.bind('autoupdate_version', handleAutoupdateVersion);

        // Listen for subscription success
        channel.bind('pusher:subscription_succeeded', () => {
          if (isMounted) {
            if (isNotProd) {
              logger.info('pusher.subscription.succeeded', { accountId, channel: channelName });
            }
            setIsConnected(true);
            setIsAuthenticating(false);
          }
        });

        // Listen for subscription error
        channel.bind('pusher:subscription_error', (err: unknown) => {
          if (isMounted) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.error('pusher.subscription.failed', { accountId, error: error.message });
            setError(error);
            setIsAuthenticating(false);
          }
        });

      } catch (err) {
        if (isMounted) {
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error('pusher.connection.failed', { accountId, error: error.message });
          setError(error);
          setIsAuthenticating(false);
          cleanup();
        }
      }
    };

    initializePusher();

    // Cleanup on unmount or accountId change
    return () => {
      isMounted = false;
      if (isNotProd) {
        logger.info('pusher.connection.disconnected', { accountId });
      }
      cleanup();
    };
  }, [accountId, pusherApiKey, pusherCluster, getChannelName, handleAutoupdateVersion, cleanup]);

  return { isConnected, isAuthenticating, error };
}
