import { vi } from 'vitest';

import type { SiteInfo, SiteVariant } from '@/lib/control-plane/types';
import { SiteStatus } from '@/lib/control-plane/types';

/**
 * Create a mock SiteVariant
 */
export function createMockVariant(variant: string, overrides: Partial<SiteVariant> = {}): SiteVariant {
  return {
    variant,
    status: 'active',
    ...overrides,
  };
}

/**
 * Mock next/navigation router with common methods
 *
 * @returns Mocked router object with push, replace, etc.
 *
 * @example
 * vi.mock('next/navigation', () => ({
 *   useRouter: () => mockRouter(),
 * }));
 */
export function mockRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
}

/**
 * Mock next/navigation useParams hook
 *
 * @param params - Key-value pairs for route parameters
 * @returns Mocked params object
 *
 * @example
 * vi.mock('next/navigation', () => ({
 *   useParams: () => mockParams({ id: '123' }),
 * }));
 */
export function mockParams(params: Record<string, string> = {}) {
  return params;
}

/**
 * Mock URL.createObjectURL and URL.revokeObjectURL for testing file/blob operations
 *
 * @example
 * beforeEach(() => {
 *   mockURLMethods();
 * });
 */
export function mockURLMethods() {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
}

/**
 * Create a mock SiteInfo object with default values
 *
 * @param overrides - Partial SiteInfo to override defaults
 * @returns Complete SiteInfo mock object
 *
 * @example
 * const site = createMockSite({ name: 'My App', status: SiteStatus.Running });
 * const siteWithVariants = createMockSite({ variants: ['preview', 'publish'] });
 */
export function createMockSite(overrides: Partial<SiteInfo> = {}): SiteInfo {
  return {
    id: 'test-site-123',
    name: 'Test Application',
    status: SiteStatus.Running,
    account_id: 'test-account-123',
    initial_prompt: 'Build a todo app',
    created_at: new Date('2024-01-01T00:00:00.000Z'),
    updated_at: new Date('2024-01-01T00:00:00.000Z'),
    preview_url: 'https://preview.test/app',
    published_url: null,
    variants: [],
    ...overrides,
  };
}

/**
 * Mock instrumentation utilities
 *
 * @returns Object with mocked instrumentation functions
 *
 * @example
 * vi.mock('@/utils/instrumentation', () => mockInstrumentation());
 */
export function mockInstrumentation() {
  return {
    normalizedAppId: (value: string | null | undefined): string | undefined => {
      if (value == null || value === '') {
        return undefined;
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return undefined;
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
        return undefined;
      }
      return value;
    },
    logImpressionEvent: vi.fn(function () { return vi.fn(); }),
    logAiroHQEvent: vi.fn(function () { return vi.fn(); }),
    logClickEvent: vi.fn(function () { return vi.fn(); }),
    logActionEvent: vi.fn(() => vi.fn()),
    generateClickEID: vi.fn((event: string) => `appbuilder.${event}.click`),
    fireConversionEvent: vi.fn(),
    getInstrumentationAppId: vi.fn(() => undefined),
    setInstrumentationAppId: vi.fn(),
    getInstrumentationEntryPoint: vi.fn(() => undefined),
    setInstrumentationEntryPoint: vi.fn(),
    getInstrumentationPlanType: vi.fn(() => undefined),
    setInstrumentationPlanType: vi.fn(),
    getInstrumentationCreationSource: vi.fn(() => undefined),
    setInstrumentationCreationSource: vi.fn(),
    getInstrumentationIntentCategory: vi.fn(() => undefined),
    setInstrumentationIntentCategory: vi.fn(),
    getInstrumentationBusinessName: vi.fn(() => undefined),
    setInstrumentationBusinessName: vi.fn(),
    getSharedInstrumentationContext: vi.fn(() => ({})),
  };
}

/**
 * Mock feature flags with configurable values
 *
 * @param overrides - Override specific feature flags
 * @returns Object with mocked feature flag functions
 *
 * @example
 * vi.mock('@/lib/features', () => mockFeatures({ developmentMode: true }));
 */
export function mockFeatures(overrides: { [key: string]: boolean } = {}) {
  const defaults = {
    mockLogin: true,
    developmentMode: false,
    devSupervisorTcp: false,
  };

  const config = { ...defaults, ...overrides };

  return {
    isFeatureEnabled: {
      mockLogin: () => config.mockLogin,
      developmentMode: () => config.developmentMode,
      devSupervisorTcp: () => config.devSupervisorTcp,
    },
    MAX_PROMPT_LENGTH: 40000,
    auth: { enabled: false },
  };
}

/**
 * Mock AuthProvider context with configurable values
 *
 * @param overrides - Override specific auth context values
 * @returns Object with mocked auth context
 *
 * @example
 * vi.mock('@/components/providers/AuthProvider', () => ({
 *   useAuthContext: () => mockAuthContext({ isAuthenticated: true }),
 * }));
 */
export function mockAuthContext(overrides: {
  isAuthenticated?: boolean;
  gasketConfig?: any;
  isMockAuth?: boolean;
  isLoading?: boolean;
} = {}) {
  return {
    isAuthenticated: false,
    gasketConfig: null,
    isMockAuth: false,
    isLoading: false,
    ...overrides,
  };
}

/**
 * Mock useSearchParams from next/navigation
 *
 * @param params - Key-value pairs for URL parameters
 * @returns Mocked useSearchParams function
 *
 * @example
 * vi.mock('next/navigation', () => ({
 *   useSearchParams: () => mockSearchParams({ initialPrompt: 'Build a blog' }),
 * }));
 */
export function mockSearchParams(params: Record<string, string | null> = {}) {
  return {
    get: vi.fn((key: string) => params[key] ?? null),
  };
}

/**
 * Mock useBreakpoints hook with configurable values
 *
 * @param overrides - Override specific breakpoint flags
 * @returns Object with all breakpoint booleans matching the real hook shape
 *
 * @example
 * vi.mock('@/hooks/useIsMobile', () => ({
 *   useIsMobile: () => true,
 * }));
 * // Or for breakpoint hook tests:
 * vi.mock('@/hooks/useBreakpoints', () => ({
 *   useBreakpoints: () => mockBreakpoints({ isMdBreakpoint: false, isBelowMdBreakpoint: true }),
 * }));
 */
export function mockBreakpoints(overrides: {
  isBelowSmBreakpoint?: boolean;
  isBelowMdBreakpoint?: boolean;
  isSmBreakpoint?: boolean;
  isMdBreakpoint?: boolean;
  isLgBreakpoint?: boolean;
  isXlBreakpoint?: boolean;
} = {}) {
  return {
    isBelowSmBreakpoint: false,
    isBelowMdBreakpoint: false,
    isSmBreakpoint: true,
    isMdBreakpoint: true,
    isLgBreakpoint: true,
    isXlBreakpoint: false,
    ...overrides,
  };
}
