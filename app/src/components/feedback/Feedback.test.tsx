/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

const mockLogImpressionEvent = vi.fn(function (_eid: string) { return vi.fn(); });
const mockLogClickEvent = vi.fn(function (_eid: string, _customProperties?: Record<string, unknown>) { return vi.fn(); });
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
  vi.fn(function () { return {
    switchboard: {
      'aab_progress_tracker': { cohortId: 'control' },
    },
  }; }),
);

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => mockUseGasketData(),
}));

// Keep `airo-builder-feedback-multistep` ON so the FeedbackMultiStep component
// renders. The feedback flow no longer reads any other Switchboard flag, so a
// blanket true is sufficient; the switchboard-gate test overrides this to false.
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
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

// Default: no app id and no site in store → storeToS3 gets app_publish_flag false and
// publish_url null. Lake "published" assertions need overrides (see storeToS3LakePublishedSite).
const feedbackSitesStoreApi = vi.hoisted(() => ({
  getSite: vi.fn(function (_id: string) { return undefined as unknown; }),
}));

const feedbackSiteStoreApi = vi.hoisted(() => ({
  getSite: vi.fn(function (_id: string) { return null as unknown; }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(function (selector: (s: any) => unknown) { return selector({ currentAppId: null }); }),
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: Object.assign(
    vi.fn(function (selector: (s: typeof feedbackSitesStoreApi) => unknown) { return selector(feedbackSitesStoreApi); }),
    { getState: () => feedbackSitesStoreApi },
  ),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: Object.assign(
    vi.fn(function (selector: (s: typeof feedbackSiteStoreApi) => unknown) { return selector(feedbackSiteStoreApi); }),
    { getState: () => feedbackSiteStoreApi },
  ),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/is-local-dev', () => ({
  isLocalDev: vi.fn(function () { return true; }),
}));

vi.mock('./utils', () => ({
  getAppIdFromUrl: vi.fn(function () { return null; }),
  getBaseUrl: vi.fn(function () { return 'https://example.com/'; }),
  getFullStorySessionUrl: vi.fn(function () { return Promise.resolve(null); }),
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

vi.mock('@/utils/credits', () => ({
  getEffectiveCreditsSpent: vi.fn(function (spent, max) { return Math.min(spent || 0, max || 0); }),
}));

vi.mock('./submitFeedback', () => ({
  fetchDiagnosticContext: vi.fn(function () { return Promise.resolve({
    currentAppId: null,
    previewUrl: undefined,
    publishedUrl: undefined,
    fullStoryUrl: null,
    subscriptionInfo: '',
    planType: null,
    subscriptionId: null,
    subscriptionStatus: null,
    totalCredits: null,
    availableCredits: null,
    isInternalUser: false,
    isImpersonating: false,
  }); }),
  saveToCompanionHub: vi.fn(function () { return Promise.resolve(); }),
  storeToS3: vi.fn(),
}));

import { buildExperimentsLineFromSwitchboard } from '@/components/feedback/experimentsLine';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { EXPERIMENT_IDS } from '@/config/experiments';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { renderWithProviders } from '@/tests/test-utils';
import { isLocalDev } from '@/utils/is-local-dev';
import { Feedback } from './Feedback';
import { fetchDiagnosticContext, saveToCompanionHub, storeToS3 } from './submitFeedback';
import { getAppIdFromUrl } from './utils';

const defaultProps = {
  feedbackId: 'airo#app-builder',
  onClose: vi.fn(),
};

const EXPECTED_EXPERIMENTS_LINE_DEFAULT = buildExperimentsLineFromSwitchboard({
    [EXPERIMENT_IDS.aabProgressTracker]: { cohortId: 'control' },
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
    getUserInfo: vi.fn(function () { return { customerId: 'cust-123', shopperId, accountName: '', email: '' }; }),
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
    // storeToS3 is the fanout trigger (parquet write). Default it to success so
    // submit handlers reach `outcome: 'success'`; failure tests override with
    // mockResolvedValueOnce({ ok: false }). mockReset first to drop any leftover
    // once-queued value from a prior test.
    vi.mocked(storeToS3).mockReset();
    vi.mocked(storeToS3).mockResolvedValue({ ok: true, status: 200 });
    mockUseGasketData.mockReturnValue({
      switchboard: {
        [EXPERIMENT_IDS.aabProgressTracker]: { cohortId: 'control' },
      },
    });
    global.fetch = vi.fn(function () { return Promise.resolve({
      ok: true,
      json: async () => ({ success: true }),
    } as Response); });
    vi.mocked(useDevelopPageStore).mockImplementation(function (selector) { return selector({ currentAppId: null } as any); });
    feedbackSitesStoreApi.getSite.mockReset();
    feedbackSitesStoreApi.getSite.mockImplementation(function () { return undefined; });
    feedbackSiteStoreApi.getSite.mockReset();
    feedbackSiteStoreApi.getSite.mockImplementation(function () { return null; });
    vi.mocked(getAppIdFromUrl).mockReturnValue(null);
    document.getElementById('feedback-modal-portal')?.remove();
  });

  describe('category selection screen', function categoryTests() {
    it('should mount the feedback modal in a dedicated viewport portal', async function mountPortal() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(document.getElementById('feedback-modal-portal')).toBeInTheDocument();
    });

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
    it('should show the impersonation message instead of any feedback form', async function showMessage() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.getByText('builder_feedback_impersonation_message')).toBeInTheDocument();
    });

    it('should not render any feedback form controls', async function noFormControls() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Category selection, issue/support/share forms — none should render.
      expect(screen.queryByText('builder_feedback_category_support')).toBeNull();
      expect(screen.queryByText('builder_feedback_category_share')).toBeNull();
      expect(screen.queryByText('builder_feedback_category_issue')).toBeNull();
      expect(screen.queryByText('builder_feedback_issue_topics_label')).toBeNull();
      expect(screen.queryByText('builder_feedback_support_description')).toBeNull();
      expect(screen.queryByText('builder_feedback_share_comment_label')).toBeNull();
    });

    it('should not submit anything downstream', async function noSubmit() {
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_impersonation_message')).toBeInTheDocument();
      });

      expect(fetchDiagnosticContext).not.toHaveBeenCalled();
      expect(saveToCompanionHub).not.toHaveBeenCalled();
      expect(storeToS3).not.toHaveBeenCalled();
    });
  });

  describe('e2s2s impersonation session', function e2s2sTests() {
    it('should show the impersonation message instead of any feedback form', async function showMessage() {
      mockAuth('e2s2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.getByText('builder_feedback_impersonation_message')).toBeInTheDocument();
      expect(screen.queryByText('builder_feedback_issue_topics_label')).toBeNull();
    });

    // The e2s and e2s2s describes must be symmetric: both strings pass through
    // isEmployeeAuthType, and a regression that corrupts only the e2s2s
    // comparison would go undetected if only one arm asserted "no form" + "no submit".
    it('should not render any feedback form controls', async function noFormControls() {
      mockAuth('e2s2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_feedback_category_support')).toBeNull();
      expect(screen.queryByText('builder_feedback_category_share')).toBeNull();
      expect(screen.queryByText('builder_feedback_category_issue')).toBeNull();
      expect(screen.queryByText('builder_feedback_issue_topics_label')).toBeNull();
      expect(screen.queryByText('builder_feedback_support_description')).toBeNull();
      expect(screen.queryByText('builder_feedback_share_comment_label')).toBeNull();
    });

    it('should not submit anything downstream', async function noSubmit() {
      mockAuth('e2s2s');
      renderWithProviders(<Feedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('builder_feedback_impersonation_message')).toBeInTheDocument();
      });

      expect(fetchDiagnosticContext).not.toHaveBeenCalled();
      expect(saveToCompanionHub).not.toHaveBeenCalled();
      expect(storeToS3).not.toHaveBeenCalled();
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

      // Validation blocks the submit → no parquet/fanout write.
      expect(storeToS3).not.toHaveBeenCalled();
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
        // UI owns the companion-hub write + the parquet write; the fanout
        // Lambda (triggered by the parquet) owns Slack + CRM.
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalled();
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

      // Validation blocks the submit → no parquet/fanout write.
      expect(storeToS3).not.toHaveBeenCalled();
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
        // UI owns the companion-hub + parquet writes; the Lambda owns Slack + CRM.
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalled();
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

      // Validation blocks the submit → no parquet/fanout write.
      expect(storeToS3).not.toHaveBeenCalled();
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
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          app_id: null,
          rating: 5,
          consent_flag: expect.any(Boolean),
          plan_type_name: null,
          subscription_id: null,
          subscription_status: null,
          total_credit_cnt: null,
          available_credit_cnt: null,
          feedback_topic_list: '["AI assistant"]',
          feedback_origin_name: null,
          app_publish_flag: false,
          publish_url: null,
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
        expect(storeToS3).toHaveBeenCalled();
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
        expect(storeToS3).toHaveBeenCalled();
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
        expect(storeToS3).toHaveBeenCalled();
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
        expect(storeToS3).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          rating: null,
          consent_flag: expect.any(Boolean),
          plan_type_name: null,
          subscription_id: null,
          subscription_status: null,
          total_credit_cnt: null,
          available_credit_cnt: null,
          feedback_topic_list: null,
          feedback_origin_name: null,
          app_publish_flag: false,
          publish_url: null,
        }));
      });
    });

    it('should pass non-null subscription fields from ctx to storeToS3', async function subscriptionFieldsPassThrough() {
      vi.mocked(fetchDiagnosticContext).mockResolvedValueOnce({
        currentAppId: 'app-abc',
        previewUrl: undefined,
        publishedUrl: undefined,
        fullStoryUrl: null,
        subscriptionInfo: 'Ultimate - 200/500',
        planType: 'ultimate' as any,
        subscriptionId: 'sub-xyz-123',
        subscriptionStatus: 'active' as any,
        totalCredits: 500,
        availableCredits: 300,
        isInternalUser: false,
        isImpersonating: false,
        shopperId: undefined,
      });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();

      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          plan_type_name: 'ultimate',
          subscription_id: 'sub-xyz-123',
          subscription_status: 'active',
          total_credit_cnt: 500,
          available_credit_cnt: 300,
          feedback_topic_list: null,
          feedback_origin_name: null,
          app_publish_flag: false,
          publish_url: null,
        }));
      });
    });

    it('should pass lake enrichment fields to storeToS3 when site is published', async function storeToS3LakePublishedSite() {
      vi.mocked(useDevelopPageStore).mockImplementation(function (selector) { return selector({ currentAppId: 'app-published' } as any); });
      feedbackSiteStoreApi.getSite.mockImplementation(function (id: string) { return id === 'app-published'
          ? ({
              published_url: 'https://customer.example/',
              variantsWithLifecycle: [{ variant: 'publish', status: 'active' }],
            } as any)
          : null; });
      feedbackSitesStoreApi.getSite.mockImplementation(function () { return undefined; });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();
      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_topic_editor'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));
      await waitFor(() => {
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          app_id: 'app-published',
          feedback_topic_list: '["Editor & design"]',
          app_publish_flag: true,
          publish_url: 'https://customer.example/',
        }));
      });
    });

    it('should use URL app id for site lookup and storeToS3 when currentAppId is absent', async function storeToS3EffectiveAppIdFromUrl() {
      vi.mocked(useDevelopPageStore).mockImplementation(function (selector) { return selector({ currentAppId: null } as any); });
      vi.mocked(getAppIdFromUrl).mockReturnValue('app-from-url');
      feedbackSiteStoreApi.getSite.mockImplementation(function () { return null; });
      feedbackSitesStoreApi.getSite.mockImplementation(function (id: string) { return id === 'app-from-url'
          ? ({
              published_url: 'https://from-url.example/',
              variantsWithLifecycle: [{ variant: 'publish', status: 'active' }],
            } as any)
          : undefined; });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();
      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));
      await waitFor(() => {
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          app_id: 'app-from-url',
          app_publish_flag: true,
          publish_url: 'https://from-url.example/',
        }));
      });
    });

    it('should pass null app_publish_flag when app id resolves but site is missing', async function storeToS3UnknownPublishState() {
      vi.mocked(useDevelopPageStore).mockImplementation(function (selector) { return selector({ currentAppId: 'not-in-store' } as any); });
      feedbackSiteStoreApi.getSite.mockImplementation(function () { return null; });
      feedbackSitesStoreApi.getSite.mockImplementation(function () { return undefined; });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();
      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));
      await waitFor(() => {
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          app_id: 'not-in-store',
          app_publish_flag: null,
          publish_url: null,
        }));
      });
    });

    it('should not set lake publish fields from published_url alone when lifecycle omits publish', async function storeToS3UrlOnlyWithoutLifecycle() {
      vi.mocked(useDevelopPageStore).mockImplementation(function (selector) { return selector({ currentAppId: 'app-url-only' } as any); });
      feedbackSiteStoreApi.getSite.mockImplementation(function () { return null; });
      feedbackSitesStoreApi.getSite.mockImplementation(function (id: string) { return id === 'app-url-only'
          ? ({ published_url: 'https://customer.example/live/' } as any)
          : undefined; });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} />);
      await navigateToFeedback();
      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));
      await waitFor(() => {
        expect(storeToS3).toHaveBeenCalledWith(expect.objectContaining({
          app_id: 'app-url-only',
          app_publish_flag: false,
          publish_url: null,
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
      vi.mocked(storeToS3).mockResolvedValueOnce({ ok: false, status: 500 });
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
      vi.mocked(storeToS3).mockResolvedValueOnce({ ok: false, status: 500 });
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
      vi.mocked(storeToS3).mockResolvedValueOnce({ ok: false, status: 500 });
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
      // storeToS3 IS the fanout under flag-100% — a failed parquet write
      // (ok:false) is what drives the failure outcome here, so it must have
      // been called.
      expect(storeToS3).toHaveBeenCalled();
    });
  });

  describe('switchboard gate', function switchboardTests() {
    it('renders nothing when flag is disabled', function flagDisabled() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
      mockAuth('basic');
      const { container } = renderWithProviders(<Feedback {...defaultProps} />);
      expect(container).toBeEmptyDOMElement();
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

    it('should still block submission for impersonation even when initialStep is set', async function impersonationOverride() {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      mockAuth('e2s');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Impersonation wins: read-only message, no form of any kind
      expect(screen.getByText('builder_feedback_impersonation_message')).toBeInTheDocument();
      expect(screen.queryByText('builder_feedback_share_comment_label')).toBeNull();
      expect(screen.queryByText('builder_feedback_issue_topics_label')).toBeNull();
    });
  });

  // Regression guard for the companion-hub write. The fanout Lambda owns
  // Slack/CRM/Jira/investigator but does NOT write companion hub (the hub API
  // needs the authenticated browser session only the client holds). When the
  // Lambda extraction shipped, the UI early-returned after storeToS3 and
  // stopped writing companion hub entirely. These tests pin the contract: the
  // UI STILL writes companion hub AND the parquet on every submission, and the
  // hub write is decoupled from fanout success in both directions.
  describe('companion hub write (fanout-only flow)', function companionHubWrite() {
    it('writes companion hub with the per-handler payload shape for NPS feedback', async function fanoutFeedback() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_submit')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalled();
      });

      // Pin the per-handler companion-hub payload shape: the rating maps
      // through RATING_TO_API_VALUE, the consent key is present, and the
      // submission feedbackId + customerId are passed through unchanged.
      expect(saveToCompanionHub).toHaveBeenCalledWith(
        defaultProps.feedbackId,
        expect.objectContaining({
          // RATING_TO_API_VALUE[5] === '5' (see FeedbackMultiStep mapping).
          'rate-overal-experience': '5',
          'customer-consent': expect.any(Boolean),
        }),
        'cust-123',
      );
    });

    it('comment maps to the legacy improvemets-free-text key', async function fanoutFeedbackCommentKey() {
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_submit')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('5'));
      fireEvent.change(
        screen.getByPlaceholderText('builder_feedback_share_comment_placeholder'),
        { target: { value: 'make undo faster' } },
      );
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(saveToCompanionHub).toHaveBeenCalled();
      });
      // The intentional DB typo key must survive hoisting.
      expect(saveToCompanionHub).toHaveBeenCalledWith(
        defaultProps.feedbackId,
        expect.objectContaining({ 'improvemets-free-text': 'make undo faster' }),
        'cust-123',
      );
    });

    // Load-bearing: the hub write must NOT be coupled to fanout success. If a
    // future refactor moves it back below/inside the fanout branch, this fails.
    it('still writes companion hub and reports failure when the fanout (storeToS3) fails', async function hubSurvivesFanoutFailure() {
      vi.mocked(storeToS3).mockResolvedValueOnce({ ok: false, status: 500 });
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_submit')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        // Hub write ran (it is above the fanout branch) even though fanout fails.
        expect(saveToCompanionHub).toHaveBeenCalled();
        expect(storeToS3).toHaveBeenCalled();
      });
      // Fanout failure → user-visible failure, NOT a misleading success.
      expect(mockLogImpressionEvent).not.toHaveBeenCalledWith('feedback.share.submitSuccess');
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ outcome: 'failed', companionHubOk: true }),
      );
    });

    // Load-bearing: a hub failure must NOT block the fanout. The hub call is
    // try/catch warn-not-throw, so storeToS3 still runs and the submit succeeds.
    it('still fires the fanout and reports success when the companion-hub write fails', async function hubFailureDoesNotBlockFanout() {
      vi.mocked(saveToCompanionHub).mockRejectedValueOnce(new Error('companion hub 500'));
      mockAuth('basic');
      renderWithProviders(<Feedback {...defaultProps} initialStep="feedback" />);
      await waitFor(() => {
        expect(screen.getByText('builder_feedback_share_submit')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('5'));
      fireEvent.click(screen.getByText('builder_feedback_share_submit'));

      await waitFor(() => {
        expect(saveToCompanionHub).toHaveBeenCalled();
        // Fanout still fired despite the hub throwing.
        expect(storeToS3).toHaveBeenCalled();
      });
      // Submit still succeeds, but the partial hub failure is visible in telemetry.
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'feedback.share.submit',
        expect.objectContaining({ outcome: 'success', companionHubOk: false }),
      );
    });
  });
});
