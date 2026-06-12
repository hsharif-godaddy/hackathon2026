/**
 * Pusher event payload types for reamaze real-time events
 */

export interface AutoupdateVersionPayload {
  autoupdate_version: number;
}

export type PusherEventPayload = AutoupdateVersionPayload;

export interface UsePusherOptions {
  accountId?: string;  // Reamaze account UUID (hook is no-op if missing)
  /**
   * Invoked when an `autoupdate_version` event arrives on the channel. Used by
   * callers (e.g. Inbox) to trigger data refetches. The hook routes this through
   * a ref so changing its identity never re-subscribes the Pusher connection.
   */
  onAutoupdate?: (data: AutoupdateVersionPayload) => void;
}

export interface UsePusherResult {
  isConnected: boolean;
  isAuthenticating: boolean;
  error: Error | null;
}
