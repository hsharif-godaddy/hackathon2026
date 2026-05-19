/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import PublishClientToolRenderer from './PublishClientToolRenderer';

const mockRequestPublishPopoverOpen = vi.fn();
const mockOpenUpgradeModal = vi.fn();
const mockLoggerError = vi.fn();
let mockPaywallResult = { showPaywall: false, isLoading: false, isError: false, error: null };

const mockDevelopStore: {
  currentAppId: string | null;
  requestPublishPopoverOpen: typeof mockRequestPublishPopoverOpen;
  openUpgradeModal: typeof mockOpenUpgradeModal;
} = {
  currentAppId: 'app-123',
  requestPublishPopoverOpen: mockRequestPublishPopoverOpen,
  openUpgradeModal: mockOpenUpgradeModal,
};

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>, fallback?: string) => fallback ?? key,
}));

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: () => mockPaywallResult,
}));

vi.mock('@/lib/paywall/shared', () => ({
  PAYWALL_ITC: { PUBLISH: 'upp_airo_ai_builder_publish' },
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: typeof mockDevelopStore) => unknown) => selector(mockDevelopStore),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

describe('PublishClientToolRenderer behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.currentAppId = 'app-123';
    mockPaywallResult = { showPaywall: false, isLoading: false, isError: false, error: null };
  });

  it('opens popover when paywall allows access', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-1"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledWith('app-123');
    expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
  });

  it('shows upgrade modal when paywall denies access', () => {
    mockPaywallResult = { showPaywall: true, isLoading: false, isError: false, error: null };

    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-paywall"
        isLastAssistantMessage
      />,
    );

    expect(mockOpenUpgradeModal).toHaveBeenCalledWith('publish', 'upp_airo_ai_builder_publish');
    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
  });

  it('waits for paywall loading before deciding', () => {
    mockPaywallResult = { showPaywall: false, isLoading: true, isError: false, error: null };

    const { rerender } = render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-loading"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
    expect(mockOpenUpgradeModal).not.toHaveBeenCalled();

    // Once loading resolves, should open popover
    mockPaywallResult = { showPaywall: false, isLoading: false, isError: false, error: null };
    rerender(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-loading"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledWith('app-123');
  });

  it('does not act for non-latest assistant messages', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-2"
        isLastAssistantMessage={false}
      />,
    );

    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
    expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
  });

  it('does not act when tool status is completed', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="completed"
        toolId="tool-3"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
    expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
  });

  it('does not act when app id is missing', () => {
    mockDevelopStore.currentAppId = null;
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-no-app"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
    expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
  });

  it('only acts once per tool call', () => {
    const { rerender } = render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-4"
        isLastAssistantMessage
      />,
    );

    rerender(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-4"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledTimes(1);
  });

  it('logs errors when tool status is error', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="error"
        toolId="tool-log-error"
        isLastAssistantMessage
        error="runtime failure"
      />,
    );

    expect(mockLoggerError).toHaveBeenCalledWith('publish-client-tool-renderer.tool-error', {
      appId: 'app-123',
      error: 'runtime failure',
      toolStatus: 'error',
    });
  });

  it('deduplicates identical error logs across toolId changes', () => {
    const { rerender } = render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="error"
        toolId="t1"
        isLastAssistantMessage
        error="E"
      />,
    );

    rerender(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="error"
        toolId="t2"
        isLastAssistantMessage
        error="E"
      />,
    );

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it('shows "Publish failed" when result has success: false', () => {
    const { container } = render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="completed"
        toolId="tool-blocked"
        isLastAssistantMessage
        result={{ success: false, message: 'some error' }}
      />,
    );

    expect(container.textContent).toContain('Publish failed');
    expect(container.textContent).not.toContain('Published successfully');
  });
});
