/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { useEffect, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { renderWithProviders } from '@/tests/test-utils';
import {
  InvocationFeedbackProvider,
  useInvocationFeedback,
} from './InvocationFeedbackContext';
import InvocationFeedbackControls from './InvocationFeedbackControls';
import InvocationFeedbackPanel from './InvocationFeedbackPanel';

const mockSubmitFeedback = vi.fn();
const mockShipAnalyticsLog = vi.fn();
const mockPatchMessageFeedbackMetadata = vi.fn();
const mockMergeMessageMetadata = vi.fn();

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return false; }),
  getSwitchboardFlag: vi.fn(function () { return false; }),
}));

vi.mock('@/hooks/websocket/useWebSocketHelpers', () => ({
  getConversationIdFromCookie: () => 'conv-1',
}));

vi.mock('@/lib/feedback-client', () => ({
  submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
}));

vi.mock('@/lib/message-metadata-client', () => ({
  patchMessageFeedbackMetadata: (...args: unknown[]) => mockPatchMessageFeedbackMetadata(...args),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ mergeMessageMetadata: mockMergeMessageMetadata }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}));

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(function () { return vi.fn(); }),
  generateClickEID: (id: string) => id,
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        showResponseFeedbackThanksBannerTemporarily: vi.fn(),
        agentWorkFeedbackRevealMilestone: null,
      }),
    {
      getState: () => ({
        agentWorkFeedbackRevealMilestone: 'firstFileEdit',
        showResponseFeedbackThanksBannerTemporarily: vi.fn(),
      }),
    }
  ),
}));

function renderPerMessageProvider() {
  return renderWithProviders(
    <InvocationFeedbackProvider
      appId="app-1"
      messageId="msg-1"
      traceIds={{ traceId: 'trace-1', observationId: 'obs-1' }}
      flow="per-message"
    >
      <InvocationFeedbackControls />
      <InvocationFeedbackPanel />
    </InvocationFeedbackProvider>
  );
}

describe('InvocationFeedbackContext', function contextTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockSubmitFeedback.mockResolvedValue({ ok: true });
    mockPatchMessageFeedbackMetadata.mockResolvedValue({ ok: true });
  });

  it('hydrates thumbs from initialFeedback', function hydrate() {
    renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-1"
        initialFeedback="positive"
        flow="per-message"
      >
        <InvocationFeedbackControls />
      </InvocationFeedbackProvider>
    );

    expect(
      screen.queryByRole('button', { name: /builder_chat_response_feedback_negative/i })
    ).not.toBeInTheDocument();
  });

  it('submits per-message positive feedback with conversation target level', async function perMessage() {
    const { user } = renderPerMessageProvider();

    const thumbsUp = document.querySelector('[data-eid="chat.response_metadata.thumbs_up"]');
    expect(thumbsUp).toBeTruthy();
    await user.click(thumbsUp!);

    await waitFor(function waitSubmit() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: 'positive',
          targetLevel: 'conversation',
          targetId: 'msg-1',
          appId: 'app-1',
          observationId: 'obs-1',
          traceId: 'trace-1',
        })
      );
      expect(mockPatchMessageFeedbackMetadata).toHaveBeenCalledWith({
        appId: 'app-1',
        messageId: 'msg-1',
        feedback: 'positive',
      });
      expect(mockMergeMessageMetadata).toHaveBeenCalledWith('msg-1', { feedback: 'positive' });
    });

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'chat.response_metadata.feedback.submit',
      expect.objectContaining({ flow: 'per-message' })
    );
  });

  it('does not PATCH negative feedback when thumbs down only opens the panel', async function thumbsDownOpen() {
    const { user } = renderPerMessageProvider();

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);

    expect(mockPatchMessageFeedbackMetadata).not.toHaveBeenCalled();
    expect(mockMergeMessageMetadata).not.toHaveBeenCalled();
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
    expect(screen.getByText(/What happened\?/i)).toBeInTheDocument();
  });

  it('rolls back thumbs up when message metadata PATCH fails without sending analytics', async function metadataFailure() {
    mockPatchMessageFeedbackMetadata.mockResolvedValue({ ok: false, reason: 'http_error' });
    const onSubmitFailed = vi.fn();
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-1"
        traceIds={{ traceId: 'trace-1', observationId: 'obs-1', agentName: 'InitialAgent' }}
        flow="per-message"
        onSubmitFailed={onSubmitFailed}
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsUp = document.querySelector('[data-eid="chat.response_metadata.thumbs_up"]');
    expect(thumbsUp).toBeTruthy();
    await user.click(thumbsUp!);

    await waitFor(function waitRollback() {
      expect(mockPatchMessageFeedbackMetadata).toHaveBeenCalledWith({
        appId: 'app-1',
        messageId: 'msg-1',
        feedback: 'positive',
      });
      expect(onSubmitFailed).toHaveBeenCalledWith('http_error');
      expect(
        screen.getByRole('button', { name: /builder_chat_response_feedback_negative/i })
      ).toBeInTheDocument();
    });
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
    expect(mockShipAnalyticsLog).not.toHaveBeenCalled();
    expect(mockMergeMessageMetadata).not.toHaveBeenCalled();
  });

  it('calls onSubmitFailed with network_error when metadata PATCH fails', async function metadataNetworkError() {
    mockPatchMessageFeedbackMetadata.mockResolvedValue({ ok: false, reason: 'network_error' });
    const onSubmitFailed = vi.fn();
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-1"
        flow="per-message"
        onSubmitFailed={onSubmitFailed}
      >
        <InvocationFeedbackControls />
      </InvocationFeedbackProvider>
    );

    const thumbsUp = document.querySelector('[data-eid="chat.response_metadata.thumbs_up"]');
    expect(thumbsUp).toBeTruthy();
    await user.click(thumbsUp!);

    await waitFor(function waitFailed() {
      expect(onSubmitFailed).toHaveBeenCalledWith('network_error');
    });
  });

  it('clears persisted feedback when toggling thumbs up off', async function clearPositive() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-1"
        initialFeedback="positive"
        flow="per-message"
      >
        <InvocationFeedbackControls />
      </InvocationFeedbackProvider>
    );

    const thumbsUp = document.querySelector('[data-eid="chat.response_metadata.thumbs_up"]');
    expect(thumbsUp).toBeTruthy();
    await user.click(thumbsUp!);

    await waitFor(function waitClear() {
      expect(mockPatchMessageFeedbackMetadata).toHaveBeenCalledWith({
        appId: 'app-1',
        messageId: 'msg-1',
        feedback: null,
      });
      expect(mockMergeMessageMetadata).toHaveBeenCalledWith('msg-1', { feedback: null });
    });
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });

  it('rolls back optimistic thumbs up when appId is missing', async function noAppId() {
    const onSubmitFailed = vi.fn();
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId={null}
        messageId="msg-1"
        flow="per-message"
        onSubmitFailed={onSubmitFailed}
      >
        <InvocationFeedbackControls />
      </InvocationFeedbackProvider>
    );

    const thumbsUp = document.querySelector('[data-eid="chat.response_metadata.thumbs_up"]');
    expect(thumbsUp).toBeTruthy();
    await user.click(thumbsUp!);

    await waitFor(function waitFailed() {
      expect(onSubmitFailed).toHaveBeenCalledWith('no_app_id');
    });
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /builder_chat_response_feedback_negative/i })
    ).toBeInTheDocument();
  });

  it('rolls back optimistic feedback when a second persist starts while one is in flight', async function inFlight() {
    const onSubmitFailed = vi.fn();
    let resolveSubmit: ((value: { ok: boolean }) => void) | undefined;
    mockSubmitFeedback.mockImplementation(
      function () { return new Promise((resolve) => {
          resolveSubmit = resolve;
        }); }
    );

    function OverlappingPersistProbe() {
      const { toggleNegative, handleReasonSelect, togglePositive } = useInvocationFeedback();
      const started = useRef(false);

      useEffect(function startOverlappingPersists() {
        if (started.current) {
          return;
        }
        started.current = true;
        toggleNegative();
        handleReasonSelect('not_factually_correct');
        togglePositive();
      }, [handleReasonSelect, toggleNegative, togglePositive]);

      return null;
    }

    renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-1"
        traceIds={{ traceId: 'trace-1', observationId: 'obs-1' }}
        flow="per-message"
        onSubmitFailed={onSubmitFailed}
      >
        <OverlappingPersistProbe />
        <InvocationFeedbackControls />
      </InvocationFeedbackProvider>
    );

    await waitFor(function waitInFlight() {
      expect(onSubmitFailed).toHaveBeenCalledWith('in_flight');
    });
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: /builder_chat_response_feedback_negative/i })
    ).toBeInTheDocument();

    resolveSubmit?.({ ok: true });
  });

  it('submits agent-work feedback with invocation target level and agent target id', async function agentWork() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="agent-work-feedback"
        traceIds={{ traceId: 'trace-1', observationId: 'obs-1' }}
        flow="agent-work"
        agentTargetId="airo-app-builder-InitialAgent"
        thanksMode="none"
        onSubmitted={vi.fn()}
      >
        <InvocationFeedbackControls />
      </InvocationFeedbackProvider>
    );

    const thumbsUp = document.querySelector('[data-eid="chat.response_metadata.thumbs_up"]');
    expect(thumbsUp).toBeTruthy();
    await user.click(thumbsUp!);

    await waitFor(function waitSubmit() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          targetLevel: 'invocation',
          targetId: 'airo-app-builder-InitialAgent',
        })
      );
    });
    expect(mockPatchMessageFeedbackMetadata).not.toHaveBeenCalled();

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'agentWork.feedback.submit',
      expect.objectContaining({
        flow: 'agent-work',
        initialBuildRevealMilestone: 'firstFileEdit',
      })
    );
  });

  it('submits negative other feedback with empty text when the panel close button is clicked', async function closeEmptyOther() {
    const { user } = renderPerMessageProvider();

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.click(screen.getByRole('radio', { name: /^Other$/i }));

    await user.click(screen.getByRole('button', { name: /^Close$/i }));

    await waitFor(function waitSubmit() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: 'negative',
          targetLevel: 'conversation',
          targetId: 'msg-1',
          feedbackCategory: 'Other',
          hasDetailedFeedback: false,
        })
      );
      expect(mockPatchMessageFeedbackMetadata).toHaveBeenCalledWith({
        appId: 'app-1',
        messageId: 'msg-1',
        feedback: 'negative',
      });
    });

    const submitArg = mockSubmitFeedback.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitArg).not.toHaveProperty('feedbackText');
  });

  it('submits negative other feedback with draft text when the panel close button is clicked', async function closeWithDraft() {
    const { user } = renderPerMessageProvider();

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.click(screen.getByRole('radio', { name: /^Other$/i }));
    await user.type(screen.getByPlaceholderText(/Share your feedback/i), 'draft');
    mockSubmitFeedback.mockClear();

    await user.click(screen.getByRole('button', { name: /^Close$/i }));

    await waitFor(function waitSubmit() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: 'negative',
          targetLevel: 'conversation',
          targetId: 'msg-1',
          feedbackCategory: 'Other',
          feedbackText: 'draft',
          hasDetailedFeedback: true,
        })
      );
    });
  });
});
