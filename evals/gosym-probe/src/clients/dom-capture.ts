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

export interface ConsoleLogEntry {
  type: string;
  text: string;
}

export interface DOMSnapshot {
  url: string;
  screenshotPath: string;
  htmlPath: string;
  timestamp: string;
  consoleLogs: ConsoleLogEntry[];
  /** Inline HTML content. When present, evaluators prefer this over reading htmlPath from disk. */
  html?: string;
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
  /** Forwarded to captureRoutes(). */
  maxRoutes?: number;
}

export class SiteCapture {
  private readonly resolver: PreviewUrlResolver;
  private readonly ignoreHttpsErrors: boolean;
  private readonly readySelector: string;
  private readonly readyTimeoutMs: number;
  private readonly maxRoutes: number | undefined;

  constructor(config: SiteCaptureConfig) {
    this.resolver = config.resolver;
    this.ignoreHttpsErrors = config.ignoreHttpsErrors;
    this.readySelector = config.readySelector ?? '#app > *';
    this.readyTimeoutMs = config.readyTimeoutMs ?? 90_000;
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
      const consoleLogs: ConsoleLogEntry[] = [];
      page.on('console', (msg) => {
        consoleLogs.push({ type: msg.type(), text: msg.text() });
      });

      try {
        await page.goto(
          previewUrl,
          { waitUntil: 'domcontentloaded', timeout: this.readyTimeoutMs },
        );
        const finalUrl = page.url();
        if (new URL(finalUrl).href !== new URL(previewUrl).href) {
          console.warn(
            'SiteCapture: redirect detected',
            { expected: previewUrl, actual: finalUrl },
          );
        }
        await page.waitForSelector(
          this.readySelector,
          { timeout: this.readyTimeoutMs },
        );
        await dismissCookieConsent(page);
        const html = await page.content();
        await writeFile(screenshotPath, await page.screenshot());
        await writeFile(htmlPath, html);
        homepagePage = page;
      } catch (err) {
        await page.close().catch((closeErr: unknown) => {
          console.warn('SiteCapture: page.close() failed during cleanup', closeErr);
        });
        throw err;
      }

      const snapshot: DOMSnapshot = {
        url: previewUrl,
        screenshotPath,
        htmlPath,
        timestamp: new Date().toISOString(),
        consoleLogs,
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
