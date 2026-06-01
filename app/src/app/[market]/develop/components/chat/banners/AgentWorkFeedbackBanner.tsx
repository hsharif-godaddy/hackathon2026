'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  InvocationFeedbackControls,
  InvocationFeedbackPanel,
  InvocationFeedbackProvider,
} from '@/app/[market]/develop/components/invocation-feedback';
import { useTranslations } from '@/hooks/useTranslations';
import { parseAgentKeyFromTargetId, resolveAgentDisplayName } from '@/lib/agent-display-name';
import ChatBanner from '@/lib/ChatBanner';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

export default function AgentWorkFeedbackBanner() {
  const t = useTranslations();
  const hasLoggedImpressionRef = useRef(false);

  const appId = useDevelopPageStore((state) => state.currentAppId);
  const agentTargetId = useDevelopPageStore((state) => state.agentWorkFeedbackAgentId);
  const traceIds = useDevelopPageStore((state) => state.agentWorkFeedbackTraceIds);
  const availableAgents = useStreamingConversationStore((state) => state.availableAgents);
  const currentAgentName = useStreamingConversationStore((state) => state.currentAgentName);

  const agentDisplayName = useMemo(
    function resolveLabel() {
      return resolveAgentDisplayName(
        parseAgentKeyFromTargetId(agentTargetId ?? ''),
        availableAgents,
        currentAgentName
      );
    },
    [agentTargetId, availableAgents, currentAgentName]
  );
  const markSubmitted = useDevelopPageStore((state) => state.markAgentWorkFeedbackSubmitted);
  const setShowBanner = useDevelopPageStore((state) => state.setShowAgentWorkFeedbackBanner);

  useEffect(() => {
    if (hasLoggedImpressionRef.current) return;
    logImpressionEvent('agentWork.feedback.view')();
    hasLoggedImpressionRef.current = true;
  }, []);

  const handleClose = () => {
    logClickEvent('agentWork.feedback.close')();
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
      flow="agent-work"
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
              {t('builder_agent_work_feedback_prompt_with_agent', { agentName: agentDisplayName })}
            </span>
            <InvocationFeedbackControls />
          </div>
        </ChatBanner>
        <InvocationFeedbackPanel />
      </div>
    </InvocationFeedbackProvider>
  );
}
