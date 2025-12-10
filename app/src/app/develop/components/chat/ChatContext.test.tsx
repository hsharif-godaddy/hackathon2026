import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ChatContext, useChatContext, useSendUserMessage } from './ChatContext';

describe('ChatContext', () => {
  describe('useChatContext', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useChatContext());
      }).toThrow('useChatContext must be used within a ChatProvider');
    });

    it('should return context value when used inside provider', () => {
      const sendMessage = () => {};
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatContext.Provider value={{ sendMessage }}>
          {children}
        </ChatContext.Provider>
      );

      const { result } = renderHook(() => useChatContext(), { wrapper });

      expect(result.current.sendMessage).toBe(sendMessage);
    });
  });

  describe('useSendUserMessage', () => {
    it('should return null when used outside provider', () => {
      const { result } = renderHook(() => useSendUserMessage());

      expect(result.current).toBeNull();
    });

    it('should return sendMessage function when used inside provider', () => {
      const sendMessage = () => {};
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatContext.Provider value={{ sendMessage }}>
          {children}
        </ChatContext.Provider>
      );

      const { result } = renderHook(() => useSendUserMessage(), { wrapper });

      expect(result.current).toBe(sendMessage);
    });
  });
});
