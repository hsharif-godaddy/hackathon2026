import { generateUniqueId } from "./crypto-utils";

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
  // Each edit gets a unique id so replies from concurrent edits don't cross-talk
  // (e.g. drag-end immediately followed by a swatch click).
  const commitId = generateUniqueId();
  // Held so handleResult can cancel it — prevents a spurious timeout warning
  // after the reply has already arrived.
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const handleResult = (event: MessageEvent) => {
    const eventType = event.data?.type;
    const eventCommit = event.data?.commitId;

    // Only react to messages from the parent frame (the builder UI).
    // Ignores messages from other iframes, browser extensions, or the page itself.
    const isDifferentParentFrame = event.source !== window.parent;
    // Only react to the reply for this specific edit, not for concurrent ones.
    const isDifferentActionId = eventCommit !== commitId;

    if (isDifferentParentFrame || isDifferentActionId) return;
    // Wait for an explicit success or failure — ignore unrelated message types.
    if (eventType !== StyleMessageEventType.EDIT_FAILED && eventType !== StyleMessageEventType.EDIT_SUCCEEDED) return;
    // Reply arrived — cancel the auto-cleanup timeout so it doesn't fire spuriously.
    if (timeoutId !== null) clearTimeout(timeoutId);
    // Detach before calling handler so a re-entrant postMessage from the handler
    // doesn't trigger a second invocation.
    window.removeEventListener("message", handleResult);
    handler(event);
  };

  window.addEventListener("message", handleResult);
  // Auto-detach if the parent never replies (iframe navigation, channel break, etc.).
  timeoutId = setTimeout(() => {
    window.removeEventListener("message", handleResult);
    console.warn("[dev-tools] STYLE_UPDATED reply timed out; listener detached", { commitId });
  }, STYLE_REPLY_TIMEOUT_MS);

  return commitId;
}
