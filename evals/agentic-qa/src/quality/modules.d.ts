// Type declarations for dynamically imported modules
// These are loaded at runtime and may not be available at build time

declare module '@axe-core/playwright' {
  export class AxeBuilder {
    constructor(options: { page: unknown });
    withTags(tags: string[]): AxeBuilder;
    analyze(): Promise<{
      violations: Array<{
        id: string;
        impact?: 'critical' | 'serious' | 'moderate' | 'minor' | null;
        description: string;
        helpUrl: string;
        nodes: Array<unknown>;
      }>;
      passes: Array<unknown>;
    }>;
  }
}

declare module 'lighthouse' {
  interface LighthouseResult {
    lhr: {
      categories: {
        performance?: { score: number | null };
      };
      audits: Record<string, {
        numericValue?: number;
        score?: number | null;
      }>;
    };
  }

  function lighthouse(url: string, options?: unknown): Promise<LighthouseResult>;
  export default lighthouse;
}

declare module 'playwright' {
  interface Page {
    goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
    url(): string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluate<T>(fn: ((...args: any[]) => T) | string, ...args: any[]): Promise<T>;
    setViewportSize(size: { width: number; height: number }): Promise<void>;
    viewportSize(): { width: number; height: number } | null;
    waitForTimeout(ms: number): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, handler: (...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeListener(event: string, handler: (...args: any[]) => void): void;
    $$eval<T>(selector: string, fn: (elements: Element[]) => T): Promise<T>;
    request: {
      head(url: string, options?: { timeout?: number }): Promise<{ ok(): boolean; status(): number }>;
      get(url: string, options?: { headers?: Record<string, string> }): Promise<{ headers(): Record<string, string> }>;
    };
    content(): Promise<string>;
    waitForSelector?(selector: string, options?: { timeout?: number }): Promise<unknown>;
  }

  interface BrowserContext {
    newPage(): Promise<Page>;
  }

  interface Browser {
    newContext(options?: { viewport?: { width: number; height: number } }): Promise<BrowserContext>;
    close(): Promise<void>;
  }

  interface Chromium {
    launch(options?: { headless?: boolean }): Promise<Browser>;
  }

  export const chromium: Chromium;
}
