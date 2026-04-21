/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import PostPublishPreLaunchSeoPrompt from '@/app/[market]/develop/components/chat/PostPublishPreLaunchSeoPrompt';
import { renderWithProviders } from '@/tests/test-utils';

const sendUserMessage = vi.fn(() => Promise.resolve());

vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: ComponentProps<'button'>) => (
      <button type="button" {...props}>{children}</button>
    ),
  },
}));

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: () => sendUserMessage,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('PostPublishPreLaunchSeoPrompt', () => {
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sendUserMessage.mockImplementation(() => Promise.resolve());
  });

  it('sends action message and dismisses when Run SEO check is clicked', async function seoOptionSubmits() {
    const { user } = renderWithProviders(
      <PostPublishPreLaunchSeoPrompt appId="app-1" onDismiss={onDismiss} />,
    );

    await user.click(screen.getByRole('button', { name: /Run SEO check/i }));

    await waitFor(() => {
      expect(sendUserMessage).toHaveBeenCalledWith(
        'Run an SEO check on my site and suggest improvements to help me rank better in search results.',
        { isActionRequest: true },
      );
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('dismisses when Cancel is clicked without sending', async function cancelDismisses() {
    const { user } = renderWithProviders(
      <PostPublishPreLaunchSeoPrompt appId="app-1" onDismiss={onDismiss} />,
    );

    await user.click(screen.getByRole('button', { name: 'builder_golive_select_button_cancel' }));

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });
});
