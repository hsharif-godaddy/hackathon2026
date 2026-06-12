/**
 * Coarse classification of a capture-phase failure, for diagnostics.
 *
 * - `goto`: a `page.goto` navigation timeout (preview never reached
 *   domcontentloaded within the goto budget).
 * - `app-ready`: a `page.waitForSelector` timeout (page loaded but the
 *   app-ready selector never appeared).
 * - `timeout`: a Playwright timeout we couldn't attribute to a specific call.
 * - `other`: any non-timeout failure (route discovery error, crash, etc.).
 */
export type CaptureErrorClass = 'goto' | 'app-ready' | 'timeout' | 'other';

/**
 * Classifies a capture failure from its error message. Playwright timeout
 * errors are prefixed with the call that timed out (`page.goto:`,
 * `page.waitForSelector:`), which we key off; this is intentionally
 * string-based since the capture path surfaces raw Playwright errors rather
 * than typed exceptions.
 */
export function classifyCaptureError(err: unknown): CaptureErrorClass {
  if (!(err instanceof Error)) return 'other';
  const msg = err.message;

  const isTimeout = /Timeout\s+\d+ms exceeded/i.test(msg)
    || /\bTimeoutError\b/.test(err.name);
  if (!isTimeout) return 'other';

  if (/page\.goto|navigating to/i.test(msg)) return 'goto';
  if (/waitForSelector|waiting for (?:locator|selector)/i.test(msg)) {
    return 'app-ready';
  }
  return 'timeout';
}
