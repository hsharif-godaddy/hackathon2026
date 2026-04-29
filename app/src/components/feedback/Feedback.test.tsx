/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

const mockLogImpressionEvent = vi.fn((_eid: string) => vi.fn());
const mockLogClickEvent = vi.fn((_eid: string, _customProperties?: Record<string, unknown>) => vi.fn());
const mockShipAnalyticsLog = vi.fn();

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

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string) => {
    mockLogImpressionEvent(eid);
    return vi.fn();
  },
  logClickEvent: (eid: string, customProperties?: Record<string, unknown>) => {
    mockLogClickEvent(eid, customProperties);
    return vi.fn();
  },
  generateClickEID: (eid: string) => eid,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (event: string, data: Record<string, unknown>) => mockShipAnalyticsLog(event, data),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockUseGasketData = vi.hoisted(() =>
  vi.fn(() => ({
    switchboard: {
      'aab_recommended_plan_uppdcx': { cohortId: 'control' },
      'airo-app-builder-chat-gauge': { cohortId: 'control' },
    },
  })),
);

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => mockUseGasketData(),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => (true)),
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
  getAppIdFromUrl: vi.fn(() => null),
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
  storeToS3: vi.fn(),
}));

vi.mock('./slackBuilders', () => ({
  buildSupportRequestBlocks: vi.fn(() => ({ title: 'test' })),
  buildBugReportBlocks: vi.fn(() => ({ title: 'test' })),
  buildFeedbackBlocks: vi.fn(() => ({ title: 'test' })),
}));

import { buildExperimentsLineFromSwitchboard } from '@/components/feedback/experimentsLine';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { EXPERIMENT_IDS } from '@/config/experiments';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { logger } from '@/lib/request-context';
import { renderWithProviders } from '@/tests/test-utils';
import { isLocalDev } from '@/utils/is-local-dev';
import { Feedback } from './Feedback';
import { buildBugReportBlocks, buildFeedbackBlocks, buildSupportRequestBlocks } from './slackBuilders';
import { fetchDiagnosticContext, saveToCompanionHub, sendFeedbackToSlack, storeToS3 } from './submitFeedback';

const defaultProps = {
  feedbackId: 'airo#app-builder',
  onClose: vi.fn(),
};

const EXPECTED_EXPERIMENTS_LINE_DEFAULT = buildExperimentsLineFromSwitchboard({
  [EXPERIMENT_IDS.recommendedPlan]: { cohortId: 'control' },
  [EXPERIMENT_IDS.chatGauge]: { cohortId: 'control' },
});

function mockAuth(authType: string | undefined, shopperId = '12345678') {
  vi.mocked(useAuthContext).mockReturnValue({
    authState: authType ? ({ authType } as any) : null,
    isAuthenticated: true,
    isLoading: false,
    config: null,
    gasketConfig: null,
    configLoading: false,
    configError: null,
    getUserEmail: vi.fn(),
    getUserInfo: vi.fn(() => ({ customerId: 'cust-123', shopperId, accountName: '', email: '' })),
    handleSignIn: vi.fn(),
    handleSignOut: vi.fn(),
    authType: 'jwt',
    isMockAuth: false,
    mockAuth: null,
    tokenAuthType: undefined
  });
}

describe('Feedback', function feedbackTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    // vi.clearAllMocks() clears call history but NOT mock implementations — explicitly
    // reset isLocalDev so a production-path test does not leak into following tests.
    vi.mocked(isLocalDev).mockReturnValue(true);
    mockUseGasketData.mockReturnValue({
      switchboard: {
        [EXPERIMENT_IDS.recommendedPlan]: { cohortId: 'control' },
        [EXPERIMENT_IDS.chatGauge]: { cohortId: 'control' },
      },
    });
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
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.category.view');
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
      expect(mockLogClickEvent).toHaveBeenCalledWith('feedback.category.support', undefined);
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.support.view');
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
      expect(mockLogClickEvent).toHaveBeenCalledWith('feedback.category.issue', undefined);
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.issue.view');
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
      expect(mockLogClickEvent).toHaveBeenCalledWith('feedback.category.share', undefined);
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.share.view');
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
        expect(vi.mocked(fetchDiagnosticContext).mock.calls[0][5]).toBe(EXPECTED_EXPERIMENTS_LINE_DEFAULT);
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
        expect(vi.mocked(fetchDiagnosticContext).mock.calls[0][5]).toBe(EXPECTED_EXPERIMENTS_LINE_DEFAULT);
        expect(buildSupportRequestBlocks).toHaveBeenCalledWith(
          expect.objectContaining({ topics: ['Domain or DNS'], description: 'My domain is not resolving' }),
          undefined,
          expect.objectContaining({ isInternalUser: false }),
        );
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(sendFeedbackToSlack).toHaveBeenCalled();
        expect(storeToS3).not.toHaveBeenCalled();
        expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.support.submitSuccess');
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
        expect(vi.mocked(fetchDiagnosticContext).mock.calls[0][5]).toBe(EXPECTED_EXPERIMENTS_LINE_DEFAULT);
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
        expect(storeToS3).not.toHaveBeenCalled();
        expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.issue.submitSuccess');
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
        expect(vi.mocked(fetchDiagnosticContext).mock.calls[0][5]).toBe(EXPECTED_EXPERIMENTS_LINE_DEFAULT);
        expect(buildFeedbackBlocks).toHaveBeenCalledWith(
          expect.objectContaining({ rating: 5, topics: ['AI assistant'] }),
          undefined,
          expect.objectContaining({ isInternalUser: false }),
        );
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(sendFeedbackToSlack).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          app_id: null,
          rating: 5,
          consent_flag: expect.any(Boolean),
        }));
        expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.share.submitSuccess');
      });

      // Rating 5 → satisfied bucket, passed as customProperty on the registered EID
      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ ratingBucket: 'satisfied' }),
      );
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ outcome: 'success', rating: 5, ratingBucket: 'satisfied' }),
      );
    });

    it('should bucket rating 3 as displeased', async function feedbackBucketDispleased() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      fireEvent.click(screen.getByText('3'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ ratingBucket: 'displeased' }),
      );
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ rating: 3, ratingBucket: 'displeased' }),
      );
    });

    it('should bucket rating 4 as neutral', async function feedbackBucketNeutral() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      fireEvent.click(screen.getByText('4'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ ratingBucket: 'neutral' }),
      );
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ rating: 4, ratingBucket: 'neutral' }),
      );
    });

    it('should bucket missing rating as none and omit rating field from analytics', async function feedbackBucketNone() {
      // 3-char shopperId → internal user → hideRating=true → rating stays null
      mockAuth('basic', 'abc');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(sendFeedbackToSlack).toHaveBeenCalled();
      });

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ ratingBucket: 'none' }),
      );
      const [, analyticsData] = mockShipAnalyticsLog.mock.calls.find(
        ([event]) => event === 'feedback.share.submit',
      )!;
      // Critical: absent rating must NOT be encoded as 0 (corrupts ESSP AVG/COUNT queries)
      expect(analyticsData).not.toHaveProperty('rating');
      expect(analyticsData).toMatchObject({ ratingBucket: 'none' });
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
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          rating: null,
          consent_flag: expect.any(Boolean),
        }));
      });
    });

    it('should pass experimentsLine to fetchDiagnosticContext on submit', async function experimentsLinePassedThroughOnSubmit() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(fetchDiagnosticContext).toHaveBeenCalled();
        expect(vi.mocked(fetchDiagnosticContext).mock.calls[0][5]).toBe(EXPECTED_EXPERIMENTS_LINE_DEFAULT);
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

      // Telemetry in the finally block must still fire on failure — guards against
      // future refactors that accidentally convert the finally block into a try block.
      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'feedback.support.submit',
        expect.any(Object),
      );
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.support.submit',
        expect.objectContaining({ outcome: 'failed' }),
      );
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

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'feedback.issue.submit',
        expect.any(Object),
      );
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.issue.submit',
        expect.objectContaining({ outcome: 'failed' }),
      );
    });

    it('should still fire telemetry when share feedback submission fails', async function shareFailureTelemetry() {
      vi.mocked(sendFeedbackToSlack).mockRejectedValueOnce(new Error('Slack webhook failed: 500'));
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_share')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('builder_feedback_category_share'));
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_submit')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('3'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_submit_error')).toBeInTheDocument();
      });

      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ ratingBucket: 'displeased' }),
      );
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ outcome: 'failed', rating: 3, ratingBucket: 'displeased' }),
      );
      // storeToS3 lives inside the try block after sendFeedbackToSlack — a failure
      // must NOT reach it. Guards against a future refactor hoisting storeToS3 into
      // the finally block, which would silently create duplicate S3 records on retry.
      expect(storeToS3).not.toHaveBeenCalled();
    });
  });

  describe('switchboard gate', function switchboardTests() {
    it('should render legacy feedback when flag is off', async function legacyFallback() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
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
      vi.mocked(useSwitchboard).mockReturnValue(true);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_category_support')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_category_issue')).toBeInTheDocument();
        expect(screen.getByText('builder_feedback_category_share')).toBeInTheDocument();
      });
    });

    it('should call storeToS3 on legacy form submit', async function legacyStoreToS3() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(sendFeedbackToSlack).mockResolvedValue(undefined);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_common_submit'));

      await waitFor(() => {
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          app_id: null,
          consent_flag: null,
          rating: null,
        }));
      });
    });

    it('should omit Experiments field from Slack payload when no cohorts are assigned', async function noExperimentsWhenEmpty() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
       
      mockUseGasketData.mockReturnValue({ switchboard: {} } as any);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_common_submit'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/slack-webhook/feedback',
          expect.objectContaining({ method: 'POST' }),
        );
      });

      const slackCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url]: [string]) => url === '/api/slack-webhook/feedback',
      );
      const body = JSON.parse(slackCall[1].body);
      const rightFields: Array<{ label?: string }> = body.blockMessage?.twoColumnSection?.rightFields ?? [];
      expect(rightFields.find(f => f.label === 'Experiments')).toBeUndefined();
    });

    it('should report outcome:failed and skip storeToS3 when legacy Slack webhook errors in local dev', async function legacySlackFailure() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
      // Local-dev path keeps Slack fatal: devs need to see delivery failures loudly,
      // and there is no preceding DB save, so retry carries no duplicate-entry risk.
      vi.mocked(isLocalDev).mockReturnValue(true);
      // Fail ONLY the Slack webhook; other fetches (subscriptions, credits) resolve normally
      global.fetch = vi.fn((url: RequestInfo | URL) => {
        if (typeof url === 'string' && url === '/api/slack-webhook/feedback') {
          return Promise.resolve({ ok: false, status: 500 } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response);
      });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_common_submit'));

      // Without the !response.ok throw, outcome would always be 'success' and
      // storeToS3 would always fire — both would corrupt ESSP + produce duplicate S3 records.
      await waitFor(() => {
        expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
          'feedback.submit',
          expect.objectContaining({ outcome: 'failed' }),
        );
      });
      expect(storeToS3).not.toHaveBeenCalled();
    });

    it('should treat Slack failure as non-fatal in production path (DB save is source of truth)', async function prodSlackFailureNonFatal() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
      // Production path: DB save precedes Slack. If Slack failure re-opened the
      // modal, a retry would duplicate the DB entry. The outcome reported to ESSP
      // must stay 'success' from the user's POV because persistence succeeded.
      vi.mocked(isLocalDev).mockReturnValue(false);
      global.fetch = vi.fn((url: RequestInfo | URL) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        // FeedbackLegacy fetches the config on mount (non-local-dev path)
        if (urlStr.includes('feedback-configs/')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ pk: 'airo#app-builder', fields: [] }),
          } as Response);
        }
        // Slack webhook fails; DB save (feedbacks/) succeeds via default branch
        if (urlStr === '/api/slack-webhook/feedback') {
          return Promise.resolve({ ok: false, status: 500 } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response);
      });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_common_submit'));

      await waitFor(() => {
        expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
          'feedback.submit',
          expect.objectContaining({ outcome: 'success', slackDelivered: false }),
        );
      });
      // storeToS3 still fires (DB save succeeded; Slack is a notification side-effect)
      expect(storeToS3).toHaveBeenCalled();
      // Loki audit trail for Grafana runbooks survives even when shipAnalyticsLog drops
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        'feedback.submit.success',
        expect.objectContaining({ feedbackId: 'airo#app-builder' }),
      );
      // Modal closes (onClose called) since submission succeeded from user's POV
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should report outcome:failed when production DB save fails', async function prodDbSaveFailure() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(isLocalDev).mockReturnValue(false);
      global.fetch = vi.fn((url: RequestInfo | URL) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('feedback-configs/')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ pk: 'airo#app-builder', fields: [] }),
          } as Response);
        }
        // DB save fails — this is the one path where retry is correct (nothing persisted yet).
        if (urlStr.includes('/feedbacks/')) {
          return Promise.resolve({ ok: false, status: 500 } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response);
      });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_common_submit'));

      await waitFor(() => {
        expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
          'feedback.submit',
          expect.objectContaining({ outcome: 'failed' }),
        );
      });
      expect(storeToS3).not.toHaveBeenCalled();
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  describe('initialStep prop (automatic triggers)', function initialStepTests() {
    it('should skip category selection and show feedback form directly', async function skipToFeedback() {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Should show feedback form directly (NPS step)
      expect(screen.getByText('builder_feedback_share_comment_label')).toBeInTheDocument();
      // Should NOT show category selection
      expect(screen.queryByText('builder_feedback_category_support')).toBeNull();
    });

    it('should close modal when Back is clicked (not return to category)', async function backClosesModal() {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_comment_label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_back'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should open support form directly when initialStep="support"', async function skipToSupport() {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="support" />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_support_description')).toBeInTheDocument();
      });

      // Should NOT show category selection
      expect(screen.queryByText('builder_feedback_category_support')).toBeNull();
    });

    it('should close modal on back when initialStep="support"', async function backClosesFromSupport() {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="support" />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_support_description')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('builder_feedback_back'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should still prioritize impersonation over initialStep', async function impersonationOverride() {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Impersonation wins: shows issue step, not feedback
      expect(screen.getByText('builder_feedback_issue_topics_label')).toBeInTheDocument();
      expect(screen.queryByText('builder_feedback_share_comment_label')).toBeNull();
    });
  });
});
