import { safePostMessage } from './utils/postMessage'

/**
 * Post an early `IFRAME_BOOTING` beacon to the parent builder as soon as the
 * preview app's client code begins executing — long before the dev-tools
 * React root mounts and posts `IFRAME_READY`.
 *
 * The builder's evidence-based recovery uses this to learn that the frame's
 * own JS is running (so it was NOT 307'd to a builder-redirect / CSP-blocked
 * blank page) and therefore must NOT force-remount the iframe while it is
 * merely slow to finish booting. `IFRAME_READY` remains the authoritative
 * handshake; this is purely an earlier "I'm alive" signal.
 *
 * No-op outside an iframe (top-level navigation) and in non-browser contexts.
 * Best-effort: any postMessage failure is swallowed.
 *
 * @param win - Window to read `parent` from. Defaults to the global `window`;
 *              injectable for testing.
 */
export function postIframeBootingBeacon(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined,
): void {
  if (!win) return
  if (win.parent === win) return
  try {
    safePostMessage(win.parent, { type: 'IFRAME_BOOTING' })
  } catch {
    // Best-effort beacon — IFRAME_READY is the authoritative handshake.
  }
}
