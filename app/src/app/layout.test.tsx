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
vi.mock('../../gasket', () => ({
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
  withGasketData: () => (component: unknown) => component,
}));
vi.mock('@godaddy/gasket-next/layout', () => ({
  makeLayout: () => ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

import RootLayout from './layout';

describe('RootLayout', () => {
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

  it('should run translations, experiments, and instrumentation in parallel', async () => {
    type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
    function deferred<T>(): Deferred<T> {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => { resolve = r; });
      return { promise, resolve };
    }

    const translationsDeferred = deferred<Record<string, string>>();
    const experimentsDeferred = deferred<Record<string, string>>();
    const instrumentationDeferred = deferred<void>();

    mockLoadTranslations.mockReturnValue(translationsDeferred.promise);
    mockGetExperimentCohorts.mockReturnValue(experimentsDeferred.promise);
    mockInstrumentPageRequest.mockReturnValue(instrumentationDeferred.promise);

    const layoutPromise = RootLayout({ children: <div>test</div> });

    // Drain microtasks — resolveTranslations awaits detectLocale() before calling
    // loadTranslations(), so a single Promise.resolve() isn't sufficient.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLoadTranslations).toHaveBeenCalledTimes(1);
    expect(mockGetExperimentCohorts).toHaveBeenCalledTimes(1);
    expect(mockInstrumentPageRequest).toHaveBeenCalledTimes(1);

    translationsDeferred.resolve({ key: 'value' });
    experimentsDeferred.resolve({});
    instrumentationDeferred.resolve(undefined);

    await layoutPromise;
  });

  it('should await instrumentPageRequest (not fire-and-forget)', async () => {
    let instrumentResolved = false;
    mockInstrumentPageRequest.mockImplementation(
      () => new Promise<void>((resolve) => {
        setTimeout(() => {
          instrumentResolved = true;
          resolve();
        }, 10);
      })
    );

    await RootLayout({ children: <div>test</div> });

    expect(instrumentResolved).toBe(true);
  });

  it('should load translations with @airo-app-builder/aab package', async () => {
    await RootLayout({ children: <div>test</div> });

    expect(mockLoadTranslations).toHaveBeenCalledWith('en-US', ['@airo-app-builder/aab']);
  });

  it('should handle translation load failure gracefully', async () => {
    const { logger } = await import('@/lib/request-context');
    mockLoadTranslations.mockRejectedValue(new Error('fetch failed'));

    await RootLayout({ children: <div>test</div> });

    expect(logger.error).toHaveBeenCalledWith(
      'translations.layout.load.failure',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('should handle experiment resolution failure gracefully', async () => {
    const { logger } = await import('@/lib/request-context');
    mockGetExperimentCohorts.mockRejectedValue(new Error('hivemind down'));

    await RootLayout({ children: <div>test</div> });

    expect(logger.error).toHaveBeenCalledWith(
      'hivemind.experiments.error',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('should handle instrumentPageRequest failure without breaking the page', async () => {
    const { logger } = await import('@/lib/request-context');
    mockInstrumentPageRequest.mockRejectedValue(new Error('OTel backend down'));

    await RootLayout({ children: <div>test</div> });

    expect(logger.error).toHaveBeenCalledWith(
      'apm.instrumentation.error',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('should pass undefined messages to TranslationsProvider when translations are empty', async () => {
    mockLoadTranslations.mockResolvedValue({});

    const tree = await RootLayout({ children: <div>test</div> });

    function findProps(element: any, targetType: any): any {
      if (!element || typeof element !== 'object') return null;
      if (element.type === targetType) return element.props;
      for (const child of [element.props?.children].flat(Infinity)) {
        const found = findProps(child, targetType);
        if (found) return found;
      }
      return null;
    }

    const { TranslationsProvider } = await import('@/components/providers/TranslationProvider');
    const props = findProps(tree, TranslationsProvider);
    expect(props).toBeTruthy();
    expect(props.messages).toBeUndefined();
  });
});
