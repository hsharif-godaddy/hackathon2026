/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHeaders = new Map<string, string>();
mockHeaders.set = vi.fn(Map.prototype.set.bind(mockHeaders));
mockHeaders.get = vi.fn(Map.prototype.get.bind(mockHeaders));
mockHeaders.entries = vi.fn(Map.prototype.entries.bind(mockHeaders));
mockHeaders.forEach = vi.fn(Map.prototype.forEach.bind(mockHeaders));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => mockHeaders),
}));

vi.mock('@/styles/globals.scss', () => ({}));

const mockLoadTranslations = vi.fn();
const mockDetectLocale = vi.fn();
vi.mock('@/lib/translations', () => ({
  detectLocale: (...args: unknown[]) => mockDetectLocale(...args),
  getServerIntl: vi.fn(),
}));
vi.mock('@/lib/translations/load-translations', () => ({
  loadTranslations: (...args: unknown[]) => mockLoadTranslations(...args),
}));

const mockInstrumentPageRequest = vi.fn();
vi.mock('@/lib/apm-context', () => ({
  instrumentPageRequest: (...args: unknown[]) => mockInstrumentPageRequest(...args),
}));

const mockGetExperimentCohorts = vi.fn();
vi.mock('../../../gasket', () => ({
  default: {
    actions: {
      getExperimentCohorts: (...args: unknown[]) => mockGetExperimentCohorts(...args),
    },
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/config/experiments', () => ({
  EXPERIMENT_IDS: { homepageEngagement: 'homepage-engagement' },
}));

vi.mock('@gasket/nextjs/layout', () => ({
  withGasketData: () => (Component: React.ComponentType<any>) => Component,
}));

vi.mock('@godaddy/gasket-next/layout', () => ({
  makeLayout: () => ({ children, params }: { children: React.ReactNode; params: unknown }) => <>{children}</>,
}));

vi.mock('@/components/auth/AuthBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/auth/GlobalSsoLogin', () => ({ default: () => null }));
vi.mock('@/components/auth/SessionTimeoutManager', () => ({ default: () => null }));
vi.mock('@/components/providers/AuthProvider', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/providers/FullStoryProvider', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/providers/QueryClientProvider', () => ({ QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/providers/SubscriptionCacheProvider', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/providers/TranslationProvider', () => ({ TranslationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/security/ConversationIdCookie', () => ({ default: () => null }));
vi.mock('@/components/security/FrameBuster', () => ({ default: () => null }));
vi.mock('@/components/tracking/ItcInitializer', () => ({ default: () => null }));
vi.mock('@/components/tracking/ReferralTracker', () => ({ default: () => null }));

import MarketLayout from './layout';

describe('MarketLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectLocale.mockResolvedValue('en-US');
    mockLoadTranslations.mockResolvedValue({ key: 'value' });
    mockInstrumentPageRequest.mockResolvedValue(undefined);
    mockGetExperimentCohorts.mockResolvedValue({
      'aa-airo-builder': 'control',
      'homepage-engagement': 'variant-a',
    });
  });

  it('should load translations with @airo-app-builder/aab package', async () => {
    await MarketLayout({ children: <div>test</div>, params: Promise.resolve({ market: 'en-US' }) });

    expect(mockLoadTranslations).toHaveBeenCalledWith('en-US', ['@airo-app-builder/aab']);
  });

  it('should handle translation load failure gracefully', async () => {
    const { logger } = await import('@/lib/request-context');
    mockLoadTranslations.mockRejectedValue(new Error('fetch failed'));

    await MarketLayout({ children: <div>test</div>, params: Promise.resolve({ market: 'en-US' }) });

    expect(logger.error).toHaveBeenCalledWith(
      'translations.layout.load.failure',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('should handle experiment resolution failure gracefully', async () => {
    const { logger } = await import('@/lib/request-context');
    mockGetExperimentCohorts.mockRejectedValue(new Error('hivemind down'));

    await MarketLayout({ children: <div>test</div>, params: Promise.resolve({ market: 'en-US' }) });

    expect(logger.warn).toHaveBeenCalledWith('hivemind.experiment.error', expect.any(Object));
  });

  it('should throw when instrumentPageRequest fails', async () => {
    mockInstrumentPageRequest.mockRejectedValue(new Error('OTel backend down'));

    await expect(
      MarketLayout({ children: <div>test</div>, params: Promise.resolve({ market: 'en-US' }) })
    ).rejects.toThrow('OTel backend down');
  });
});
