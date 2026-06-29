'use client';

import { useEffect, useRef } from 'react';

import {
  InvocationFeedbackControls,
  InvocationFeedbackPanel,
  InvocationFeedbackProvider,
} from '@/app/[market]/develop/components/invocation-feedback';
import { useTranslations } from '@/hooks/useTranslations';
import ChatBanner from '@/lib/ChatBanner';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

export default function AgentWorkFeedbackBanner() {
  const t = useTranslations();
  const hasLoggedImpressionRef = useRef(false);

  const appId = useDevelopPageStore((state) => state.currentAppId);
  const agentTargetId = useDevelopPageStore((state) => state.agentWorkFeedbackAgentId);
  const traceIds = useDevelopPageStore((state) => state.agentWorkFeedbackTraceIds);
  const markSubmitted = useDevelopPageStore((state) => state.markAgentWorkFeedbackSubmitted);
  const setShowBanner = useDevelopPageStore((state) => state.setShowAgentWorkFeedbackBanner);

  useEffect(() => {
    if (hasLoggedImpressionRef.current) return;
    logImpressionEvent('skill-invoke.feedback.view')();
    hasLoggedImpressionRef.current = true;
  }, []);

  const handleClose = () => {
    logClickEvent('skill-invoke.feedback.close')();
    setShowBanner(false, null);
  };

  if (!agentTargetId) {
    return null;
  }

  return (
    <InvocationFeedbackProvider
      appId={appId}
      messageId="agent-work-feedback"
      traceIds={traceIds}
      flow="skill-invoke"
      agentTargetId={agentTargetId}
      onSubmitted={markSubmitted}
      onSubmitFailed={(reason) => {
        if (reason === 'missing_conversation_id') {
          setShowBanner(false, null);
        }
      }}
    >
      <div data-testid="agent-work-feedback-banner" className="flex w-full flex-col gap-1">
        <ChatBanner variant="info" onClose={handleClose}>
          <div className="flex items-center gap-2">
            <span className="flex-1 font-bold" data-testid="agent-work-feedback-prompt">
              {t('builder_task_completion_feedback_prompt', undefined, 'Did you accomplish what you wanted?')}
            </span>
            <InvocationFeedbackControls />
          </div>
        </ChatBanner>
        <InvocationFeedbackPanel />
      </div>
    </InvocationFeedbackProvider>
  );
}
