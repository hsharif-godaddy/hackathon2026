/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import InboxIframe from './InboxIframe';

vi.mock('@/hooks/usePusher', () => ({
  usePusher: () => ({ isConnected: false, isAuthenticating: false, error: null }),
}));

const mockUseConversationId = vi.fn();
vi.mock('@/hooks/useConversationId', () => ({
  useConversationId: () => mockUseConversationId(),
}));

describe('InboxIframe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes conversationId as data-conversation-id when present', () => {
    mockUseConversationId.mockReturnValue('conv-abc');

    render(<InboxIframe brandId="brand-1" accountId="acct-1" />);

    expect(screen.getByTitle('Airo Inbox')).toHaveAttribute('data-conversation-id', 'conv-abc');
  });

  it('omits data-conversation-id when there is no conversationId', () => {
    mockUseConversationId.mockReturnValue(null);

    render(<InboxIframe brandId="brand-1" accountId="acct-1" />);

    expect(screen.getByTitle('Airo Inbox')).not.toHaveAttribute('data-conversation-id');
  });
});
