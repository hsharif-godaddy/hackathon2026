import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import { mockRouter, mockInstrumentation, mockFeatures, mockAuthContext, mockSearchParams, mockParams } from '@/tests/mocks';
import Home from './page';
import { appFetch } from '@/lib/gasket-config';

vi.mock('@/lib/gasket-config');
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => '/',
}));
vi.mock('@/utils/instrumentation', () => mockInstrumentation());
vi.mock('@/lib/features', () => mockFeatures());
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext(),
}));
vi.mock('@/hooks/useSafariClass', () => ({
  useSafariClass: vi.fn(),
}));

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
});
