/**
 * Playwright Page type abstraction
 * This file provides a minimal Page interface that's compatible with Playwright
 * without requiring playwright types at build time.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PlaywrightPage {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<any>;
  url: () => string;
  evaluate: <T>(fn: ((...args: any[]) => T) | string, ...args: any[]) => Promise<T>;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  viewportSize: () => { width: number; height: number } | null;
  waitForTimeout: (ms: number) => Promise<void>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
  $$eval: <T>(selector: string, fn: (elements: Element[]) => T) => Promise<T>;
  request: {
    head: (url: string, options?: { timeout?: number }) => Promise<{ ok: () => boolean; status: () => number }>;
    get: (url: string, options?: { headers?: Record<string, string> }) => Promise<{ headers: () => Record<string, string> }>;
  };
  content: () => Promise<string>;
  waitForSelector?: (selector: string, options?: { timeout?: number }) => Promise<any>;
}

export interface PlaywrightBrowser {
  newContext: (options?: { viewport?: { width: number; height: number } }) => Promise<PlaywrightContext>;
  close: () => Promise<void>;
}

export interface PlaywrightContext {
  newPage: () => Promise<PlaywrightPage>;
}

// Type for Lighthouse result
export interface LighthouseResult {
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

// Type for axe-core results
export interface AxeResults {
  violations: Array<{
    id: string;
    impact?: 'critical' | 'serious' | 'moderate' | 'minor' | null;
    description: string;
    helpUrl: string;
    nodes: Array<unknown>;
  }>;
  passes: Array<unknown>;
}
