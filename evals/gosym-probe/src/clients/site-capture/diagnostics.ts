import type { Page } from 'playwright';

import {
  NetworkFailureLog,
  type NetworkFailure,
} from './network-failures.js';

export type { NetworkFailure };

export interface ConsoleLogEntry {
  type: string;
  text: string;
}

/**
 * Page-level diagnostics gathered during capture. Populated even on the
 * failure path so a bare Playwright timeout can be explained (e.g. the
 * preview served a 429/500 error page rather than the expected app).
 */
export interface CaptureDiagnostics {
  /** URL after any redirects (page.url() at the time of capture/failure). */
  finalUrl?: string;
  /** Main-frame HTTP status from the initial navigation. */
  httpStatus?: number;
  /** document.title at the time of capture/failure. */
  pageTitle?: string;
  /** First ~500 chars of document.body.innerText. */
  bodyTextSnippet?: string;
  /** Uncaught in-page exceptions and page crashes. */
  pageErrors: string[];
  /** Failed requests and non-2xx responses observed during navigation. */
  networkFailures: NetworkFailure[];
}

/**
 * Error thrown when capture fails. Carries structured diagnostics so the
 * caller can persist them without re-parsing the message.
 */
export class CaptureError extends Error {
  constructor(
    message: string,
    readonly diagnostics: CaptureDiagnostics,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * Wires Playwright page listeners and accumulates per-page diagnostics for a
 * single capture: console logs, uncaught errors/crashes, and network failures.
 *
 * Network failures are recorded through a bounded, de-duplicated log (see
 * {@link NetworkFailureLog}) so a page that re-fires the same failing
 * sub-resource across the readiness retry loop can't bloat the diagnostics
 * JSON. The retry decision, by contrast, needs to know whether a 5xx occurred
 * on *each individual* navigation attempt — even a repeat — so this recorder
 * also keeps an undeduped {@link serverErrorCount} that the readiness loop
 * snapshots before and after each `goto`.
 */
export class PageDiagnosticsRecorder {
  private readonly consoleLogs: ConsoleLogEntry[] = [];
  private readonly pageErrors: string[] = [];
  private readonly failureLog = new NetworkFailureLog();
  private serverErrors = 0;

  /** Register all listeners on the page. Call once per page. */
  attach(page: Page): void {
    page.on('console', (msg) => {
      this.consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      this.pageErrors.push(err instanceof Error ? err.message : String(err));
    });
    page.on('crash', () => {
      this.pageErrors.push('page crashed');
    });
    page.on('requestfailed', (req) => {
      this.failureLog.record({
        url: req.url(),
        detail: req.failure()?.errorText ?? 'request failed',
        isRateLimit: false,
      });
    });
    page.on('response', (res) => {
      if (res.ok()) return;
      const status = res.status();
      // Count every 5xx sighting (even a repeat) for the retry decision; the
      // failure log itself collapses duplicates for diagnostics.
      if (isServerError(status)) this.serverErrors++;
      this.failureLog.record({
        url: res.url(),
        detail: `HTTP ${status}`,
        isRateLimit: status === 429 || res.headers()['retry-after'] != null,
      });
    });
  }

  /** Console logs accumulated so far. */
  getConsoleLogs(): ConsoleLogEntry[] {
    return [...this.consoleLogs];
  }

  /** Uncaught page errors / crashes accumulated so far. */
  getPageErrors(): string[] {
    return [...this.pageErrors];
  }

  /** Distinct (deduped, capped) network failures accumulated so far. */
  getNetworkFailures(): NetworkFailure[] {
    return this.failureLog.toArray();
  }

  /**
   * Running count of 5xx responses observed, NOT deduped. The readiness loop
   * snapshots this before a `goto` and compares after to decide whether the
   * attempt saw a server error worth retrying.
   */
  get serverErrorCount(): number {
    return this.serverErrors;
  }

  /**
   * Best-effort page-state probe for the failure path. Each read is wrapped
   * so a dead/crashed page can't mask the original capture error.
   */
  async gather(
    page: Page,
    httpStatus: number | undefined,
  ): Promise<CaptureDiagnostics> {
    let finalUrl: string | undefined;
    try {
      finalUrl = page.url();
    } catch {
      finalUrl = undefined;
    }
    const pageTitle = await page.title().catch(() => undefined);
    const bodyText = await page
      .evaluate(() => document.body?.innerText ?? '')
      .catch(() => undefined);
    return {
      ...(finalUrl !== undefined && { finalUrl }),
      ...(httpStatus !== undefined && { httpStatus }),
      ...(pageTitle !== undefined && { pageTitle }),
      ...(bodyText !== undefined && { bodyTextSnippet: bodyText.slice(0, 500) }),
      pageErrors: this.getPageErrors(),
      networkFailures: this.getNetworkFailures(),
    };
  }
}

/** True for an HTTP status in the 5xx server-error range. */
export function isServerError(status: number | undefined): boolean {
  return status !== undefined && status >= 500 && status < 600;
}

/**
 * Builds a one-paragraph summary of why capture failed, surfacing the
 * diagnostics that a bare Playwright timeout omits.
 */
export function formatCaptureError(
  selector: string,
  timeoutMs: number,
  diag: CaptureDiagnostics,
): string {
  const parts: string[] = [
    `Capture failed waiting for "${selector}" after ${timeoutMs}ms.`,
  ];
  if (diag.finalUrl) parts.push(`finalUrl=${diag.finalUrl}`);
  if (diag.httpStatus !== undefined) parts.push(`httpStatus=${diag.httpStatus}`);
  if (diag.pageTitle) parts.push(`title=${JSON.stringify(diag.pageTitle)}`);
  if (diag.pageErrors.length > 0) {
    parts.push(`pageErrors=${JSON.stringify(diag.pageErrors)}`);
  }
  if (diag.networkFailures.length > 0) {
    const rendered = diag.networkFailures.map(
      (f) => `${f.detail} ${f.url}${f.isRateLimit ? ' (rate-limit)' : ''}`,
    );
    parts.push(`networkFailures=[${rendered.join(', ')}]`);
  }
  if (diag.bodyTextSnippet) {
    parts.push(`bodyText=${JSON.stringify(diag.bodyTextSnippet)}`);
  }
  return parts.join(' ');
}
