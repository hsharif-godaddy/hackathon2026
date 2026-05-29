import { useCallback, useEffect, useRef, useState } from 'react';
import DigitalCareUXClient from '@gdcorp-digitalcare/ux';
import { ChatCapabilities, ChatReadyState } from '@gdcorp-digitalcare/ux/ux-client';

import { logger } from '@/lib/request-context';

/**
 * Hook to initialize and manage the DigitalCare support chat client with lazy initialization.
 * The chat client will only be initialized when launchSupportChat is first called.
 *
 * @returns Object containing:
 *   - launchSupportChat: Function to open the support chat (initializes on first call)
 *   - isLoading: Boolean indicating if the chat client is loading or initializing
 */
export function useSupportChat() {
  const [chatClient, setChatClient] = useState<ChatCapabilities | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const initializingRef = useRef(false);
  const pendingLaunchRef = useRef(false);
  const uxClientRef = useRef<DigitalCareUXClient | null>(null);

  const initializeChatClient = useCallback(() => {
    // Prevent multiple simultaneous initialization attempts
    if (initializingRef.current || chatClient) {
      return;
    }

    initializingRef.current = true;
    setIsLoading(true);
    logger.info('support-chat.initializing');

    const uxClient = new DigitalCareUXClient();
    uxClientRef.current = uxClient;

    const readyStateHandler = (readyState: ChatReadyState) => {
      logger.info('support-chat.ready-state-changed', { readyState });

      const isLoadingState =
        readyState === ChatReadyState.Loading || readyState === ChatReadyState.Initializing;
      setIsLoading(isLoadingState);
    };

    uxClient.chat
      .init({
        launchAiroCare: true,
        readyStateHandler,
      })
      .then(() => {
        setChatClient(uxClient.chat);
        logger.info('support-chat.initialized');
        initializingRef.current = false;

        // If launch was requested during initialization, launch now
        if (pendingLaunchRef.current) {
          pendingLaunchRef.current = false;
          uxClient.chat.launch();
          logger.info('support-chat.launched-after-init');
        }
      })
      .catch((error) => {
        logger.error('support-chat.init-failed', { error });
        setIsLoading(false);
        initializingRef.current = false;
        pendingLaunchRef.current = false;
      });
  }, [chatClient]);

  // Clean up chat client on unmount
  useEffect(() => {
    return () => {
      if (chatClient) {
        chatClient.dispose();
        logger.info('support-chat.disposed');
      }
    };
  }, [chatClient]);

  const launchSupportChat = useCallback(() => {
    // If not initialized yet, initialize first and mark launch as pending
    if (!chatClient && !initializingRef.current) {
      logger.info('support-chat.launch-triggered-init');
      pendingLaunchRef.current = true;
      initializeChatClient();
      return;
    }

    // If currently initializing, mark launch as pending
    if (initializingRef.current) {
      logger.info('support-chat.launch-pending', {
        reason: 'Chat client is initializing',
      });
      pendingLaunchRef.current = true;
      return;
    }

    // If already initialized, launch immediately
    if (chatClient) {
      chatClient.launch();
      logger.info('support-chat.launched');
    }
  }, [chatClient, initializeChatClient]);

  return {
    launchSupportChat,
    isLoading,
  };
}
