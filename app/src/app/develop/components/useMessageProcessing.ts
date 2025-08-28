'use client';

import { useState, useEffect, useRef } from 'react';
import { Message } from './types';

/**
 * Hook that monitors the loading state of messages, using the same logic
 * that the messageService.ts uses to determine if processing is active.
 * 
 * This hook ensures the processing indicator only shows during active WebSocket
 * communication and not on page refresh or initial load.
 */
export function useMessageProcessing(messages: Message[], isLoading: boolean): boolean {
  const [isProcessing, setIsProcessing] = useState(false);
  const hasActiveWebSocketRef = useRef(false);
  
  // Track when we've seen a WebSocket connection start
  useEffect(() => {
    if (isLoading) {
      hasActiveWebSocketRef.current = true;
    }
  }, [isLoading]);
  
  useEffect(() => {
    // Only consider processing if we've had at least one WebSocket connection during this session
    if (!hasActiveWebSocketRef.current) {
      setIsProcessing(false);
      return;
    }
    
    // If the app is in loading state, we're definitely processing
    if (isLoading) {
      setIsProcessing(true);
      return;
    }

    // If not loading, check the latest agent message to see if it's marked as complete
    const lastAgentMessage = [...messages]
      .reverse()
      .find(msg => msg.sender === 'agent');
    
    if (lastAgentMessage) {
      // A message is considered "done processing" only when:
      // 1. It has is_complete = true, AND
      // 2. It has response_duration_ms (which is set in the 'complete' WebSocket event)
      const isDoneProcessing = 
        lastAgentMessage.is_complete && 
        lastAgentMessage.response_duration_ms !== undefined;
      
      // If we've had a WebSocket connection in this session and the last message isn't complete,
      // we're still processing
      setIsProcessing(!isDoneProcessing);
    } else {
      // No agent messages yet, but a WebSocket connection is active; not processing
      setIsProcessing(false);
    }
  }, [messages, isLoading]);

  return isProcessing;
}