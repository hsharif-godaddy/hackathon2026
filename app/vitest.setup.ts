import { vi, afterAll } from 'vitest';

/**
 * Vitest global setup
 * 
 * Configures test environment with mock values and global mocks
 */

// Mock environment variables for V2 control plane
process.env.MGMT_AIRO_BASE_URL = 'https://mgmt.nstk.net';
process.env.MGMT_AIRO_DATACENTER = 'sxb1';
process.env.MGMT_AIRO_PRODUCT_ID = 'aab-v1';
process.env.USE_V2_CONTROL_PLANE = 'true';

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

// Ensure appFetch/authFetch-based code paths work in tests without relying on external auth behavior.
// Fully mock gasket-auth to prevent real network requests and provide the minimal runtime exports
// used by application code (some are imported as values even if only used for typing).
vi.mock('@godaddy/gasket-auth', async () => {
  const React = await import('react')
  return {
    authFetch: (url: string, options?: RequestInit) => globalThis.fetch(url, options),
    useAuthState: () => ({ isLoading: false, isAuthenticated: true, details: {} }),
    AuthRequired: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    AuthIdpType: {},
    AuthRealmType: {},
    AuthRiskType: {},
  }
})

// jsdom provides sessionStorage and localStorage, but we need to ensure they're cleared between tests
// This will be handled in beforeEach hooks in individual test files

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
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  root: null,
  rootMargin: '',
  thresholds: [],
  takeRecords: () => [],
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Final cleanup after all test files complete
// This runs once at the end of the test suite to restore any global mocks.
// Individual test files should handle their own cleanup in afterEach/afterAll
// hooks if they need to prevent mock leakage between tests.
afterAll(() => {
  vi.restoreAllMocks();
});
