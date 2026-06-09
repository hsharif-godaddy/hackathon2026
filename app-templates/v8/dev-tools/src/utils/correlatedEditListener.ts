/* global MessageEvent, clearTimeout, setTimeout */
import { generateUniqueId } from "./crypto-utils";

interface CorrelatedEditListenerOptions {
  successType: string;
  failureType: string;
  timeoutWarning: string;
  timeoutMs: number;
  handler: (event: MessageEvent) => void;
  onTimeout?: (event: { commitId: string }) => void;
}

export function addCorrelatedEditListener({
  successType,
  failureType,
  timeoutWarning,
  timeoutMs,
  handler,
  onTimeout,
}: CorrelatedEditListenerOptions): string {
  const commitId = generateUniqueId();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const handleResult = (event: MessageEvent) => {
    const eventType = event.data?.type;
    const eventCommit = event.data?.commitId;

    if (event.source !== window.parent || eventCommit !== commitId) return;
    if (eventType !== successType && eventType !== failureType) return;

    if (timeoutId !== null) clearTimeout(timeoutId);
    window.removeEventListener("message", handleResult);
    handler(event);
  };

  window.addEventListener("message", handleResult);
  timeoutId = setTimeout(() => {
    window.removeEventListener("message", handleResult);
    console.warn(timeoutWarning, { commitId });
    onTimeout?.({ commitId });
  }, timeoutMs);

  return commitId;
}
