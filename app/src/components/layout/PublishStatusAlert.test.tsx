import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import PublishStatusAlert from './PublishStatusAlert';

const mockRouter = { push: vi.fn() };
const mockDevelopStore = {
  currentAppId: 'app-123',
  publishStates: {},
  setIsPublishing: vi.fn(),
  setPublishError: vi.fn(),
  dismissPublishSuccess: vi.fn(),
  clearPublishStatus: vi.fn(),
};
const mockSiteStore = {
  getSite: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/usePublishApp', () => ({
  usePublishApp: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ result: 'success', commitHash: 'abc123' }),
  }),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: any) => selector(mockSiteStore),
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));
vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn((site) => !!site?.published_url),
}));
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PublishStatusAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.publishStates = {};
    mockDevelopStore.currentAppId = 'app-123';
    mockSiteStore.getSite.mockReturnValue(null);
  });

  it('should render nothing when no publish status', () => {
    const { container } = renderWithProviders(<PublishStatusAlert />);

    expect(container.firstChild).toBeNull();
  });

  it('should render publishing alert when isPublishing is true', () => {
    mockDevelopStore.publishStates = {
      'app-123': { isPublishing: true },
    };

    renderWithProviders(<PublishStatusAlert />);

    expect(screen.getByText('builder_publish_progress_title')).toBeInTheDocument();
    expect(screen.getByText('builder_publish_progress_message')).toBeInTheDocument();
  });

  it('should render error alert when publishError is true', () => {
    mockDevelopStore.publishStates = {
      'app-123': { publishError: true },
    };

    renderWithProviders(<PublishStatusAlert />);

    expect(screen.getByText('builder_publish_failed_title')).toBeInTheDocument();
    expect(screen.getByText('builder_publish_failed_message')).toBeInTheDocument();
  });

  it('should render try again button on error', () => {
    mockDevelopStore.publishStates = {
      'app-123': { publishError: true },
    };

    renderWithProviders(<PublishStatusAlert />);

    expect(screen.getByText('builder_publish_error_button_try_again')).toBeInTheDocument();
  });

  it('should call handleTryAgain when try again button clicked', async () => {
    mockDevelopStore.publishStates = {
      'app-123': { publishError: true },
    };

    const { user } = renderWithProviders(<PublishStatusAlert />);

    const tryAgainButton = screen.getByText('builder_publish_error_button_try_again');
    await user.click(tryAgainButton);

    await waitFor(() => {
      expect(mockDevelopStore.clearPublishStatus).toHaveBeenCalledWith('app-123');
      expect(mockDevelopStore.setIsPublishing).toHaveBeenCalledWith('app-123', true);
    });
  });

  it('should render build error alert when buildErrorDetails exists', () => {
    mockDevelopStore.publishStates = {
      'app-123': {
        publishError: true,
        buildErrorDetails: {
          error: 'Build failed: syntax error',
          exitCode: 1,
        },
      },
    };

    renderWithProviders(<PublishStatusAlert />);

    expect(screen.getByText('builder_publish_build_failed_title')).toBeInTheDocument();
    expect(screen.getByText('Build failed: syntax error')).toBeInTheDocument();
  });

  it('should render fix button for build errors', () => {
    mockDevelopStore.publishStates = {
      'app-123': {
        publishError: true,
        buildErrorDetails: {
          error: 'Build failed',
          exitCode: 1,
        },
      },
    };

    renderWithProviders(<PublishStatusAlert />);

    expect(screen.getByText('builder_publish_error_button_fix')).toBeInTheDocument();
  });

  it('should render success alert when showSuccessAlert is true', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    renderWithProviders(<PublishStatusAlert />);

    expect(screen.getByText('builder_publish_success_title')).toBeInTheDocument();
  });

  it('should render domain settings button in success alert', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    renderWithProviders(<PublishStatusAlert />);

    // Should show button to view domain settings
    expect(screen.getByText('builder_publish_success_button_domain')).toBeInTheDocument();
  });

  it('should call dismissPublishSuccess when success alert closed', async () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    const { user, container } = renderWithProviders(<PublishStatusAlert />);

    const closeButton = container.querySelector('button[aria-label="Close"]');
    if (closeButton) {
      await user.click(closeButton);

      await waitFor(() => {
        expect(mockDevelopStore.dismissPublishSuccess).toHaveBeenCalledWith('app-123');
      });
    }
  });

  it('should navigate to settings when view settings button clicked', async () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    const { user } = renderWithProviders(<PublishStatusAlert />);

    const settingsButton = screen.getByText('builder_publish_success_button_domain');
    await user.click(settingsButton);

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/develop/app-123?tab=settings&settings=domain');
    });
  });

  it('should handle fix build error button click', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDevelopStore.publishStates = {
      'app-123': {
        publishError: true,
        buildErrorDetails: {
          error: 'Build failed',
          details: 'Detailed error',
          exitCode: 1,
        },
      },
    };

    const { user } = renderWithProviders(<PublishStatusAlert />);

    const fixButton = screen.getByText('builder_publish_error_button_fix');
    await user.click(fixButton);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'build-error-fix-request',
          appId: 'app-123',
          errorMessage: 'Build failed',
        }),
        window.location.origin
      );
    });
  });

  it('should call clearPublishStatus when error alert dismissed', async () => {
    mockDevelopStore.publishStates = {
      'app-123': { publishError: true },
    };

    const { user, container } = renderWithProviders(<PublishStatusAlert />);

    const closeButton = container.querySelector('button[aria-label="Close"]');
    if (closeButton) {
      await user.click(closeButton);

      await waitFor(() => {
        expect(mockDevelopStore.clearPublishStatus).toHaveBeenCalledWith('app-123');
      });
    }
  });
});
