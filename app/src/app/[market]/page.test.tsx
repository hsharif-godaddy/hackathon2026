/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { mockAuthContext, mockParams, mockRouter, mockSearchParams } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import HomeContent from './HomeContent';

const mockSignIn = vi.fn();
const shipAnalyticsLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/gasket-config');
vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: () => ({ cohort: 'test-cohort', data: undefined, experiment: undefined }),
  useIsInCohort: vi.fn(function () { return false; }),
}));
vi.mock('@/lib/logging', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/logging')>();
  return {
    ...mod,
    shipAnalyticsLog: (...args: unknown[]) => shipAnalyticsLogMock(...args),
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => '/',
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (eid: string) { return eid; }),
  logActionEvent: vi.fn(function () { return vi.fn(); }),
  logAiroHQEvent: vi.fn(function () { return vi.fn(); }),
  logClickEvent: vi.fn(function () { return vi.fn(); }),
  logErrorEvent: vi.fn(function () { return vi.fn(); }),
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    mockLogin: vi.fn().mockReturnValue(true),
    developmentMode: vi.fn().mockReturnValue(false),
    devSupervisorTcp: vi.fn().mockReturnValue(false),
  },
  MAX_PROMPT_LENGTH: 40000,
  auth: { enabled: false },
  authUtils: {
    getSupportedAuthTypes: vi.fn(function () { return ['sso']; }),
  },
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext({ isAuthenticated: true }),
}));
vi.mock('@/hooks/useSafariClass', () => ({
  useSafariClass: vi.fn(),
}));
vi.mock('@/hooks/useSsoSignIn', () => ({
  useSsoSignIn: () => ({ signIn: mockSignIn, useSsoModal: true }),
}));

function mockResponse(body: object, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    clone: vi.fn().mockReturnThis(),
    headers: new Headers({ 'content-type': 'application/json' }),
  };
}

async function typePromptAndSubmit(prompt: string) {
  const input = screen.getByTestId('homepage-prompt-input');
  fireEvent.change(input, { target: { value: prompt } });

  // HeroSection debounces setPromptText by 50ms — wait for it to fire and re-render
  await act(async () => {
    await new Promise(function delay(resolve) { setTimeout(resolve, 100) });
  });

  const button = screen.getByRole('button', { name: /builder_homepage_hero_prompt_button$/i });
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
}

describe('Home Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should render without crashing', async () => {
    renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);

    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });

  it('should log impression event on mount', async () => {
    const { logImpressionEvent } = await import('@/utils/instrumentation');

    renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);

    await waitFor(() => {
      expect(logImpressionEvent).toHaveBeenCalledWith('homepage.page.view', { cohort: 'test-cohort' });
    });
  });

  it('should handle localStorage operations', async () => {
    localStorage.setItem('airo-pending-prompt', 'Build a dashboard');

    renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);

    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

    renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);

    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });

  describe('quick-create error handling', () => {
    it('should trigger login on 401 response', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Authentication token required' }, 401
      ) as any);

      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalled();
      });
    });

    it('should show friendly error on 500 with details', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Failed to create site record', details: 'Subscription has no systems' }, 500
      ) as any);

      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(screen.getByText('builder_homepage_error_create')).toBeInTheDocument();
      });
    });

    it('should show friendly error on 500 without details', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Failed to create site record' }, 500
      ) as any);

      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(screen.getByText('builder_homepage_error_create')).toBeInTheDocument();
      });
    });

    it('should save prompt before triggering login on 401', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Unauthorized' }, 401
      ) as any);

      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);
      await typePromptAndSubmit('Build a dashboard');

      await waitFor(() => {
        expect(localStorage.getItem('airo-pending-prompt')).toBe('Build a dashboard');
      });
    });
  });

  describe('homepage engagement shipAnalyticsLog', () => {
    it('logs homepage.view after auth resolved', async function homepageView() {
      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);

      await waitFor(() => {
        expect(shipAnalyticsLogMock).toHaveBeenCalledWith(
          'homepage.view',
          expect.objectContaining({ isAuthenticated: true, cohort: 'test-cohort' }),
        );
      });
    });

    it('logs submit_attempt and redirect.develop on quick-create success', async function redirectSuccess() {
      vi.mocked(appFetch).mockResolvedValue(mockResponse({ id: 'site-1', type: 'app' }, 200) as any);
      const { logImpressionEvent } = await import('@/utils/instrumentation');

      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(shipAnalyticsLogMock).toHaveBeenCalledWith(
          'homepage.prompt.submit_attempt',
          expect.objectContaining({
            submitSource: 'text',
            promptLength: expect.any(Number),
            cohort: 'test-cohort',
            isAuthenticated: true,
          }),
        );
        expect(shipAnalyticsLogMock).toHaveBeenCalledWith(
          'homepage.redirect.develop',
          expect.objectContaining({
            submitSource: 'text',
            cohort: 'test-cohort',
            isAuthenticated: true,
          }),
        );
        expect(logImpressionEvent).toHaveBeenCalledWith('homepage.redirect.develop', {
          cohort: 'test-cohort',
        });
      });
    });

    it('logs auth_gate.shown when quick-create returns 401', async function authGate401() {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Authentication token required' }, 401
      ) as any);

      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(shipAnalyticsLogMock).toHaveBeenCalledWith(
          'homepage.auth_gate.shown',
          expect.objectContaining({
            submitSource: 'text',
            cohort: 'test-cohort',
            isAuthenticated: true,
          }),
        );
      });
    });

    it('logs submit.error on 500 quick-create', async function submitError500() {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Failed to create site record', details: 'Subscription has no systems' }, 500
      ) as any);

      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(shipAnalyticsLogMock).toHaveBeenCalledWith(
          'homepage.submit.error',
          expect.objectContaining({
            submitSource: 'text',
            cohort: 'test-cohort',
            isAuthenticated: true,
            errorMessage: expect.stringContaining('Failed to create site'),
          }),
        );
      });
    });
  });

  describe('public sections rendering', () => {
    it('should render Pricing section when serverFeatures.showPricingSection is true', async () => {
      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);

      await waitFor(() => {
        expect(screen.getByTestId('pricing-section')).toBeInTheDocument();
      });
    });

    it('should not render Pricing section when serverFeatures.showPricingSection is false', async () => {
      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: false }} />);

      await waitFor(() => {
        expect(screen.queryByTestId('pricing-section')).not.toBeInTheDocument();
      });
    });

    it('should always render FAQ section', async () => {
      renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />);

      await waitFor(() => {
        expect(screen.getByTestId('faq-section')).toBeInTheDocument();
      });
    });

    it('should render FAQ section for unauthenticated users', async () => {
      const mod = await import('@/components/providers/AuthProvider')
      const originalUseAuthContext = mod.useAuthContext
      try {
        const mockUnauthContext = vi.fn(function () { return mockAuthContext({ isAuthenticated: false }); })
        vi.mocked(mod).useAuthContext = mockUnauthContext as any

        renderWithProviders(<HomeContent serverFeatures={{ showPricingSection: true }} />)

        await waitFor(() => {
          expect(screen.getByTestId('faq-section')).toBeInTheDocument()
        })
      } finally {
        vi.mocked(mod).useAuthContext = originalUseAuthContext as any
      }
    });
  });
});
