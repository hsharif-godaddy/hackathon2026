import { chromium } from 'playwright';
import { Agent } from 'undici';
import type { SetupContext } from '../scenarios/types.js';

export interface ConsoleLogEntry {
  type: string;
  text: string;
}

export interface DOMSnapshot {
  url: string;
  html: string;
  screenshot: Buffer;
  timestamp: string;
  consoleLogs: ConsoleLogEntry[];
}

export interface PreviewUrlResolver {
  resolve(ctx: SetupContext): Promise<string>;
}

export interface DOMCaptureConfig {
  resolver: PreviewUrlResolver;
  ignoreHttpsErrors: boolean;
  readySelector?: string;
  readyTimeoutMs?: number;
  maxRetries?: number;
}

export class DOMCapture {
  private readonly resolver: PreviewUrlResolver;
  private readonly ignoreHttpsErrors: boolean;
  private readonly readySelector: string;
  private readonly readyTimeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: DOMCaptureConfig) {
    this.resolver = config.resolver;
    this.ignoreHttpsErrors = config.ignoreHttpsErrors;
    this.readySelector = config.readySelector ?? '#app > *';
    this.readyTimeoutMs = config.readyTimeoutMs ?? 90_000;
    this.maxRetries = config.maxRetries ?? 0;
  }

  async capture(ctx: SetupContext): Promise<DOMSnapshot> {
    const previewUrl = await this.resolver.resolve(ctx);
    const timeout = this.readyTimeoutMs;
    const maxAttempts = this.maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const browser = await chromium.launch();
      const context = await browser.newContext({
        ignoreHTTPSErrors: this.ignoreHttpsErrors,
      });
      const page = await context.newPage();
      const consoleLogs: ConsoleLogEntry[] = [];
      page.on('console', (msg) => {
        consoleLogs.push({ type: msg.type(), text: msg.text() });
      });
      try {
        await page.goto(
          previewUrl,
          { waitUntil: 'networkidle', timeout },
        );
        const finalUrl = page.url();
        if (new URL(finalUrl).href !== new URL(previewUrl).href) {
          console.warn(
            'DOMCapture: redirect detected',
            { expected: previewUrl, actual: finalUrl },
          );
        }
        await page.waitForSelector(
          this.readySelector,
          { timeout },
        );
        const html = await page.content();
        const screenshot = await page.screenshot();
        return {
          url: previewUrl,
          html,
          screenshot,
          timestamp: new Date().toISOString(),
          consoleLogs,
        };
      } catch (err) {
        lastError = err;
        const isFinalAttempt = attempt === maxAttempts - 1;
        if (!isFinalAttempt) {
          console.warn(
            'DOMCapture: attempt failed, retrying',
            { attempt: attempt + 1 },
            err,
          );
          await this.delay(2_000);
        }
      } finally {
        await browser.close();
      }
    }

    throw lastError;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const appId = ctx.appId;
    const url = `${this.config.bffUrl}/api/servers/${appId}`;
    // Scope TLS bypass to this request via a per-call undici Agent
    // rather than mutating NODE_TLS_REJECT_UNAUTHORIZED globally.
    // rejectUnauthorized: false is intentional — this tool connects to
    // local AAB instances on :8443 which use self-signed certs.
    // ignoreHttpsErrors must be explicitly set true in config to reach
    // this branch; it is never enabled in production environments.
    let res: Response;
    if (this.config.ignoreHttpsErrors) {
      res = await fetch(url, {
        dispatcher: new Agent({
          connect: { rejectUnauthorized: false }, // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
        }),
      } as RequestInit);
    } else {
      res = await fetch(url);
    }
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
    const url = ctx.previewUrl;
    if (!url) {
      throw new Error('SetupContext is missing previewUrl');
    }
    return url;
  }
}
