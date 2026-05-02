/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import PublishClientToolRenderer from './PublishClientToolRenderer';

const mockRequestPublishPopoverOpen = vi.fn();
const mockLoggerError = vi.fn();
const mockDevelopStore: {
  currentAppId: string | null;
  requestPublishPopoverOpen: typeof mockRequestPublishPopoverOpen;
} = {
  currentAppId: 'app-123',
  requestPublishPopoverOpen: mockRequestPublishPopoverOpen,
};

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>, fallback?: string) => fallback ?? key,
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
  });

  it('requests AppPublish popover when latest publish tool is running', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-1"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledWith('app-123');
    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledTimes(1);
  });

  it('does not request popover for non-latest assistant messages', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-2"
        isLastAssistantMessage={false}
      />,
    );

    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
  });

  it('does not request popover when tool status is completed', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="completed"
        toolId="tool-3"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
  });

  it('does not request AppPublish popover when latest publish tool errors', () => {
    render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="error"
        toolId="tool-error"
        isLastAssistantMessage
        error="publish failed"
      />,
    );

    expect(mockRequestPublishPopoverOpen).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith('publish-client-tool-renderer.tool-error', {
      appId: 'app-123',
      error: 'publish failed',
      toolStatus: 'error',
    });
  });

  it('does not request popover again on running to error transition and logs error', () => {
    const { rerender } = render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-running-error"
        isLastAssistantMessage
      />,
    );

    rerender(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="error"
        toolId="tool-running-error"
        isLastAssistantMessage
        error="runtime failure"
      />,
    );

    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith('publish-client-tool-renderer.tool-error', {
      appId: 'app-123',
      error: 'runtime failure',
      toolStatus: 'error',
    });
  });

  it('does not request popover when app id is missing', () => {
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

  it('requests popover once per tool call while status remains running', () => {
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

  it('does not trigger a second open on running to completed transition', () => {
    const { rerender } = render(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="running"
        toolId="tool-transition"
        isLastAssistantMessage
      />,
    );

    rerender(
      <PublishClientToolRenderer
        toolName="publishClient"
        toolStatus="completed"
        toolId="tool-transition"
        isLastAssistantMessage
      />,
    );

    expect(mockRequestPublishPopoverOpen).toHaveBeenCalledTimes(1);
  });
});
