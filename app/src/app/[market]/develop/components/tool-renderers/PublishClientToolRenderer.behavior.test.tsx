/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import PublishClientToolRenderer from './PublishClientToolRenderer';

const mockRequestPublishPopoverOpen = vi.fn();
const mockLoggerError = vi.fn();

// checkAndShowPaywall is the shared gate (usePaywallModal). By default it runs the
// passed action (paywall allows). Tests override it to simulate a deny.
const mockCheckAndShowPaywall = vi.fn(async (action: () => Promise<void>) => {
  await action();
});

interface MockPaywallModal {
  checkAndShowPaywall: typeof mockCheckAndShowPaywall;
  paywallModal: ReactElement | null;
  shouldShowPaywall: boolean;
  isPaywallLoading: boolean;
  isPublishLimitLoading: boolean;
}

let mockPaywallModal: MockPaywallModal = {
  checkAndShowPaywall: mockCheckAndShowPaywall,
  paywallModal: null,
  shouldShowPaywall: false,
  isPaywallLoading: false,
  isPublishLimitLoading: false,
};

const mockDevelopStore: {
  currentAppId: string | null;
  requestPublishPopoverOpen: typeof mockRequestPublishPopoverOpen;
} = {
  currentAppId: 'app-123',
  requestPublishPopoverOpen: mockRequestPublishPopoverOpen,
};

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: Record<string, unknown>, fallback?: string) => fallback ?? key,
}));

vi.mock('@/hooks/usePaywallModal', () => ({
  usePaywallModal: () => mockPaywallModal,
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

function renderRunning(toolId: string, extra: Record<string, unknown> = {}) {
  return render(
    <PublishClientToolRenderer
      toolName="publishClient"
      toolStatus="running"
      toolId={toolId}
      isLastAssistantMessage
      {...extra}
    />,
  );
}

describe('PublishClientToolRenderer behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.currentAppId = 'app-123';
    mockPaywallModal = {
      checkAndShowPaywall: mockCheckAndShowPaywall,
      paywallModal: null,
      shouldShowPaywall: false,
      isPaywallLoading: false,
      isPublishLimitLoading: false,
    };
  });

  it('runs the publish gate and opens the popover when the gate allows access', async () => {
    await act(async () => {
      renderRunning('tool-1');
    });

    expect(mockCheckAndShowPaywall).toHaveBeenCalledTimes(1);
    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledWith('app-123');
  });

  it('does not open the popover when the gate withholds the action (paywall shown)', async () => {
    // Simulate a deny: the gate decides to paywall and never invokes the action.
    mockPaywallModal.checkAndShowPaywall = vi.fn(async () => {});
    mockPaywallModal.paywallModal = <div data-testid="paywall" />;

    const { getByTestId } = await act(async () => renderRunning('tool-paywall'));

    expect(mockPaywallModal.checkAndShowPaywall).toHaveBeenCalledTimes(1);
    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
    expect(getByTestId('paywall')).toBeInTheDocument();
  });

  it('waits for paywall eligibility loading before invoking the gate', async () => {
    mockPaywallModal.isPaywallLoading = true;

    const { rerender } = render(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="running" toolId="tool-loading" isLastAssistantMessage />,
    );

    expect(mockCheckAndShowPaywall).not.toHaveBeenCalled();

    mockPaywallModal.isPaywallLoading = false;
    await act(async () => {
      rerender(
        <PublishClientToolRenderer toolName="publishClient" toolStatus="running" toolId="tool-loading" isLastAssistantMessage />,
      );
    });

    expect(mockCheckAndShowPaywall).toHaveBeenCalledTimes(1);
    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledWith('app-123');
  });

  it('waits for publish-limit loading before invoking the gate', async () => {
    mockPaywallModal.isPublishLimitLoading = true;

    const { rerender } = render(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="running" toolId="tool-limit-loading" isLastAssistantMessage />,
    );

    expect(mockCheckAndShowPaywall).not.toHaveBeenCalled();

    mockPaywallModal.isPublishLimitLoading = false;
    await act(async () => {
      rerender(
        <PublishClientToolRenderer toolName="publishClient" toolStatus="running" toolId="tool-limit-loading" isLastAssistantMessage />,
      );
    });

    expect(mockCheckAndShowPaywall).toHaveBeenCalledTimes(1);
  });

  it('does not act for non-latest assistant messages', () => {
    render(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="running" toolId="tool-2" isLastAssistantMessage={false} />,
    );

    expect(mockCheckAndShowPaywall).not.toHaveBeenCalled();
    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
  });

  it('does not act when tool status is completed', () => {
    render(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="completed" toolId="tool-3" isLastAssistantMessage />,
    );

    expect(mockCheckAndShowPaywall).not.toHaveBeenCalled();
    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
  });

  it('does not act when app id is missing', () => {
    mockDevelopStore.currentAppId = null;
    render(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="running" toolId="tool-no-app" isLastAssistantMessage />,
    );

    expect(mockCheckAndShowPaywall).not.toHaveBeenCalled();
    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
  });

  it('only acts once per tool call', async () => {
    const { rerender } = await act(async () => renderRunning('tool-4'));

    await act(async () => {
      rerender(
        <PublishClientToolRenderer toolName="publishClient" toolStatus="running" toolId="tool-4" isLastAssistantMessage />,
      );
    });

    expect(mockCheckAndShowPaywall).toHaveBeenCalledTimes(1);
    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledTimes(1);
  });

  it('logs errors when tool status is error', () => {
    render(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="error" toolId="tool-log-error" isLastAssistantMessage error="runtime failure" />,
    );

    expect(mockLoggerError).toHaveBeenCalledWith('publish-client-tool-renderer.tool-error', {
      appId: 'app-123',
      error: 'runtime failure',
      toolStatus: 'error',
    });
  });

  it('deduplicates identical error logs across toolId changes', () => {
    const { rerender } = render(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="error" toolId="t1" isLastAssistantMessage error="E" />,
    );

    rerender(
      <PublishClientToolRenderer toolName="publishClient" toolStatus="error" toolId="t2" isLastAssistantMessage error="E" />,
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
