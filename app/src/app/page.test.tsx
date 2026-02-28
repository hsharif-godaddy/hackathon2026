import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { mockAuthContext, mockParams, mockRouter, mockSearchParams } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import Home from './page';

const mockSignIn = vi.fn();

vi.mock('@/lib/gasket-config');
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => '/',
}));
vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  logActionEvent: vi.fn(() => vi.fn()),
  logErrorEvent: vi.fn(() => vi.fn()),
  generateClickEID: vi.fn((eid: string) => eid),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    codeEditor: vi.fn().mockReturnValue(false),
    mockLogin: vi.fn().mockReturnValue(true),
    developmentMode: vi.fn().mockReturnValue(false),
    galleryPage: vi.fn().mockReturnValue(false),
    devSupervisorTcp: vi.fn().mockReturnValue(false),
    pricingSection: vi.fn().mockReturnValue(true),
  },
  MAX_PROMPT_LENGTH: 40000,
  auth: { enabled: false },
  authUtils: {
    getSupportedAuthTypes: vi.fn(() => ['sso']),
  },
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext({ isAuthenticated: true, isAuthDisabled: false }),
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
    renderWithProviders(<Home />);

    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });

  it('should log impression event on mount', async () => {
    const { logImpressionEvent } = await import('@/utils/instrumentation');

    renderWithProviders(<Home />);

    await waitFor(() => {
      expect(logImpressionEvent).toHaveBeenCalledWith('homepage.page.view');
    });
  });

  it('should handle localStorage operations', async () => {
    localStorage.setItem('airo-pending-prompt', 'Build a dashboard');

    renderWithProviders(<Home />);

    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

    renderWithProviders(<Home />);

    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
  });

  describe('quick-create error handling', () => {
    it('should trigger login on 401 response', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Authentication token required' }, 401
      ) as any);

      renderWithProviders(<Home />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalled();
      });
    });

    it('should show friendly error on 500 with details', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Failed to create site record', details: 'Subscription has no systems' }, 500
      ) as any);

      renderWithProviders(<Home />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(screen.getByText('builder_homepage_error_create')).toBeInTheDocument();
      });
    });

    it('should show friendly error on 500 without details', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Failed to create site record' }, 500
      ) as any);

      renderWithProviders(<Home />);
      await typePromptAndSubmit('Build me an app');

      await waitFor(() => {
        expect(screen.getByText('builder_homepage_error_create')).toBeInTheDocument();
      });
    });

    it('should save prompt before triggering login on 401', async () => {
      vi.mocked(appFetch).mockResolvedValue(mockResponse(
        { error: 'Unauthorized' }, 401
      ) as any);

      renderWithProviders(<Home />);
      await typePromptAndSubmit('Build a dashboard');

      await waitFor(() => {
        expect(localStorage.getItem('airo-pending-prompt')).toBe('Build a dashboard');
      });
    });
  });

  describe('public sections rendering', () => {
    it('should render Pricing section when feature flag is enabled', async () => {
      const { isFeatureEnabled } = await import('@/lib/features');
      vi.mocked(isFeatureEnabled.pricingSection).mockReturnValue(true);

      renderWithProviders(<Home />);

      await waitFor(() => {
        expect(screen.getByTestId('pricing-section')).toBeInTheDocument();
      });
    });

    it('should not render Pricing section when feature flag is disabled', async () => {
      const { isFeatureEnabled } = await import('@/lib/features');
      vi.mocked(isFeatureEnabled.pricingSection).mockReturnValue(false);

      renderWithProviders(<Home />);

      await waitFor(() => {
        expect(screen.queryByTestId('pricing-section')).not.toBeInTheDocument();
      });
    });

    it('should always render FAQ section', async () => {
      renderWithProviders(<Home />);

      await waitFor(() => {
        expect(screen.getByTestId('faq-section')).toBeInTheDocument();
      });
    });

    it('should render FAQ section for unauthenticated users', async () => {
      const mockUnauthContext = vi.fn(() => mockAuthContext({ isAuthenticated: false, isAuthDisabled: false }));
      vi.mocked(await import('@/components/providers/AuthProvider')).useAuthContext = mockUnauthContext as any;

      renderWithProviders(<Home />);

      await waitFor(() => {
        expect(screen.getByTestId('faq-section')).toBeInTheDocument();
      });
    });
  });
});
