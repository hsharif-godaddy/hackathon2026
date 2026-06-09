import { addCorrelatedEditListener } from "./correlatedEditListener";

export enum StyleMessageEventType {
  UPDATED = "STYLE_UPDATED",
  EDIT_SUCCEEDED = "STYLE_EDIT_SUCCEEDED",
  EDIT_FAILED = "STYLE_EDIT_FAILED",
}

/** Listener auto-cleanup window. If the parent never replies (timeout, iframe
 *  navigation, channel break), the listener detaches itself instead of
 *  leaking for the rest of the session. */
export const STYLE_REPLY_TIMEOUT_MS = 30_000;

/**
 * Registers a one-shot message listener for a style edit reply from the parent frame.
 * Handles all internal wiring — commit correlation, source validation, timeout cleanup.
 * Calls `handler` with the raw MessageEvent once a matching EDIT_SUCCEEDED or
 * EDIT_FAILED reply arrives.
 *
 * Returns the commitId — include it in the outgoing postMessage so the parent
 * can echo it back and the listener can match the reply to this specific edit.
 */
export function addStyleEditListener(handler: (event: MessageEvent) => void): string {
  return addCorrelatedEditListener({
    successType: StyleMessageEventType.EDIT_SUCCEEDED,
    failureType: StyleMessageEventType.EDIT_FAILED,
    timeoutWarning: "[dev-tools] STYLE_UPDATED reply timed out; listener detached",
    timeoutMs: STYLE_REPLY_TIMEOUT_MS,
    handler,
  });
}
