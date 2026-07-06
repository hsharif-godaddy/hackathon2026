/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { TranslationsProvider } from './TranslationProvider';

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({ intl: { locale: 'en-US' } }),
}));

vi.mock('@/hooks/useTranslationPackages', () => ({
  useTranslationPackages: () => ({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: undefined,
  }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/components/auth/LoadingComponent', () => ({
  default: () => <div>Loading...</div>,
}));

const MISSING_KEY = 'builder_common_done';
const BAD_SYNTAX_KEY = 'builder_design_kit_gallery_switch';

function MissingKeyWithFallbackChild() {
  const t = useTranslations();
  return <span data-testid="label">{t(MISSING_KEY, undefined, 'Fallback copy')}</span>;
}

function MissingKeyChild() {
  const t = useTranslations();
  return <span data-testid="label">{t(MISSING_KEY)}</span>;
}

function BadSyntaxChild() {
  const t = useTranslations();
  return <span data-testid="label">{t(BAD_SYNTAX_KEY, { count: 2 })}</span>;
}

describe('TranslationsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not throw on missing translation in production and renders defaultMessage', function missingKeyProd() {
    vi.stubEnv('NODE_ENV', 'production');
    render(
      <TranslationsProvider locale="en-US" messages={{}}>
        <MissingKeyWithFallbackChild />
      </TranslationsProvider>,
    );
    expect(screen.getByTestId('label')).toHaveTextContent('Fallback copy');
  });

  it('logs missing translations in production when no defaultMessage is provided', function missingKeyWarnProd() {
    vi.stubEnv('NODE_ENV', 'production');
    render(
      <TranslationsProvider locale="en-US" messages={{}}>
        <MissingKeyChild />
      </TranslationsProvider>,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'translations.intl.missing',
      expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    );
  });

  it('logs intl errors without throwing in production for invalid ICU syntax', function syntaxErrorProd() {
    vi.stubEnv('NODE_ENV', 'production');
    render(
      <TranslationsProvider locale="en-US" messages={{ [BAD_SYNTAX_KEY]: '{count, plural, one {#}' }}>
        <BadSyntaxChild />
      </TranslationsProvider>,
    );
    expect(logger.error).toHaveBeenCalledWith(
      'translations.intl.error',
      expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    );
  });

  it('throws on invalid ICU syntax in development', async function syntaxErrorDev() {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { TranslationsProvider: DevTranslationsProvider } = await import('./TranslationProvider');

    expect(() =>
      render(
        <DevTranslationsProvider locale="en-US" messages={{ [BAD_SYNTAX_KEY]: '{count, plural, one {#}' }}>
          <BadSyntaxChild />
        </DevTranslationsProvider>,
      ),
    ).toThrow();
  });
});
