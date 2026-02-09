/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PlaywrightPage } from '../../playwright-types.js';

/**
 * Mock PlaywrightPage for unit testing evaluators.
 * Provides configurable evaluate() returns and event emission.
 */
export class MockPage {
  private evaluateReturns: unknown[];
  private evaluateIndex = 0;
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};
  private _url: string;
  private _viewportSize: { width: number; height: number } | null;
  private _requestHead: (url: string) => Promise<{ ok: () => boolean; status: () => number }>;
  private _requestGet: (url: string) => Promise<{ headers: () => Record<string, string> }>;

  /**
   * Hook called during waitForTimeout - use to emit events while handlers are registered
   */
  onWait?: () => void;

  constructor(options: {
    url?: string;
    evaluateReturns?: unknown[];
    viewportSize?: { width: number; height: number } | null;
    requestHead?: (url: string) => Promise<{ ok: () => boolean; status: () => number }>;
    requestGet?: (url: string) => Promise<{ headers: () => Record<string, string> }>;
  } = {}) {
    this.evaluateReturns = options.evaluateReturns || [];
    this._url = options.url || 'https://example.com';
    this._viewportSize = options.viewportSize ?? { width: 1280, height: 800 };
    this._requestHead = options.requestHead || (async () => ({ ok: () => true, status: () => 200 }));
    this._requestGet = options.requestGet || (async () => ({ headers: () => ({}) }));
  }

  goto = async () => ({});
  url = () => this._url;

  evaluate = async <T>(): Promise<T> => {
    const result = this.evaluateReturns[this.evaluateIndex] ?? {};
    this.evaluateIndex++;
    return result as T;
  };

  setViewportSize = async () => {};
  viewportSize = () => this._viewportSize;

  waitForTimeout = async () => {
    if (this.onWait) this.onWait();
  };

  on = (event: string, handler: (...args: any[]) => void) => {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  };

  removeListener = (event: string, handler: (...args: any[]) => void) => {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }
  };

  $$eval = async <T>(): Promise<T> => ({} as T);

  request = {
    head: (url: string, _options?: { timeout?: number }) => this._requestHead(url),
    get: (url: string, _options?: { headers?: Record<string, string> }) => this._requestGet(url),
  };

  content = async () => '<html></html>';

  /**
   * Emit an event to all registered handlers (for testing console/requestfailed events)
   */
  emit(event: string, ...args: unknown[]) {
    (this.handlers[event] || []).forEach(h => h(...args));
  }

  /**
   * Get this mock as a PlaywrightPage type
   */
  asPage(): PlaywrightPage {
    return this as unknown as PlaywrightPage;
  }
}
