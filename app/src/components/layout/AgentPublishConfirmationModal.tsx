'use client';

import { useEffect } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';

export interface AgentPublishConfirmationModalProps {
  appId: string;
}

/**
 * Human-in-the-loop approval gate for agent-initiated publishes.
 *
 * The agent's publish tool funnels through the `publish` client action, which pauses
 * and sets `agentPublishConfirmation` to 'pending' (see publishAction.ts). This modal
 * renders only in that state and resolves the agent's awaited promise on the user's
 * choice. The UI Publish button does NOT go through that action, so it is never gated.
 */
export default function AgentPublishConfirmationModal({ appId }: AgentPublishConfirmationModalProps) {
  const t = useTranslations();
  const status = useDevelopPageStore((state) => state.getPublishState(appId).agentPublishConfirmation);
  const resolveAgentPublishConfirmation = useDevelopPageStore((state) => state.resolveAgentPublishConfirmation);

  const isOpen = status === 'pending';

  useEffect(() => {
    if (isOpen) {
      logImpressionEvent('develop.publish.agent_confirm.view')();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const approve = () => resolveAgentPublishConfirmation(appId, true);
  const decline = () => resolveAgentPublishConfirmation(appId, false);

  return (
    <Modal
      title={t('builder_agent_publish_confirm_title')}
      onClose={decline}
      id="agent-publish-confirm-modal"
      data-testid="agent-publish-confirm-modal"
    >
      <Box className="md:max-w-lg" orientation="vertical" gap="lg">
        <text.p className="text-left">{t('builder_agent_publish_confirm_message')}</text.p>
        <Box orientation="horizontal" gap="sm" className="w-full justify-end">
          <Button
            design="secondary"
            data-eid={generateClickEID('agent_publish_confirm.buttons.cancel')}
            text={t('builder_agent_publish_confirm_cancel')}
            onClick={decline}
          />
          <Button
            design="primary"
            data-testid="agent-publish-confirm-button"
            data-eid={generateClickEID('agent_publish_confirm.buttons.publish')}
            text={t('builder_agent_publish_confirm_publish')}
            onClick={approve}
          />
        </Box>
      </Box>
    </Modal>
  );
}
