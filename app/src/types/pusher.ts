/**
 * Pusher event payload types for reamaze real-time events
 */

export interface AutoupdateVersionPayload {
  autoupdate_version: number;
}

export type PusherEventPayload = AutoupdateVersionPayload;

export interface UsePusherOptions {
  accountId?: string;  // Reamaze account UUID (hook is no-op if missing)
}

export interface UsePusherResult {
  isConnected: boolean;
  isAuthenticating: boolean;
  error: Error | null;
}
