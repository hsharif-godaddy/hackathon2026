import type { Page } from 'playwright';

import { sleep } from '../../util/sleep.js';
import { isServerError, type PageDiagnosticsRecorder } from './diagnostics.js';

/** Per-attempt probe for the ready selector before deciding to reload. */
export const READINESS_PROBE_TIMEOUT_MS = 3_000;
/** Backoff between reloads while waiting out a transient 5xx. */
export const READINESS_RETRY_BACKOFF_MS = 2_000;
export const DEFAULT_READINESS_RETRY_WINDOW_MS = 30_000;

/**
 * Internal signal that the preview kept serving a 5xx for the entire
 * readiness-retry window (dev server failed to boot / never recovered).
 * Carries the last main-frame status so the caller can record it before
 * wrapping in a CaptureError. Never escapes the capture module.
 */
export class ReadinessNavigationError extends Error {
  constructor(readonly httpStatus: number | undefined) {
    super(
      `Preview kept serving a server error (httpStatus=${httpStatus ?? 'unknown'}) ` +
      `across the readiness-retry window`,
    );
    this.name = 'ReadinessNavigationError';
  }
}

export interface NavigateUntilReadyOptions {
  page: Page;
  previewUrl: string;
  recorder: PageDiagnosticsRecorder;
  readySelector: string;
  readyTimeoutMs: number;
  readinessRetryWindowMs: number;
}

/**
 * Navigate to the preview and wait for the app to render, tolerating a
 * transient server-error window while the dev server boots / optimizes deps.
 *
 * Per attempt: navigate, then briefly probe for the ready selector. If the
 * selector appears, we're done. If the preview is serving a 5xx (the
 * main-frame status or an entry sub-resource like /src/main.tsx — the exact
 * signature of a dev server still coming up), reload after a short backoff
 * until the readiness window elapses. A slow-but-healthy app (no 5xx, just
 * not painted yet) skips the reload loop and falls through to the original
 * single long ready-wait, preserving prior behavior for that case.
 *
 * Returns the last observed main-frame HTTP status. Throws
 * ReadinessNavigationError if the preview never stopped serving 5xx, or
 * propagates the underlying Playwright error from the final long wait.
 */
export async function navigateUntilReady(
  options: NavigateUntilReadyOptions,
): Promise<number | undefined> {
  const {
    page,
    previewUrl,
    recorder,
    readySelector,
    readyTimeoutMs,
    readinessRetryWindowMs,
  } = options;

  const deadline = Date.now() + readinessRetryWindowMs;
  let httpStatus: number | undefined;
  let attempt = 0;

  for (;;) {
    attempt++;
    // Snapshot the undeduped 5xx tally so we can tell whether *this* attempt
    // saw a server error, even if it's a repeat already in the failure log.
    const serverErrorsBefore = recorder.serverErrorCount;
    const resp = await page.goto(
      previewUrl,
      { waitUntil: 'domcontentloaded', timeout: readyTimeoutMs },
    );
    httpStatus = resp?.status();

    const finalUrl = page.url();
    if (new URL(finalUrl).href !== new URL(previewUrl).href) {
      console.warn(
        'SiteCapture: redirect detected',
        { expected: previewUrl, actual: finalUrl },
      );
    }

    // Short probe: is the app already painted?
    const ready = await page
      .waitForSelector(readySelector, {
        timeout: READINESS_PROBE_TIMEOUT_MS,
      })
      .then(() => true)
      .catch(() => false);
    if (ready) {
      return httpStatus;
    }

    // Not painted. Decide whether this looks like a transient dev-server
    // 5xx worth retrying, or a slow-but-healthy app to wait out.
    const sawServerError =
      isServerError(httpStatus)
      || recorder.serverErrorCount > serverErrorsBefore;

    if (sawServerError && Date.now() < deadline) {
      console.warn(
        `SiteCapture: preview not ready (httpStatus=${httpStatus ?? 'unknown'}), ` +
        `attempt ${attempt}; retrying after backoff`,
      );
      await sleep(READINESS_RETRY_BACKOFF_MS);
      continue;
    }

    if (sawServerError) {
      // Window exhausted and still erroring — genuine boot failure.
      throw new ReadinessNavigationError(httpStatus);
    }

    // No server error: a healthy-but-slow render. Fall through to the
    // original long wait (preserves pre-retry behavior for this case).
    await page.waitForSelector(readySelector, {
      timeout: readyTimeoutMs,
    });
    return httpStatus;
  }
}
