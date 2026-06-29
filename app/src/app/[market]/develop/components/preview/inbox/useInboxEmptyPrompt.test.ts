/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types';
import type { InboxEmptyStateCta } from './inboxEmptyState';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  logClickEvent: vi.fn(() => vi.fn()),
  isStreaming: false,
  isLoading: false,
  isMobile: false,
  handleMobileModeChange: vi.fn(),
  setActiveChatTab: vi.fn(),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}));

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: mocks.logClickEvent,
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({ sendMessage: mocks.sendMessage }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => mocks.isStreaming,
  useIsLoading: () => mocks.isLoading,
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: unknown) => unknown) =>
    selector({
      isMobile: mocks.isMobile,
      handleMobileModeChange: mocks.handleMobileModeChange,
      setActiveChatTab: mocks.setActiveChatTab,
    }),
}));

import { useInboxEmptyPrompt } from './useInboxEmptyPrompt';

const chatCta: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_chat',
  eid: 'inbox.empty.cta.add_chat',
  testId: 'inbox-empty-cta-add-chat',
  promptKey: 'builder_inbox_empty_prompt_add_chat',
};

describe('useInboxEmptyPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.isStreaming = false;
    mocks.isLoading = false;
    mocks.isMobile = false;
  });

  it('sends the localized prompt as an action request and logs the click', () => {
    const clickThunk = vi.fn();
    mocks.logClickEvent.mockReturnValueOnce(clickThunk);
    const { result } = renderHook(() => useInboxEmptyPrompt());

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.logClickEvent).toHaveBeenCalledWith('inbox.empty.cta.add_chat');
    expect(clickThunk).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      content: 't:builder_inbox_empty_prompt_add_chat',
      isActionRequest: true,
    });
  });

  it('does not switch the view on desktop', () => {
    const { result } = renderHook(() => useInboxEmptyPrompt());

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.handleMobileModeChange).not.toHaveBeenCalled();
    expect(mocks.setActiveChatTab).not.toHaveBeenCalled();
  });

  it('switches to the chat tools on mobile', () => {
    mocks.isMobile = true;
    const { result } = renderHook(() => useInboxEmptyPrompt());

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.handleMobileModeChange).toHaveBeenCalledWith(MobileMode.TOOLS);
    expect(mocks.setActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT);
  });

  it('is a no-op while a stream is processing', () => {
    mocks.isStreaming = true;
    const { result } = renderHook(() => useInboxEmptyPrompt());

    expect(result.current.isProcessing).toBe(true);

    act(() => result.current.handleCtaClick(chatCta));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.logClickEvent).not.toHaveBeenCalled();
  });
});
