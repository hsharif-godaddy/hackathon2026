'use client';

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext';
import OptionButton from '@/app/[market]/develop/components/tool-renderers/OptionButton';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';

interface PostPublishPreLaunchSeoPromptProps {
  appId: string;
  onDismiss: () => void;
}

const SEO_CHECK_ACTION_USER_MESSAGE =
  'Run an SEO check on my site and suggest improvements to help me rank better in search results.';

const SEO_CHECK_INTRO =
  "Let's make sure your site is ready to launch.\n\nWe'll run an SEO check to help you rank better in search results.\n\nThis uses credits based on your site size, and you can run more checks later if needed.";

const SEO_CHECK_OPTION_LABEL = 'Run SEO check';

export default function PostPublishPreLaunchSeoPrompt({
  appId,
  onDismiss,
}: PostPublishPreLaunchSeoPromptProps) {
  const t = useTranslations();
  const sendUserMessage = useSendUserMessage();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function runSeoCheck() {
    if (isSubmitting) {
      return;
    }
    if (!sendUserMessage) {
      logger.warn('go-live.chat.seo_check_no_send_hook', { appId });
      return;
    }

    setIsSubmitting(true);
    try {
      await Promise.resolve(
        sendUserMessage(SEO_CHECK_ACTION_USER_MESSAGE, { isActionRequest: true }),
      );
      logger.info('go-live.chat.seo_check_requested', { appId });
      shipAnalyticsLog('go_live.chat.seo_check_requested', { appId });
      onDismiss();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Box gap="sm" className="font-sans break-words" data-testid="post-publish-prelaunch-seo-prompt">
      <p className="m-0 whitespace-pre-line text-sm leading-relaxed">{SEO_CHECK_INTRO}</p>

      <div data-testid="post-publish-prelaunch-seo-run-button">
        <OptionButton
          text={SEO_CHECK_OPTION_LABEL}
          disabled={isSubmitting || !sendUserMessage}
          onClick={function submitSeoCheck() {
            void runSeoCheck();
          }}
          animationDelay={0}
          isSelectable={true}
        />
      </div>

      <Box
        orientation="horizontal"
        gap="sm"
        inlineAlignChildren="start"
        className="text-xs text-intents-ux-textSubtle-textColor mt-1"
      >
        <span className="text-sm">{t('builder_tools_suggested_response')}</span>
      </Box>

      <div className="mt-[20px] flex justify-end">
        <Button
          design="secondary"
          size="sm"
          text={t('builder_golive_select_button_cancel')}
          onClick={onDismiss}
          disabled={isSubmitting}
        />
      </div>
    </Box>
  );
}
