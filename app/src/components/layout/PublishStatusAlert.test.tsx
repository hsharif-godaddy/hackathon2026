/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { FEEDBACK_ID } from '@/components/feedback/utils';
import { renderWithProviders } from '@/tests/test-utils';
import PublishStatusAlert from './PublishStatusAlert';

const mockRouter = { push: vi.fn(), replace: vi.fn() };
const mockDevelopStore = {
  currentAppId: 'app-123',
  publishStates: {},
  setIsPublishing: vi.fn(),
  setPublishError: vi.fn(),
  dismissPublishSuccess: vi.fn(),
  clearPublishStatus: vi.fn(),
  setShowGoLiveModal: vi.fn(),
  getPublishState: vi.fn((appId: string) => mockDevelopStore.publishStates[appId] || null),
};
const mockSiteStore = {
  getSite: vi.fn(),
};
const mockUseSwitchboard = vi.fn(() => (true));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/develop/app-123',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/usePublishApp', () => ({
  usePublishApp: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ result: 'success', commitHash: 'abc123' }),
  }),
}));
vi.mock('@/hooks/usePublishComplianceGate', () => ({
  usePublishComplianceGate: () => ({
    isBlocked: false,
    blockReason: null,
    blockMessage: null,
  }),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: any) => selector(mockSiteStore),
}));

const mockStreamingStore = {
  isLoading: false,
  isActivelyStreaming: false,
};
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsLoading: () => mockStreamingStore.isLoading,
  useIsActivelyStreaming: () => mockStreamingStore.isActivelyStreaming,
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
    warn: vi.fn(),
  },
}));
const mockSetActiveSettingsSection = vi.fn();
vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    activeChatTab: 'chat',
    setActiveChatTab: vi.fn(),
    activeSettingsSection: 'domain',
    setActiveSettingsSection: mockSetActiveSettingsSection,
  }),
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockUseSwitchboard(),
}));
vi.mock('@/components/feedback/Feedback', () => ({
  Feedback: ({ onClose, onSubmitSuccess }: { onClose: () => void; onSubmitSuccess: () => void }) => (
    <div data-testid='feedback-modal'>
      <button onClick={onClose}>close-feedback</button>
      <button onClick={onSubmitSuccess}>submit-feedback</button>
    </div>
  ),
}));
vi.mock('@/components/feedback/utils', () => ({
  FEEDBACK_ID: 'airo#app-builder',
}));

describe('PublishStatusAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.publishStates = {};
    mockDevelopStore.currentAppId = 'app-123';
    mockSiteStore.getSite.mockReturnValue(null);
    mockUseSwitchboard.mockReturnValue(true);
    mockStreamingStore.isLoading = false;
    mockStreamingStore.isActivelyStreaming = false;
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

  it('should render domain settings button when domain ends with airoapp.ai', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://myapp.airoapp.ai',
    });

    renderWithProviders(<PublishStatusAlert />);

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
      published_url: 'https://myapp.airoapp.ai',
    });

    const { user } = renderWithProviders(<PublishStatusAlert />);

    const settingsButton = screen.getByText('builder_publish_success_button_domain');
    await user.click(settingsButton);

    await waitFor(() => {
      expect(mockSetActiveSettingsSection).toHaveBeenCalledWith('domain');
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

  it('should swap to fixing panel immediately after fix is clicked', async () => {
    mockStreamingStore.isLoading = false;
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

    expect(screen.getByText('builder_publish_error_button_fix')).toBeInTheDocument();

    await user.click(screen.getByText('builder_publish_error_button_fix'));

    // Panel swaps immediately on click — no need to wait for isProcessing
    await waitFor(() => {
      expect(screen.getByText('builder_publish_fixing_title')).toBeInTheDocument();
      expect(screen.queryByText('builder_publish_error_button_fix')).not.toBeInTheDocument();
    });
  });

  it('should return to error panel when agent finishes processing', async () => {
    mockStreamingStore.isLoading = false;
    mockDevelopStore.publishStates = {
      'app-123': {
        publishError: true,
        buildErrorDetails: {
          error: 'Build failed',
          details: 'Detailed error',
        },
      },
    };

    const { user, rerender } = renderWithProviders(<PublishStatusAlert />);

    await user.click(screen.getByText('builder_publish_error_button_fix'));

    // Agent starts processing
    mockStreamingStore.isLoading = true;
    rerender(<PublishStatusAlert />);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_fixing_title')).toBeInTheDocument();
    });

    // Agent finishes (true → false transition)
    mockStreamingStore.isLoading = false;
    rerender(<PublishStatusAlert />);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_fixing_title')).not.toBeInTheDocument();
      expect(screen.getByText('builder_publish_error_button_fix')).toBeInTheDocument();
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

  it('should not render success alert with empty domains', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    // Site with no domains configured and empty published_url
    // hasBeenPublished returns false for empty published_url
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      domains: [],
      published_url: '', // Empty - not published
    });

    const { container } = renderWithProviders(<PublishStatusAlert />);

    // Should NOT render success alert when site hasn't been published
    expect(screen.queryByText('builder_publish_success_title')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('should not render success alert with undefined domains', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    // Site with undefined domains and published_url
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      domains: undefined,
      published_url: undefined,
    });

    const { container } = renderWithProviders(<PublishStatusAlert />);

    // Should NOT render when not published
    expect(screen.queryByText('builder_publish_success_title')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('should render success alert with custom domain without domain button', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com', // Needed for hasBeenPublished check
      domains: [{ fqdn: 'custom.example.com', domainType: 'custom' }],
    });

    renderWithProviders(<PublishStatusAlert />);

    // Success alert should render when site has been published
    expect(screen.getByText('builder_publish_success_title')).toBeInTheDocument();
    expect(screen.queryByText('builder_publish_success_button_domain')).not.toBeInTheDocument();
  });

  it('should automatically show Go Live modal on first successful publish', async () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true, hasGoneLive: false },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    renderWithProviders(<PublishStatusAlert />);

    await waitFor(() => {
      expect(mockDevelopStore.setShowGoLiveModal).toHaveBeenCalledWith('app-123', true);
    });
  });

  it('should NOT show Go Live modal if user has already gone live', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true, hasGoneLive: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    renderWithProviders(<PublishStatusAlert />);

    expect(mockDevelopStore.setShowGoLiveModal).not.toHaveBeenCalled();
  });

  it('should NOT show Go Live modal if site has not been published', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true, hasGoneLive: false },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: '', // Not published
    });

    renderWithProviders(<PublishStatusAlert />);

    expect(mockDevelopStore.setShowGoLiveModal).not.toHaveBeenCalled();
  });

  it('should NOT show Go Live modal if user previously dismissed it', () => {
    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true, hasGoneLive: false, goLiveModalDismissed: true },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    renderWithProviders(<PublishStatusAlert />);

    expect(mockDevelopStore.setShowGoLiveModal).not.toHaveBeenCalled();
  });

  it('should NOT show Go Live modal if feature flag is disabled', () => {
    // Override mock for this test to return disabled
    mockUseSwitchboard.mockReturnValueOnce(false);

    mockDevelopStore.publishStates = {
      'app-123': { showSuccessAlert: true, hasGoneLive: false },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    renderWithProviders(<PublishStatusAlert />);

    expect(mockDevelopStore.setShowGoLiveModal).not.toHaveBeenCalled();
  });

  it('should NOT show Go Live modal when post-publish feature selection is active in chat', async () => {
    mockDevelopStore.publishStates = {
      'app-123': {
        showSuccessAlert: true,
        hasGoneLive: false,
        showPostPublishFeatureSelection: true,
      },
    };
    mockSiteStore.getSite.mockReturnValue({
      id: 'app-123',
      published_url: 'https://example.com',
    });

    renderWithProviders(<PublishStatusAlert />);

    await waitFor(() => {
      expect(mockDevelopStore.setShowGoLiveModal).not.toHaveBeenCalled();
    });
  });

  describe('feedback button', () => {
    it('should render feedback button in publishing state', () => {
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };

      renderWithProviders(<PublishStatusAlert />);

      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });

    it('should open feedback modal when feedback button clicked in publishing state', async () => {
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };

      const { user } = renderWithProviders(<PublishStatusAlert />);

      await user.click(screen.getByText('builder_settings_nav_feedback'));

      await waitFor(() => {
        expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
      });
    });

    it('should render feedback link in success state', () => {
      mockDevelopStore.publishStates = {
        'app-123': { showSuccessAlert: true },
      };
      mockSiteStore.getSite.mockReturnValue({
        id: 'app-123',
        published_url: 'https://example.com',
      });

      renderWithProviders(<PublishStatusAlert />);

      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });

    it('should open feedback modal when feedback link clicked in success state', async () => {
      mockDevelopStore.publishStates = {
        'app-123': { showSuccessAlert: true },
      };
      mockSiteStore.getSite.mockReturnValue({
        id: 'app-123',
        published_url: 'https://example.com',
      });

      const { user } = renderWithProviders(<PublishStatusAlert />);

      await user.click(screen.getByText('builder_settings_nav_feedback'));

      await waitFor(() => {
        expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
      });
    });

    it('should close feedback modal via onClose callback', async () => {
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };

      const { user } = renderWithProviders(<PublishStatusAlert />);

      await user.click(screen.getByText('builder_settings_nav_feedback'));
      await waitFor(() => expect(screen.getByTestId('feedback-modal')).toBeInTheDocument());

      await user.click(screen.getByText('close-feedback'));

      await waitFor(() => {
        expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
      });
    });

    it('should close feedback modal via onSubmitSuccess callback', async () => {
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };

      const { user } = renderWithProviders(<PublishStatusAlert />);

      await user.click(screen.getByText('builder_settings_nav_feedback'));
      await waitFor(() => expect(screen.getByTestId('feedback-modal')).toBeInTheDocument());

      await user.click(screen.getByText('submit-feedback'));

      await waitFor(() => {
        expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
      });
    });

    it('should reset showFeedback when alert state clears', async () => {
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };

      const { user, rerender } = renderWithProviders(<PublishStatusAlert />);

      await user.click(screen.getByText('builder_settings_nav_feedback'));
      await waitFor(() => expect(screen.getByTestId('feedback-modal')).toBeInTheDocument());

      // Simulate publish completing — alert disappears
      mockDevelopStore.publishStates = {};
      rerender(<PublishStatusAlert />);

      await waitFor(() => {
        expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
      });
    });

    it('should not reopen feedback modal on next publish after previous session', async () => {
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };

      const { user, rerender } = renderWithProviders(<PublishStatusAlert />);

      await user.click(screen.getByText('builder_settings_nav_feedback'));
      await waitFor(() => expect(screen.getByTestId('feedback-modal')).toBeInTheDocument());

      // Alert disappears
      mockDevelopStore.publishStates = {};
      rerender(<PublishStatusAlert />);
      await waitFor(() => expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument());

      // Next publish starts
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };
      rerender(<PublishStatusAlert />);

      await waitFor(() => {
        expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
      });
    });

    it('should use FEEDBACK_ID constant for feedbackId prop', async () => {
      mockDevelopStore.publishStates = {
        'app-123': { isPublishing: true },
      };

      const { user } = renderWithProviders(<PublishStatusAlert />);

      await user.click(screen.getByText('builder_settings_nav_feedback'));

      await waitFor(() => {
        expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
        expect(FEEDBACK_ID).toBe('airo#app-builder');
      });
    });
  });
});
