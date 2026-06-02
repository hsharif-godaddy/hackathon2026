import '@testing-library/jest-dom';

import { afterAll, vi } from 'vitest';

/**
 * Vitest global setup
 *
 * Configures test environment with mock values and global mocks
 */

// Mock environment variables for control plane
process.env.MGMT_AIRO_BASE_URL = 'https://mgmt.nstk.net';
process.env.MGMT_AIRO_DATACENTER = 'sxb1';
process.env.MGMT_AIRO_PRODUCT_ID = 'aab-v1';

// Mock console methods to reduce noise in test output
// Errors and warnings are still captured by vitest for assertion
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock fetch globally (can be overridden in individual tests)
global.fetch = vi.fn();

// Fully mock gasket-auth to prevent real network requests and provide the minimal runtime exports
// used by application code (some are imported as values even if only used for typing).
vi.mock('@godaddy/gasket-auth', async () => {
  const React = await import('react')
  return {
    useAuthState: () => ({ isLoading: false, isAuthenticated: true, details: {} }),
    AuthRequired: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    AuthIdpType: {},
    AuthRealmType: {},
    AuthRiskType: {},
  }
})

// next/font/google has no real implementation under Vitest (no Next.js font pipeline)
vi.mock('next/font/google', () => ({
  Fraunces: function mockFraunces() {
    return { className: 'vitest-mock-font-fraunces', variable: '--font-mock-fraunces' };
  },
}))

// jsdom provides sessionStorage and localStorage, but we need to ensure they're cleared between tests
// This will be handled in beforeEach hooks in individual test files

// Browser-specific mocks (only when running in jsdom environment)
if (typeof window !== 'undefined') {
  // jsdom doesn't implement getBoundingClientRect on Range or Text. Lexical 0.42's
  // updateDOMSelection (used by PromptBox) calls it after every editor commit and
  // raises an unhandled TypeError that fails the run even when tests pass. Stub
  // both with a zero rect — selection scrolling has no meaning in jsdom.
  const zeroRect = (): DOMRect => ({
    x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  const ensureGBCR = (proto: object) => {
    if (!('getBoundingClientRect' in proto)) {
      Object.defineProperty(proto, 'getBoundingClientRect', {
        configurable: true,
        writable: true,
        value: zeroRect,
      });
    }
  };
  if (typeof Range !== 'undefined') ensureGBCR(Range.prototype);
  if (typeof Text !== 'undefined') ensureGBCR(Text.prototype);

  // Fix getComputedStyle error with pseudo-elements
  const originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = ((element: Element, pseudoElt?: string | null) => {
    if (pseudoElt) {
      return {
        getPropertyValue: () => '',
      } as unknown as CSSStyleDeclaration;
    }
    return originalGetComputedStyle(element);
  }) as typeof window.getComputedStyle;

  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(function () { return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: '',
    thresholds: [],
    takeRecords: () => [],
  }; });

  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(function () { return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }; });

  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(function (query: string) { return {
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }; }),
  });
}

// Final cleanup after all test files complete
// This runs once at the end of the test suite to restore any global mocks.
// Individual test files should handle their own cleanup in afterEach/afterAll
// hooks if they need to prevent mock leakage between tests.
afterAll(() => {
  vi.restoreAllMocks();
});
