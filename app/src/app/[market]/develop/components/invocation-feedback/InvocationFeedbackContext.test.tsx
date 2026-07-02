/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { useEffect, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { renderWithProviders } from '@/tests/test-utils';
import { INLINE_FEEDBACK_FREE_TEXT_FLAG } from './constants';
import { InvocationFeedbackProvider, useInvocationFeedback } from './InvocationFeedbackContext';
import InvocationFeedbackControls from './InvocationFeedbackControls';
import InvocationFeedbackPanel from './InvocationFeedbackPanel';

const mockSubmitFeedback = vi.fn();
const mockStoreToS3 = vi.fn();
const mockShipAnalyticsLog = vi.fn();
const mockPatchMessageFeedbackMetadata = vi.fn();
const mockMergeMessageMetadata = vi.fn();

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function (flag: string) {
    // vi.mock factories are hoisted before imports — use the literal string.
    // Free-text defaults to enabled so existing tests that interact with the
    // Other chip / free-text input continue to work unchanged.
    if (flag === 'appbuilder-inline-feedback-free-text') return true;
    return false;
  }),
  getSwitchboardFlag: vi.fn(function () {
    return false;
  }),
}));

vi.mock('@/hooks/chat/useChatHelpers', () => ({
  getConversationIdFromCookie: () => 'conv-1',
}));

vi.mock('@/lib/feedback-client', () => ({
  submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
}));

vi.mock('@/components/feedback/submitFeedback', () => ({
  storeToS3: (...args: unknown[]) => mockStoreToS3(...args),
}));

vi.mock('@/components/feedback/utils', () => ({
  getFullStorySessionUrl: vi.fn(async function () {
    return 'https://fullstory.test/session';
  }),
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
  logClickEvent: vi.fn(function () {
    return vi.fn();
  }),
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
        agentWorkFeedbackRevealMilestone: 'logoDownload',
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
    // Restore the default implementation after clearAllMocks (which does not
    // reset implementations, only call history). Without this, a test that
    // calls mockImplementation() leaks its override into subsequent tests.
    vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
      if (flag === 'appbuilder-inline-feedback-free-text') return true;
      return false;
    });
    mockSubmitFeedback.mockResolvedValue({ ok: true });
    mockStoreToS3.mockResolvedValue({ ok: true, status: 200 });
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
        traceIds={{ traceId: 'trace-1', observationId: 'obs-1' }}
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
    mockSubmitFeedback.mockImplementation(function () {
      return new Promise((resolve) => {
        resolveSubmit = resolve;
      });
    });

    function OverlappingPersistProbe() {
      const { toggleNegative, handleReasonSelect, togglePositive } = useInvocationFeedback();
      const started = useRef(false);

      useEffect(
        function startOverlappingPersists() {
          if (started.current) {
            return;
          }
          started.current = true;
          toggleNegative();
          handleReasonSelect('not_factually_correct');
          togglePositive();
        },
        [handleReasonSelect, toggleNegative, togglePositive]
      );

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

  it('submits skill-invoke feedback with invocation target level and namespaced jtbd target id', async function agentWork() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="agent-work-feedback"
        traceIds={{ traceId: 'trace-1', observationId: 'obs-1' }}
        flow="skill-invoke"
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
          targetId: 'airo-app-builder-logo',
        })
      );
    });
    expect(mockPatchMessageFeedbackMetadata).not.toHaveBeenCalled();

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'skill-invoke.feedback.submit',
      expect.objectContaining({
        flow: 'skill-invoke',
        initialBuildRevealMilestone: 'logoDownload',
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
    expect(mockStoreToS3).not.toHaveBeenCalled();
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
    await waitFor(function waitS3() {
      expect(mockStoreToS3).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: 'app-1',
          feedback_category: 'customer-feedback',
          feedback_text: 'draft',
          feedback_topic_list: JSON.stringify(['Other']),
          feedback_origin_name: 'inline-customer-feedback',
          full_story_url: 'https://fullstory.test/session',
          consent_flag: false,
        })
      );
    });
  });

  it('stores negative other text to S3 for skill-invoke flow', async function skillInvokeS3() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="agent-work-feedback"
        flow="skill-invoke"
        agentTargetId="airo-app-builder-InitialAgent"
        thanksMode="none"
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.type(screen.getByPlaceholderText(/Share your feedback/i), 'skill invoke issue');
    await user.click(screen.getByRole('button', { name: /^Close$/i }));

    await waitFor(function waitS3() {
      expect(mockStoreToS3).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback_text: 'skill invoke issue',
          feedback_origin_name: 'inline-customer-feedback',
        })
      );
    });
  });

  it('submits skill-invoke negative feedback directly without opening panel when free-text is disabled', async function skillInvokeDirectSubmit() {
    vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
      if (flag === INLINE_FEEDBACK_FREE_TEXT_FLAG) return false;
      return false;
    });

    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="agent-work-feedback"
        flow="skill-invoke"
        agentTargetId="airo-app-builder-InitialAgent"
        thanksMode="none"
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);

    await waitFor(function waitDirectSubmit() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: 'negative',
          feedbackCategory: 'Other',
          targetLevel: 'invocation',
        })
      );
    });

    expect(screen.queryByPlaceholderText(/Share your feedback/i)).not.toBeInTheDocument();
  });

  it('does not store negative other text to S3 when submitFeedback fails', async function noS3OnSubmitFailure() {
    mockSubmitFeedback.mockResolvedValue({ ok: false, reason: 'http_error' });
    const onSubmitFailed = vi.fn();
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-1"
        traceIds={{ traceId: 'trace-1', observationId: 'obs-1' }}
        flow="per-message"
        onSubmitFailed={onSubmitFailed}
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.click(screen.getByRole('radio', { name: /^Other$/i }));
    await user.type(screen.getByPlaceholderText(/Share your feedback/i), 'draft');
    await user.click(screen.getByRole('button', { name: /^Close$/i }));

    await waitFor(function waitSubmitFailure() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: 'negative',
          feedbackCategory: 'Other',
          feedbackText: 'draft',
        })
      );
      expect(onSubmitFailed).toHaveBeenCalledWith('http_error');
    });
    expect(mockStoreToS3).not.toHaveBeenCalled();
  });

  it('stores negative other text to S3 for artifact flow', async function artifactS3() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="artifact-feedback"
        flow="artifact"
        thanksMode="none"
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.click(screen.getByRole('radio', { name: /^Other$/i }));
    await user.type(screen.getByPlaceholderText(/Share your feedback/i), 'artifact issue');
    await user.click(screen.getByRole('button', { name: /^Close$/i }));

    await waitFor(function waitS3() {
      expect(mockStoreToS3).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback_text: 'artifact issue',
          feedback_origin_name: 'inline-customer-feedback',
        })
      );
    });
  });

  it('uses airo-app-builder-{type} as targetId for artifact flow without instance id', async function artifactTargetIdNoInstance() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-artifact-1"
        flow="artifact"
        artifactType="logo"
        thanksMode="none"
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.click(screen.getByRole('radio', { name: /^Doesn't match my brand$/i }));

    await waitFor(function waitArtifactTargetId() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'airo-app-builder-logo',
          targetLevel: 'artifact',
        })
      );
    });
  });

  it('appends :{artifactId} suffix to targetId when artifact instance id is provided', async function artifactTargetIdWithInstance() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-artifact-2"
        flow="artifact"
        artifactType="logo"
        artifactId="logo-uuid-abc"
        thanksMode="none"
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.click(screen.getByRole('radio', { name: /^Doesn't match my brand$/i }));

    await waitFor(function waitArtifactTargetIdWithSuffix() {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'airo-app-builder-logo:logo-uuid-abc',
          targetLevel: 'artifact',
        })
      );
    });
  });

  it('stores non-other negative reason to S3 with correct topic and empty text', async function nonOtherReasonS3() {
    const { user } = renderWithProviders(
      <InvocationFeedbackProvider
        appId="app-1"
        messageId="msg-1"
        traceIds={{ traceId: 'trace-1', observationId: 'obs-1' }}
        flow="per-message"
        thanksMode="none"
      >
        <InvocationFeedbackControls />
        <InvocationFeedbackPanel />
      </InvocationFeedbackProvider>
    );

    const thumbsDown = document.querySelector('[data-eid="chat.response_metadata.thumbs_down"]');
    expect(thumbsDown).toBeTruthy();
    await user.click(thumbsDown!);
    await user.click(screen.getByRole('radio', { name: /Not factually correct/i }));

    await waitFor(function waitS3() {
      expect(mockStoreToS3).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: 'app-1',
          feedback_category: 'customer-feedback',
          feedback_text: '',
          feedback_topic_list: JSON.stringify(['Not accurate']),
          feedback_origin_name: 'inline-customer-feedback',
          consent_flag: false,
        })
      );
    });
  });
});
