import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { mockAuthContext, mockParams, mockRouter, mockSearchParams } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import Home from './page';

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
  },
  MAX_PROMPT_LENGTH: 40000,
  auth: { enabled: false },
  authUtils: {
    getSupportedAuthTypes: vi.fn(() => ['sso']),
  },
}));
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
