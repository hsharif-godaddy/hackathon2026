/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@ux/modal', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      {title && <h2>{title}</h2>}
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@ux/spinner', () => ({
  default: () => <div data-testid="spinner" />,
}));

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    h3: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  },
}));

vi.mock('@ux/button', () => ({
  default: ({ text, onClick, type, ...props }: any) => (
    <button type={type || 'button'} onClick={onClick} {...props}>{text}</button>
  ),
}));

vi.mock('@ux/checkbox', () => ({
  default: ({ label, ...props }: any) => <input type="checkbox" aria-label={label} {...props} />,
}));

vi.mock('@ux/chip', () => ({
  default: ({ label, selected, onSelect }: any) => (
    <button type="button" role="option" aria-selected={selected} onClick={onSelect}>{label}</button>
  ),
}));

vi.mock('@ux/text-input', () => ({
  default: ({ label, ...props }: any) => <textarea aria-label={label} {...props} />,
}));

vi.mock('@ux/box', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true, isLoading: false, error: null })),
}));

vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>();
  return {
    ...actual,
    FormattedMessage: ({ id, values }: { id: string; values?: Record<string, React.ReactNode> }) => (
      <span>{id}{values && Object.values(values).map((v, i) => <React.Fragment key={i}>{v}</React.Fragment>)}</span>
    ),
  };
});

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(() => null),
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/is-local-dev', () => ({
  isLocalDev: vi.fn(() => true),
}));

vi.mock('./utils', () => ({
  getMockFeedbackConfig: vi.fn(() => ({
    pk: 'airo#app-builder',
    fields: [],
  })),
  getBaseUrl: vi.fn(() => 'https://example.com/'),
  getFullStorySessionUrl: vi.fn(() => Promise.resolve(null)),
  FEEDBACK_ID: 'airo#app-builder',
  SUPPORT_FEEDBACK_ID: 'airo#app-builder-support',
  BUG_REPORT_FEEDBACK_ID: 'airo#app-builder-bug',
  SUPPORT_TOPICS: [
    { key: 'Domain or DNS', i18nKey: 'builder_feedback_support_topic_domain' },
    { key: 'Publishing my site', i18nKey: 'builder_feedback_support_topic_publishing' },
    { key: 'Billing or credits', i18nKey: 'builder_feedback_support_topic_billing' },
    { key: 'Account or login', i18nKey: 'builder_feedback_support_topic_account' },
    { key: 'Plan or upgrade', i18nKey: 'builder_feedback_support_topic_plan' },
    { key: 'Something else', i18nKey: 'builder_feedback_support_topic_other' },
  ],
  ISSUE_TOPICS: [
    { key: 'Editor or canvas', i18nKey: 'builder_feedback_issue_topic_editor' },
    { key: 'AI assistant', i18nKey: 'builder_feedback_issue_topic_ai' },
    { key: 'Publishing or preview', i18nKey: 'builder_feedback_issue_topic_publishing' },
    { key: 'Credits or limits', i18nKey: 'builder_feedback_issue_topic_credits' },
    { key: 'Something else', i18nKey: 'builder_feedback_issue_topic_other' },
  ],
  FEEDBACK_TOPICS: [
    { key: 'Editor & design', i18nKey: 'builder_feedback_share_topic_editor' },
    { key: 'AI assistant', i18nKey: 'builder_feedback_share_topic_ai' },
    { key: 'Publishing & domains', i18nKey: 'builder_feedback_share_topic_publishing' },
    { key: 'Credits & pricing', i18nKey: 'builder_feedback_share_topic_credits' },
    { key: 'Integrations', i18nKey: 'builder_feedback_share_topic_integrations' },
    { key: 'Overall experience', i18nKey: 'builder_feedback_share_topic_overall' },
  ],
}));

vi.mock('@/lib/slack-webhook', () => ({
  formatSlackBlockMessage: vi.fn(() => ({})),
}));

vi.mock('@/utils/credits', () => ({
  getEffectiveCreditsSpent: vi.fn((spent, max) => Math.min(spent || 0, max || 0)),
}));

vi.mock('./submitFeedback', () => ({
  fetchDiagnosticContext: vi.fn(() => Promise.resolve({
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    isInternalUser: false,
    isImpersonating: false,
  })),
  sendFeedbackToSlack: vi.fn(() => Promise.resolve()),
  saveToCompanionHub: vi.fn(() => Promise.resolve()),
}));

vi.mock('./slackBuilders', () => ({
  buildSupportRequestBlocks: vi.fn(() => ({ title: 'test' })),
  buildBugReportBlocks: vi.fn(() => ({ title: 'test' })),
  buildFeedbackBlocks: vi.fn(() => ({ title: 'test' })),
}));

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { Feedback } from './Feedback';
import { buildBugReportBlocks, buildFeedbackBlocks, buildSupportRequestBlocks } from './slackBuilders';
import { fetchDiagnosticContext, saveToCompanionHub, sendFeedbackToSlack } from './submitFeedback';

const defaultProps = {
  feedbackId: 'airo#app-builder',
  onClose: vi.fn(),
};

function mockAuth(authType: string | undefined, shopperId = '12345678') {
  vi.mocked(useAuthContext).mockReturnValue({
    authState: authType ? ({ authType } as any) : null,
    isAuthenticated: true,
    isLoading: false,
    needsReauth: false,
    config: null,
    gasketConfig: null,
    configLoading: false,
    configError: null,
    getUserEmail: vi.fn(),
    getUserInfo: vi.fn(() => ({ customerId: 'cust-123', shopperId })),
    handleSignIn: vi.fn(),
    handleSignOut: vi.fn(),
    isAuthDisabled: false,
    authType: 'jwt',
    isMockAuth: false,
    mockAuth: null,
  });
}

describe('Feedback', function feedbackTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ success: true }),
    } as Response));
  });

  describe('category selection screen', function categoryTests() {
    it('should render the modal with category selection', async function renderModal() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.getByRole('dialog', { name: 'builder_feedback_modal_title' })).toBeInTheDocument();
    });

    it('should render all three category cards', async function renderCategories() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_support')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_category_issue')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_category_share')).toBeInTheDocument();
      });
    });

    it('should render the support link in footer', async function renderSupportLink() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        const link = screen.getByRole('link', { name: 'builder_feedback_category_contact_link' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://www.godaddy.com/help/contact-us');
      });
    });

    it('should navigate to support step when support card is clicked', async function navigateSupport() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_support')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_category_support'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_support_description')).toBeInTheDocument();
      });
    });

    it('should navigate to issue step when issue card is clicked', async function navigateIssue() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_issue')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_category_issue'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_issue_topics_label')).toBeInTheDocument();
      });
    });

    it('should navigate to feedback step when feedback card is clicked', async function navigateFeedback() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_share')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_category_share'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_comment_label')).toBeInTheDocument();
      });
    });
  });

  describe('back navigation', function backTests() {
    it('should return to category selection when Back is clicked on support step', async function backFromSupport() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_support')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_category_support'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_support_description')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_back'));

      await waitFor(() => {
        expect(screen.getByRole('dialog', { name: 'builder_feedback_modal_title' })).toBeInTheDocument();
      });
    });

    it('should return to category selection when Back is clicked on issue step', async function backFromIssue() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_issue')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_category_issue'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_issue_topics_label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_back'));

      await waitFor(() => {
        expect(screen.getByRole('dialog', { name: 'builder_feedback_modal_title' })).toBeInTheDocument();
      });
    });
  });

  describe('CRM skip / impersonation session (e2s auth)', function e2sTests() {
    it('should skip to bug report step directly', async function skipToIssue() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Should show issue form directly, not category selection
      expect(screen.getByText('builder_feedback_issue_topics_label')).toBeInTheDocument();
      expect(screen.queryByText('builder_feedback_category_support')).toBeNull();
    });

    it('should not show support or feedback categories', async function noOtherCategories() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_feedback_category_support')).toBeNull();
      expect(screen.queryByText('builder_feedback_category_share')).toBeNull();
    });

    it('should close modal when Back is clicked (no category step)', async function backClosesModal() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_issue_topics_label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_back'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should allow submitting a bug report', async function submitBugReport() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_issue_submit')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_issue_topic_editor'));
      fireEvent.change(
        screen.getByPlaceholderText('builder_feedback_issue_description_placeholder'),
        { target: { value: 'Preview is broken' } },
      );

      fireEvent.click(screen.getByText('builder_feedback_issue_submit'));

      await waitFor(() => {
        expect(fetchDiagnosticContext).toHaveBeenCalled();
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });
    });
  });

  describe('e2s2s impersonation session', function e2s2sTests() {
    it('should skip to bug report step directly', async function skipToIssue() {
      mockAuth('e2s2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.getByText('builder_feedback_issue_topics_label')).toBeInTheDocument();
    });
  });

  describe('support form submission', function supportSubmitTests() {
    async function navigateToSupport() {
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_support')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('builder_feedback_category_support'));
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_support_submit')).toBeInTheDocument();
      });
    }

    it('should show validation errors when submitting without required fields', async function supportValidation() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToSupport();

      fireEvent.click(screen.getByText('builder_feedback_support_submit'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_support_topics_error')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_support_description_error')).toBeInTheDocument();
      });

      expect(sendFeedbackToSlack).not.toHaveBeenCalled();
    });

    it('should successfully submit a support request', async function supportSuccess() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToSupport();

      fireEvent.click(screen.getByText('builder_feedback_support_topic_domain'));
      fireEvent.change(
        screen.getByPlaceholderText('builder_feedback_support_description_placeholder'),
        { target: { value: 'My domain is not resolving' } },
      );

      fireEvent.click(screen.getByText('builder_feedback_support_submit'));

      await waitFor(() => {
        expect(fetchDiagnosticContext).toHaveBeenCalled();
        expect(buildSupportRequestBlocks).toHaveBeenCalledWith(
          expect.objectContaining({ topics: ['Domain or DNS'], description: 'My domain is not resolving' }),
          undefined,
          expect.objectContaining({ isInternalUser: false }),
        );
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });
    });
  });

  describe('issue form submission', function issueSubmitTests() {
    async function navigateToIssue() {
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_issue')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('builder_feedback_category_issue'));
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_issue_submit')).toBeInTheDocument();
      });
    }

    it('should show validation errors when submitting without required fields', async function issueValidation() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToIssue();

      fireEvent.click(screen.getByText('builder_feedback_issue_submit'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_issue_topics_error')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_issue_description_error')).toBeInTheDocument();
      });

      expect(sendFeedbackToSlack).not.toHaveBeenCalled();
    });

    it('should successfully submit a bug report', async function issueSuccess() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToIssue();

      fireEvent.click(screen.getByText('builder_feedback_issue_topic_ai'));
      fireEvent.change(
        screen.getByPlaceholderText('builder_feedback_issue_description_placeholder'),
        { target: { value: 'The assistant stopped responding' } },
      );

      fireEvent.click(screen.getByText('builder_feedback_issue_submit'));

      await waitFor(() => {
        expect(fetchDiagnosticContext).toHaveBeenCalled();
        expect(buildBugReportBlocks).toHaveBeenCalledWith(
          expect.objectContaining({
            topics: ['AI assistant'],
            description: 'The assistant stopped responding',
            followUp: false,
          }),
          undefined,
          expect.objectContaining({ isInternalUser: false }),
        );
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });
    });
  });

  describe('feedback form submission', function feedbackSubmitTests() {
    async function navigateToFeedback() {
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_share')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('builder_feedback_category_share'));
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_submit')).toBeInTheDocument();
      });
    }

    it('should show rating validation error when submitting without a score', async function feedbackRatingValidation() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_rating_error')).toBeInTheDocument();
      });

      expect(sendFeedbackToSlack).not.toHaveBeenCalled();
    });

    it('should successfully submit feedback with rating', async function feedbackSuccess() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      // Select NPS rating of 5
      fireEvent.click(screen.getByText('5'));
      // Optionally select a topic
      fireEvent.click(screen.getByText('builder_feedback_share_topic_ai'));

      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(fetchDiagnosticContext).toHaveBeenCalled();
        expect(buildFeedbackBlocks).toHaveBeenCalledWith(
          expect.objectContaining({ rating: 5, topics: ['AI assistant'] }),
          undefined,
          expect.objectContaining({ isInternalUser: false }),
        );
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });
    });

    it('should allow submitting feedback without rating when hideRating is true (internal user)', async function feedbackNoRatingInternal() {
      mockAuth('basic', 'abc'); // 3-char shopperId → internal user
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      // Rating section should not be visible
      expect(screen.queryByText('builder_feedback_share_rating_low')).toBeNull();
      expect(screen.queryByText('builder_feedback_share_rating_error')).toBeNull();

      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(fetchDiagnosticContext).toHaveBeenCalled();
        expect(buildFeedbackBlocks).toHaveBeenCalledWith(
          expect.objectContaining({ rating: null }),
          undefined,
          expect.objectContaining({ isInternalUser: false }),
        );
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });
    });
  });

  describe('submit failure handling', function failureTests() {
    it('should show error message when submission fails', async function submitFailureShowsError() {
      vi.mocked(sendFeedbackToSlack).mockRejectedValueOnce(new Error('Slack webhook failed: 500'));
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      // Navigate to support
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_support')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('builder_feedback_category_support'));
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_support_submit')).toBeInTheDocument();
      });

      // Fill required fields
      fireEvent.click(screen.getByText('builder_feedback_support_topic_domain'));
      fireEvent.change(
        screen.getByPlaceholderText('builder_feedback_support_description_placeholder'),
        { target: { value: 'Help needed' } },
      );

      fireEvent.click(screen.getByText('builder_feedback_support_submit'));

      // Should show error message and keep submit button enabled
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_submit_error')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_support_submit')).toBeInTheDocument();
      });

      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it('should not show success state when issue submission fails', async function issueFailure() {
      vi.mocked(sendFeedbackToSlack).mockRejectedValueOnce(new Error('Slack webhook failed: 500'));
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      // Navigate to issue
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_issue')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('builder_feedback_category_issue'));
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_issue_submit')).toBeInTheDocument();
      });

      // Fill required fields
      fireEvent.click(screen.getByText('builder_feedback_issue_topic_editor'));
      fireEvent.change(
        screen.getByPlaceholderText('builder_feedback_issue_description_placeholder'),
        { target: { value: 'Something broke' } },
      );

      fireEvent.click(screen.getByText('builder_feedback_issue_submit'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_submit_error')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_issue_submit')).toBeInTheDocument();
      });
    });
  });

  describe('switchboard gate', function switchboardTests() {
    it('should render legacy feedback when flag is off', async function legacyFallback() {
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Legacy flow shows the old title key and description, not the multi-step categories
      expect(screen.queryByText('builder_feedback_category_support')).toBeNull();
      expect(screen.queryByText('builder_feedback_category_issue')).toBeNull();
    });

    it('should render multi-step feedback when flag is on', async function multiStepEnabled() {
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_support')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_category_issue')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_category_share')).toBeInTheDocument();
      });
    });
  });
});
