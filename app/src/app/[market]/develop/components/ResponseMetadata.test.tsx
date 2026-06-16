/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG } from '@/app/[market]/develop/components/invocation-feedback/constants';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { renderWithProviders } from '@/tests/test-utils';
import * as instrumentation from '@/utils/instrumentation';
import ResponseMetadata from './ResponseMetadata';

const mockShowThanksBanner = vi.fn();
const mockSubmitFeedback = vi.fn();
const mockPatchMessageFeedbackMetadata = vi.fn();
const mockMergeMessageMetadata = vi.fn();

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
  getSwitchboardFlag: vi.fn(function () { return true; }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id: string) { return id; }),
  logClickEvent: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('@/hooks/websocket/useWebSocketHelpers', () => ({
  getConversationIdFromCookie: () => 'conv-test-1',
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ baseUrl: 'http://agents.test' }),
  },
}));

vi.mock('@/lib/feedback-client', () => ({
  submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
}));

vi.mock('@/lib/message-metadata-client', async function messageMetadataClient() {
  const actual = await vi.importActual<typeof import('@/lib/message-metadata-client')>(
    '@/lib/message-metadata-client'
  );
  return {
    ...actual,
    patchMessageFeedbackMetadata: (...args: unknown[]) => mockPatchMessageFeedbackMetadata(...args),
  };
});

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ mergeMessageMetadata: mockMergeMessageMetadata }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      showResponseFeedbackThanksBannerTemporarily: mockShowThanksBanner,
      currentAppId: 'test-app-id',
    }),
}));

vi.mock('@ux/growl', () => ({
  default: Object.assign(
    function Growl() {
      return null;
    },
    {
      addGrowlMessage: vi.fn(),
    }
  ),
}));

import Growl from '@ux/growl';

function renderMetadata(
  props: {
    duration?: number;
    content?: string;
    usedFreeGrants?: boolean;
    messageId?: string;
    messageMetadata?: Record<string, unknown>;
    traceIds?: { traceId?: string; observationId?: string; } | null;
    onUndo?: () => void;
    onRestore?: () => void;
  } = {}
) {
  return renderWithProviders(
    <ResponseMetadata
      duration={props.duration ?? 1000}
      content={props.content ?? 'Test content'}
      usedFreeGrants={props.usedFreeGrants}
      messageId={props.messageId ?? 'msg-test-1'}
      messageMetadata={props.messageMetadata}
      traceIds={props.traceIds ?? null}
      onUndo={props.onUndo}
      onRestore={props.onRestore}
    />
  );
}

function getSection() {
  return screen.getByTestId('response-metadata-status').parentElement as HTMLElement;
}

function getThumbsUpButton() {
  return screen.getByRole('button', { name: /This response was helpful/i });
}

function getThumbsDownButton() {
  return screen.getByRole('button', { name: /builder_chat_response_feedback_negative/i });
}

function getCopyButton() {
  return screen.getByRole('button', { name: /builder_common_copy_clipboard/i });
}

function getActionButtonsRow() {
  const status = screen.getByTestId('response-metadata-status');
  const actionRow = status.nextElementSibling;
  if (!actionRow) {
    throw new Error('response metadata action row not found');
  }
  return actionRow as HTMLElement;
}

function getFeedbackIcon(button: HTMLElement) {
  return button.querySelector('svg.uxicon-svg-container');
}

function mockSwitchboardFlags({
  perMessageFeedback = true,
  flyoutHeight = false,
}: {
  perMessageFeedback?: boolean;
  flyoutHeight?: boolean;
} = {}) {
  vi.mocked(useSwitchboard).mockImplementation(function (feature: string) {
    if (feature === 'appbuilder-per-message-feedback') {
      return perMessageFeedback;
    }
    if (feature === INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG) {
      return flyoutHeight;
    }
    return true;
  });
}

describe('ResponseMetadata', function responseMetadataTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitFeedback.mockResolvedValue({ ok: true });
    mockPatchMessageFeedbackMetadata.mockResolvedValue({ ok: true });
    mockSwitchboardFlags();
  });

  describe('switchboard gating', function switchboardGatingTests() {
    it('should hide thumbs feedback when appbuilder-per-message-feedback is off', function flagOff() {
      vi.mocked(useSwitchboard).mockReturnValue(false);

      renderMetadata();

      expect(
        screen.queryByRole('button', { name: /This response was helpful/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /builder_chat_response_feedback_negative/i })
      ).not.toBeInTheDocument();
      expect(getCopyButton()).toBeInTheDocument();
    });

    it('should show thumbs feedback when appbuilder-per-message-feedback is on', function flagOn() {
      renderMetadata();

      expect(getThumbsUpButton()).toBeInTheDocument();
      expect(getThumbsDownButton()).toBeInTheDocument();
    });

    it('should hide thumbs feedback when content is empty', function emptyContent() {
      renderMetadata({ content: '' });

      expect(
        screen.queryByRole('button', { name: /This response was helpful/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /builder_chat_response_feedback_negative/i })
      ).not.toBeInTheDocument();
      expect(getCopyButton()).toBeInTheDocument();
    });

    it('should hide thumbs feedback when content is whitespace only', function whitespaceContent() {
      renderMetadata({ content: '   \n\t  ' });

      expect(
        screen.queryByRole('button', { name: /This response was helpful/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /builder_chat_response_feedback_negative/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('completion status', function completionStatusTests() {
    it('should render without crashing', function renderSmoke() {
      renderMetadata();

      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();
    });

    it('should display completed text', function completedText() {
      renderMetadata({ duration: 500 });

      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();
    });

    it('should show duration when the metadata section is hovered', async function showDurationOnHover() {
      const { user } = renderMetadata({ duration: 2500 });

      expect(screen.queryByText(/builder_chat_in_duration/i)).not.toBeInTheDocument();

      await user.hover(getSection());

      await waitFor(() => {
        expect(screen.getByText(/builder_chat_in_duration/i)).toBeInTheDocument();
      });
    });

    it('should hide duration when the metadata section is unhovered', async function hideDurationOnUnhover() {
      const { user } = renderMetadata({ duration: 2500 });

      await user.hover(getSection());
      await waitFor(() => {
        expect(screen.getByText(/builder_chat_in_duration/i)).toBeInTheDocument();
      });

      await user.unhover(getSection());

      await waitFor(() => {
        expect(screen.queryByText(/builder_chat_in_duration/i)).not.toBeInTheDocument();
      });
    });

    it('should render without crashing with different durations', function durationFormats() {
      const { rerender } = renderMetadata({ duration: 999 });
      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();

      rerender(
        <ResponseMetadata duration={1000} content="Test" messageId="msg-test-1" traceIds={null} />
      );
      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();

      rerender(
        <ResponseMetadata duration={59999} content="Test" messageId="msg-test-1" traceIds={null} />
      );
      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();

      rerender(
        <ResponseMetadata duration={60000} content="Test" messageId="msg-test-1" traceIds={null} />
      );
      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();
    });
  });

  describe('action button layout', function actionButtonLayoutTests() {
    it('should render compact square action buttons in a tight row on the right', function compactActionButtons() {
      renderMetadata();

      const actionRow = getActionButtonsRow();
      expect(actionRow).toHaveClass('h-4');

      for (const button of [getThumbsUpButton(), getThumbsDownButton(), getCopyButton()]) {
        expect(button.className).toMatch(/!size-4/);
        expect(button.className).toMatch(/!p-0/);
        expect(button.className).toMatch(/!min-w-4/);
        expect(button.className).toMatch(/!max-w-4/);
      }
    });
  });

  describe('copy action', function copyActionTests() {
    it('should render copy button with clipboard title', function copyButton() {
      renderMetadata();

      expect(getCopyButton()).toBeInTheDocument();
      expect(getCopyButton()).toHaveAttribute('title', 'builder_chat_copy_clipboard');
      expect(getCopyButton()).toHaveAttribute('data-eid', 'chat.response_metadata.copy');
    });

    it('should copy content to clipboard when copy button is clicked', async function copyOnClick() {
      const content = 'Content to copy';
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText');

      const { user } = renderMetadata({ content });

      await user.click(getCopyButton());

      await waitFor(() => {
        expect(writeTextSpy).toHaveBeenCalledWith(content);
      });
      expect(instrumentation.logClickEvent).toHaveBeenCalledWith('chat.response_metadata.copy');
    });

    it('should show check icon after successful copy', async function checkAfterCopy() {
      const { user, container } = renderMetadata();

      await user.click(getCopyButton());

      await waitFor(() => {
        const icons = container.querySelectorAll('svg');
        expect(icons.length).toBeGreaterThan(1);
      });
    });
  });

  describe('feedback actions', function feedbackActionTests() {
    it('should hydrate thumbs up from persisted message metadata', function hydratePositive() {
      renderMetadata({ messageMetadata: { feedback: 'positive' } });

      expect(getThumbsUpButton()).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /builder_chat_response_feedback_negative/i })
      ).not.toBeInTheDocument();
    });

    it('should show growl when metadata PATCH fails after thumbs up', async function patchFailureGrowl() {
      mockPatchMessageFeedbackMetadata.mockResolvedValue({ ok: false, reason: 'http_error' });
      const { user } = renderMetadata({ messageId: 'msg-growl-1' });

      await user.click(getThumbsUpButton());

      await waitFor(function waitGrowl() {
        expect(Growl.addGrowlMessage).toHaveBeenCalledWith({
          id: 'response-feedback-save-failed-msg-growl-1',
          title: 'Failed to save the feedback',
          children: 'We were unable to save your feedback. Please try again.',
          emphasis: 'critical',
          lifetime: 3000,
        });
      });
      expect(
        screen.getByRole('button', { name: /builder_chat_response_feedback_negative/i })
      ).toBeInTheDocument();
      expect(mockSubmitFeedback).not.toHaveBeenCalled();
      expect(mockMergeMessageMetadata).not.toHaveBeenCalled();
    });

    it('should render feedback action buttons with tracking ids', function feedbackButtons() {
      renderMetadata();

      expect(getThumbsUpButton()).toBeInTheDocument();
      expect(getThumbsUpButton()).toHaveAttribute('data-eid', 'chat.response_metadata.thumbs_up');
      expect(getThumbsDownButton()).toBeInTheDocument();
      expect(getThumbsDownButton()).toHaveAttribute(
        'data-eid',
        'chat.response_metadata.thumbs_down'
      );
    });

    it('should hide thumbs down when positive feedback is selected', async function hideThumbsDownOnPositive() {
      const { user } = renderMetadata();

      await user.click(getThumbsUpButton());

      expect(getThumbsUpButton()).toBeInTheDocument();
      // The thumbs-down motion.div has an exit animation, so AnimatePresence
      // keeps the button mounted until it finishes — wait for unmount.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /builder_chat_response_feedback_negative/i })
        ).not.toBeInTheDocument();
      });
    });

    it('should hide thumbs up when negative feedback is selected', async function hideThumbsUpOnNegative() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());

      expect(getThumbsDownButton()).toBeInTheDocument();
      // The thumbs-up motion.div has an exit animation, so AnimatePresence
      // keeps the button mounted until it finishes — wait for unmount.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /This response was helpful/i })
        ).not.toBeInTheDocument();
      });
    });

    it('should show filled black thumbs up icon when positive feedback is selected', async function positiveFilledIcon() {
      const { user } = renderMetadata();

      await user.click(getThumbsUpButton());

      const icon = getFeedbackIcon(getThumbsUpButton());
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass('text-black', 'hover:text-black', 'active:text-black', 'opacity-80');
    });

    it('should show rotated filled black icon when negative feedback is selected', async function negativeFilledIcon() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());

      const icon = getFeedbackIcon(getThumbsDownButton());
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass(
        'text-black',
        'hover:text-black',
        'active:text-black',
        'rotate-180',
        'opacity-80'
      );
    });

    it('should render action icons at h-2.5 w-2.5 inside compact buttons', function actionIconSize() {
      renderMetadata();

      const thumbsUpSvg = getThumbsUpButton().querySelector('svg');
      expect(thumbsUpSvg?.classList.toString()).toMatch(/h-2\.5/);
      expect(thumbsUpSvg?.classList.toString()).toMatch(/w-2\.5/);
    });

    it('should show thanks banner when positive feedback is selected', async function positiveThanksBanner() {
      const { user } = renderMetadata({
        traceIds: {
          traceId: '0123456789abcdef0123456789abcdef',
          observationId: 'fedcba9876543210',
        },
      });

      await user.click(getThumbsUpButton());

      await waitFor(() => {
        expect(mockShowThanksBanner).toHaveBeenCalledTimes(1);
      });
      expect(instrumentation.logClickEvent).toHaveBeenCalledWith(
        'chat.response_metadata.thumbs_up'
      );
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: 'positive',
          targetLevel: 'conversation',
          targetId: 'msg-test-1',
          appId: 'test-app-id',
          traceId: '0123456789abcdef0123456789abcdef',
          observationId: 'fedcba9876543210',
        })
      );
    });

    it('should not submit feedback when positive feedback is toggled off', async function noSubmitOnPositiveOff() {
      const { user } = renderMetadata();

      await user.click(getThumbsUpButton());
      await user.click(getThumbsUpButton());

      await waitFor(() => {
        expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);
      });
    });

    it('should clear positive feedback when thumbs up is clicked again', async function togglePositiveOff() {
      const { user } = renderMetadata();

      await user.click(getThumbsUpButton());
      await user.click(getThumbsUpButton());

      expect(mockShowThanksBanner).toHaveBeenCalledTimes(1);
      expect(getThumbsUpButton()).toBeInTheDocument();
      expect(getThumbsDownButton()).toBeInTheDocument();

      const icon = getFeedbackIcon(getThumbsUpButton());
      expect(icon).toBeInTheDocument();
      expect(icon).not.toHaveClass('text-black');
    });

    it('should open negative feedback panel when thumbs down is clicked', async function openNegativePanel() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());

      expect(screen.getByText(/What happened\?/i)).toBeInTheDocument();
      expect(screen.getByText(/Not factually correct/i)).toBeInTheDocument();
      expect(instrumentation.logClickEvent).toHaveBeenCalledWith(
        'chat.response_metadata.thumbs_down'
      );
    });

    it('should close negative panel and clear feedback when thumbs down is toggled off', async function toggleNegativeOff() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());
      expect(screen.getByText(/What happened\?/i)).toBeInTheDocument();

      await user.click(getThumbsDownButton());

      await waitFor(() => {
        expect(screen.queryByText(/What happened\?/i)).not.toBeInTheDocument();
      });
      expect(getThumbsUpButton()).toBeInTheDocument();
      expect(getThumbsDownButton()).toBeInTheDocument();
      expect(mockShowThanksBanner).not.toHaveBeenCalled();
    });

    it('should close panel and show thanks banner when a reason is submitted', async function reasonSubmitted() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());
      mockShowThanksBanner.mockClear();
      mockSubmitFeedback.mockClear();
      await user.click(screen.getByRole('radio', { name: /Not relevant/i }));

      await waitFor(() => {
        expect(screen.queryByText(/What happened\?/i)).not.toBeInTheDocument();
      });
      expect(mockShowThanksBanner).toHaveBeenCalled();
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: 'negative',
          targetLevel: 'conversation',
          targetId: 'msg-test-1',
          appId: 'test-app-id',
          feedbackCategory: 'Not relevant',
          hasDetailedFeedback: true,
        })
      );
    });

    it('should clear negative reason when reopening negative after toggling off', async function clearReasonOnReopen() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());
      await user.click(screen.getByRole('radio', { name: /Confusing or unclear/i }));

      await waitFor(() => {
        expect(screen.queryByText(/What happened\?/i)).not.toBeInTheDocument();
      });

      await user.click(getThumbsDownButton());
      await user.click(getThumbsDownButton());

      const radios = screen.getAllByRole('radio');
      for (const radio of radios) {
        expect(radio).not.toBeChecked();
      }
    });

    it('should show other feedback input when Other is selected', async function otherInput() {
      mockSwitchboardFlags({ flyoutHeight: true });
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());
      await user.click(screen.getByRole('radio', { name: /^Other$/i }));

      const input = screen.getByPlaceholderText(/Share your feedback/i);
      expect(input).toBeInTheDocument();
      await waitFor(() => {
        expect(input).toHaveFocus();
      });
      expect(screen.getByRole('button', { name: /^Submit$/i })).toBeDisabled();
    });

    it('should submit other feedback when Submit closes the panel', async function submitOther() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());
      await user.click(screen.getByRole('radio', { name: /^Other$/i }));

      const input = screen.getByPlaceholderText(/Share your feedback/i);
      await user.type(input, 'Needs more detail');
      await user.click(screen.getByRole('button', { name: /^Submit$/i }));

      await waitFor(() => {
        expect(mockSubmitFeedback).toHaveBeenCalledWith(
          expect.objectContaining({
            feedback: 'negative',
            targetLevel: 'conversation',
            appId: 'test-app-id',
            feedbackCategory: 'Other',
            feedbackText: 'Needs more detail',
            hasDetailedFeedback: true,
          })
        );
      });
      expect(mockShowThanksBanner).toHaveBeenCalled();

      await waitFor(() => {
        expect(screen.queryByText(/What happened\?/i)).not.toBeInTheDocument();
      });
    });

    it('should submit other feedback with empty text when close is clicked', async function closeEmptyOther() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());
      await user.click(screen.getByRole('radio', { name: /^Other$/i }));
      mockShowThanksBanner.mockClear();
      mockSubmitFeedback.mockClear();

      await user.click(screen.getByRole('button', { name: /^Close$/i }));

      await waitFor(() => {
        expect(mockSubmitFeedback).toHaveBeenCalledWith(
          expect.objectContaining({
            feedback: 'negative',
            targetLevel: 'conversation',
            appId: 'test-app-id',
            feedbackCategory: 'Other',
            hasDetailedFeedback: false,
          })
        );
      });
      const submitArg = mockSubmitFeedback.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(submitArg).not.toHaveProperty('feedbackText');
      expect(mockShowThanksBanner).toHaveBeenCalled();
    });

    it('should clear draft when negative panel close button is clicked', async function closeClearsDraft() {
      const { user } = renderMetadata();

      await user.click(getThumbsDownButton());
      await user.click(screen.getByRole('radio', { name: /^Other$/i }));
      await user.type(screen.getByPlaceholderText(/Share your feedback/i), 'draft');
      mockSubmitFeedback.mockClear();

      await user.click(screen.getByRole('button', { name: /^Close$/i }));

      await waitFor(() => {
        expect(mockSubmitFeedback).toHaveBeenCalledWith(
          expect.objectContaining({
            feedback: 'negative',
            targetLevel: 'conversation',
            appId: 'test-app-id',
            feedbackCategory: 'Other',
            feedbackText: 'draft',
            hasDetailedFeedback: true,
          })
        );
        expect(screen.queryByText(/What happened\?/i)).not.toBeInTheDocument();
      });

      await user.click(getThumbsDownButton());
      await user.click(getThumbsDownButton());
      await user.click(screen.getByRole('radio', { name: /^Other$/i }));

      expect(screen.getByPlaceholderText(/Share your feedback/i)).toHaveValue('');
    });
  });

  describe('onRestore', function onRestoreTests() {
    it('should not render a restore button when onRestore is not provided', function noRestoreButton() {
      renderMetadata();

      expect(screen.queryByTitle('Restore')).not.toBeInTheDocument();
    });

    it('should render the restore button when onRestore is provided', function restoreButton() {
      renderMetadata({ onRestore: vi.fn() });

      expect(screen.getByTitle('Restore')).toBeInTheDocument();
    });

    it('should invoke onRestore when the restore button is clicked', async function restoreClick() {
      const onRestore = vi.fn();
      const { user } = renderMetadata({ onRestore });

      await user.click(screen.getByTitle('Restore'));
      expect(onRestore).toHaveBeenCalledTimes(1);
    });
  });

  describe('onUndo', function onUndoTests() {
    it('should render the undo button when onUndo is provided', function undoButton() {
      renderMetadata({ onUndo: vi.fn() });

      expect(screen.getByTitle('Undo')).toBeInTheDocument();
    });

    it('should invoke onUndo when the undo button is clicked', async function undoClick() {
      const onUndo = vi.fn();
      const { user } = renderMetadata({ onUndo });

      await user.click(screen.getByTitle('Undo'));
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it('should render only the undo button when both onUndo and onRestore are provided', function undoPrecedence() {
      renderMetadata({ onUndo: vi.fn(), onRestore: vi.fn() });

      expect(screen.getByTitle('Undo')).toBeInTheDocument();
      expect(screen.queryByTitle('Restore')).not.toBeInTheDocument();
    });
  });

  describe('usedFreeGrants', function usedFreeGrantsTests() {
    it('should render free grants text when usedFreeGrants is true', function freeGrantsText() {
      renderMetadata({ usedFreeGrants: true });

      expect(screen.getByText(/builder_chat_completed_free/i)).toBeInTheDocument();
    });

    it('should render regular completed text when usedFreeGrants is false', function regularCompletedText() {
      renderMetadata({ usedFreeGrants: false });

      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();
      expect(screen.queryByText(/builder_chat_completed_free/i)).not.toBeInTheDocument();
    });

    it('should apply success color class on status text when usedFreeGrants is true', function successColorClass() {
      renderMetadata({ usedFreeGrants: true });

      const status = screen.getByTestId('response-metadata-status');
      const textRow = status.querySelector('.flex.min-w-0');
      expect(textRow).toHaveClass('text-intents-ux-feedbackHighContrastSuccess-feedbackColor');
      expect(textRow).not.toHaveClass('text-foreground/50');
    });

    it('should apply default color class on status text when usedFreeGrants is false', function defaultColorClass() {
      renderMetadata({ usedFreeGrants: false });

      const status = screen.getByTestId('response-metadata-status');
      const textRow = status.querySelector('.flex.min-w-0');
      expect(textRow).toHaveClass('text-foreground/50');
      expect(textRow).not.toHaveClass('text-intents-ux-feedbackHighContrastSuccess-feedbackColor');
    });

    it('should not apply hover text color change when usedFreeGrants is true', function noHoverColorWhenFree() {
      renderMetadata({ usedFreeGrants: true });

      const status = screen.getByTestId('response-metadata-status');
      const textRow = status.querySelector('.flex.min-w-0');
      expect(textRow).not.toHaveClass('group-hover:text-foreground');
    });

    it('should apply hover text color change when usedFreeGrants is false', function hoverColorWhenNotFree() {
      renderMetadata({ usedFreeGrants: false });

      const status = screen.getByTestId('response-metadata-status');
      const textRow = status.querySelector('.flex.min-w-0');
      expect(textRow).toHaveClass('group-hover:text-foreground');
    });
  });
});
