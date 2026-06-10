import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from 'playwright';
import type {
  BrowserContext,
  Page,
} from 'playwright';
import { Agent, fetch } from 'undici';

import type { SetupContext } from '../scenarios/types.js';
import { captureRoutes } from './site-capture/capture.js';
import { dismissCookieConsent } from './site-capture/cookie-dismiss.js';
import type { CapturedSite } from './site-capture/types.js';
import {
  CaptureError,
  PageDiagnosticsRecorder,
  formatCaptureError,
  type CaptureDiagnostics,
  type ConsoleLogEntry,
  type NetworkFailure,
} from './site-capture/diagnostics.js';
import {
  DEFAULT_READINESS_RETRY_WINDOW_MS,
  ReadinessNavigationError,
  navigateUntilReady,
} from './site-capture/readiness.js';

// Re-exported so existing importers (transcript.ts, simulation.ts, tests)
// keep their `../clients/dom-capture.js` import paths after the readiness and
// diagnostics logic moved into site-capture/.
export { CaptureError };
export type { CaptureDiagnostics, ConsoleLogEntry, NetworkFailure };

export interface DOMSnapshot {
  url: string;
  screenshotPath: string;
  htmlPath: string;
  timestamp: string;
  consoleLogs: ConsoleLogEntry[];
  /** Inline HTML content. When present, evaluators prefer this over reading htmlPath from disk. */
  html?: string;
  /** Main-frame HTTP status from the initial navigation, when observed. */
  httpStatus?: number;
  /** Uncaught in-page exceptions observed during capture (omitted when none). */
  pageErrors?: string[];
  /** Failed requests / non-2xx responses observed during capture (omitted when none). */
  networkFailures?: NetworkFailure[];
}

export interface CapturedTrial {
  snapshot: DOMSnapshot;
  capturedSite: CapturedSite;
}

export interface PreviewUrlResolver {
  resolve(ctx: SetupContext): Promise<string>;
}

export interface SiteCaptureConfig {
  resolver: PreviewUrlResolver;
  ignoreHttpsErrors: boolean;
  readySelector?: string;
  readyTimeoutMs?: number;
  /**
   * Upper bound on how long to keep reloading a preview that is serving a
   * transient 5xx (dev server still booting / mid dep-optimization). Once the
   * window elapses we stop reloading and fall through to the long ready-wait.
   */
  readinessRetryWindowMs?: number;
  /** Forwarded to captureRoutes(). */
  maxRoutes?: number;
}

export class SiteCapture {
  private readonly resolver: PreviewUrlResolver;
  private readonly ignoreHttpsErrors: boolean;
  private readonly readySelector: string;
  private readonly readyTimeoutMs: number;
  private readonly readinessRetryWindowMs: number;
  private readonly maxRoutes: number | undefined;

  constructor(config: SiteCaptureConfig) {
    this.resolver = config.resolver;
    this.ignoreHttpsErrors = config.ignoreHttpsErrors;
    this.readySelector = config.readySelector ?? '#app > *';
    this.readyTimeoutMs = config.readyTimeoutMs ?? 90_000;
    this.readinessRetryWindowMs =
      config.readinessRetryWindowMs ?? DEFAULT_READINESS_RETRY_WINDOW_MS;
    this.maxRoutes = config.maxRoutes;
  }

  async capture(
    ctx: SetupContext,
    trialDir: string,
  ): Promise<CapturedTrial> {
    const previewUrl = await this.resolver.resolve(ctx);
    const snapshotsDir = join(trialDir, 'snapshots');

    await mkdir(snapshotsDir, { recursive: true });

    const screenshotPath = join(snapshotsDir, '0.png');
    const htmlPath = join(snapshotsDir, '0.html');

    const browser = await chromium.launch();
    let context: BrowserContext | undefined;
    let homepagePage: Page | undefined;
    try {
      context = await browser.newContext({
        ignoreHTTPSErrors: this.ignoreHttpsErrors,
      });

      const page: Page = await context.newPage();
      const recorder = new PageDiagnosticsRecorder();
      recorder.attach(page);

      let httpStatus: number | undefined;
      try {
        httpStatus = await navigateUntilReady({
          page,
          previewUrl,
          recorder,
          readySelector: this.readySelector,
          readyTimeoutMs: this.readyTimeoutMs,
          readinessRetryWindowMs: this.readinessRetryWindowMs,
        });
        await dismissCookieConsent(page);
        const html = await page.content();
        await writeFile(screenshotPath, await page.screenshot());
        await writeFile(htmlPath, html);
        homepagePage = page;
      } catch (err) {
        if (err instanceof ReadinessNavigationError) {
          httpStatus = err.httpStatus;
        }
        const diagnostics = await recorder.gather(page, httpStatus);
        await this.writeFailureArtifacts(
          page,
          screenshotPath,
          htmlPath,
          snapshotsDir,
          diagnostics,
        );
        await page.close().catch((closeErr: unknown) => {
          console.warn('SiteCapture: page.close() failed during cleanup', closeErr);
        });
        throw new CaptureError(
          formatCaptureError(this.readySelector, this.readyTimeoutMs, diagnostics),
          diagnostics,
          err,
        );
      }

      const consoleLogs = recorder.getConsoleLogs();
      const pageErrors = recorder.getPageErrors();
      const networkFailures = recorder.getNetworkFailures();
      const snapshot: DOMSnapshot = {
        url: previewUrl,
        screenshotPath,
        htmlPath,
        timestamp: new Date().toISOString(),
        consoleLogs,
        ...(httpStatus !== undefined && { httpStatus }),
        ...(pageErrors.length > 0 && { pageErrors }),
        ...(networkFailures.length > 0 && { networkFailures }),
      };

      const capturedSite = await captureRoutes({
        previewUrl,
        context,
        homepagePage,
        outputDir: snapshotsDir,
        ignoreHttpsErrors: this.ignoreHttpsErrors,
        maxRoutes: this.maxRoutes,
      });

      return { snapshot, capturedSite };
    } finally {
      if (homepagePage) {
        await homepagePage.close().catch((err: unknown) => {
          console.warn('SiteCapture: page.close() failed', err);
        });
      }
      if (context) {
        await context.close().catch((err: unknown) => {
          console.warn('SiteCapture: context.close() failed', err);
        });
      }
      await browser.close().catch((err: unknown) => {
        console.warn('SiteCapture: browser.close() failed', err);
      });
    }
  }

  /**
   * Persists whatever we can of the failed page (screenshot, HTML, and the
   * structured diagnostics) so a run can be diagnosed after the fact. Every
   * write is best-effort; failures here must not mask the capture error.
   */
  private async writeFailureArtifacts(
    page: Page,
    screenshotPath: string,
    htmlPath: string,
    snapshotsDir: string,
    diagnostics: CaptureDiagnostics,
  ): Promise<void> {
    await page
      .screenshot()
      .then((bytes) => writeFile(screenshotPath, bytes))
      .catch(() => undefined);
    await page
      .content()
      .then((html) => writeFile(htmlPath, html))
      .catch(() => undefined);
    await writeFile(
      join(snapshotsDir, '0-diagnostics.json'),
      JSON.stringify(diagnostics, null, 2),
    ).catch(() => undefined);
  }
}

export class AABPreviewUrlResolver implements PreviewUrlResolver {
  constructor(
    private readonly config: {
      bffUrl: string;
      ignoreHttpsErrors: boolean;
    },
  ) {}

  async resolve(ctx: SetupContext): Promise<string> {
    const appId = ctx.appId as string | undefined;
    const url = `${this.config.bffUrl}/api/servers/${appId}`;
    // Scope TLS bypass to this request via a per-call undici Agent
    // rather than mutating NODE_TLS_REJECT_UNAUTHORIZED globally.
    // rejectUnauthorized: false is intentional — this tool connects to
    // local AAB instances on :8443 which use self-signed certs.
    // ignoreHttpsErrors must be explicitly set true in config to reach
    // this branch; it is never enabled in production environments.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      dispatcher: this.config.ignoreHttpsErrors
        ? new Agent({ connect: { rejectUnauthorized: false } }) // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
        : undefined,
    }).catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to resolve preview URL for app '${appId}': ${reason}`,
      );
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Failed to resolve preview URL for app '${appId}': ` +
        `HTTP ${res.status} ${body}`.trimEnd(),
      );
    }
    const data = await res.json() as { previewUrl: string };
    return data.previewUrl;
  }
}

export class SetupContextResolver implements PreviewUrlResolver {
  async resolve(ctx: SetupContext): Promise<string> {
    const url = ctx.previewUrl as string | undefined;
    if (!url) {
      throw new Error('SetupContext is missing previewUrl');
    }
    return url;
  }
}
