import { useCallback } from 'react';

import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types';
import { useChatContext } from '@/contexts/ChatContext';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';
import { logClickEvent } from '@/utils/instrumentation';
import { type InboxEmptyStateCta } from './inboxEmptyState';

interface UseInboxEmptyPrompt {
  handleCtaClick: (cta: InboxEmptyStateCta) => void;
  isProcessing: boolean;
}

export function useInboxEmptyPrompt(): UseInboxEmptyPrompt {
  const t = useTranslations();
  const { sendMessage } = useChatContext();
  const isStreaming: boolean = useIsActivelyStreaming();
  const isLoading: boolean = useIsLoading();
  const isProcessing: boolean = isStreaming || isLoading;
  const isMobile: boolean = useDevelopPageStore((state) => state.isMobile);
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);

  const handleCtaClick = useCallback(
    (cta: InboxEmptyStateCta): void => {
      if (isProcessing) return;
      logClickEvent(cta.eid)();
      void sendMessage({ content: t(cta.promptKey), isActionRequest: true });
      if (isMobile) {
        handleMobileModeChange(MobileMode.TOOLS);
        setActiveChatTab(ChatTab.CHAT);
      }
    },
    [isProcessing, sendMessage, t, isMobile, handleMobileModeChange, setActiveChatTab],
  );

  return { handleCtaClick, isProcessing };
}
