import '@testing-library/jest-dom';

import { beforeEach,describe, expect,it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import * as translationsHook from '@/hooks/useTranslations';
import * as streamingStore from '@/stores/useStreamingConversationStore';
import { renderWithProviders } from '@/tests/test-utils';
import ThinkingIndicator from './ThinkingIndicator';

describe('ThinkingIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(translationsHook, 'useTranslations').mockReturnValue(
      (id: string, values?: Record<string, any>, defaultMessage?: string) => {
        if (id === 'builder_agent_thinking' && values?.agentName) {
          return `${values.agentName} is thinking`;
        }
        if (id === 'builder_default_agent_name') {
          return 'Airo Developer';
        }
        return defaultMessage || id;
      }
    );
  });

  it('should render without crashing with default agent', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue(null);
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('Airo Developer is thinking')).toBeInTheDocument();
  });

  it('should display default thinking message when currentAgentName is null', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue(null);
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('Airo Developer is thinking')).toBeInTheDocument();
  });

  it('should display custom agent name when currentAgentName is set', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue('Marketing Agent');
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('Marketing Agent is thinking')).toBeInTheDocument();
  });

  it('should map "AI Developer" to "Airo Developer" for consistency', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue('AI Developer');
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('Airo Developer is thinking')).toBeInTheDocument();
  });

  it('should use actual agent name for non-mapped agents', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue('Commerce Agent');
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('Commerce Agent is thinking')).toBeInTheDocument();
  });

  it('should render animated dots', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue(null);
    const { container } = renderWithProviders(<ThinkingIndicator />);

    // Should have 3 animated dots
    const dots = container.querySelectorAll('.animate-bounce');
    expect(dots.length).toBe(3);
  });

  it('should have correct animation delays on dots', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue(null);
    const { container } = renderWithProviders(<ThinkingIndicator />);

    const dots = container.querySelectorAll('.animate-bounce');

    // First dot has no delay
    expect(dots[0]).not.toHaveStyle({ animationDelay: '0.1s' });

    // Second dot has 0.1s delay
    expect(dots[1]).toHaveStyle({ animationDelay: '0.1s' });

    // Third dot has 0.2s delay
    expect(dots[2]).toHaveStyle({ animationDelay: '0.2s' });
  });

  it('should render with correct structure', () => {
    vi.spyOn(streamingStore, 'useCurrentAgentName').mockReturnValue(null);
    const { container } = renderWithProviders(<ThinkingIndicator />);

    // Should have main container
    const mainContainer = container.querySelector('.flex.items-center.gap-2');
    expect(mainContainer).toBeInTheDocument();

    // Should have message container
    const messageContainer = container.querySelector('.bg-ai-light\\/40');
    expect(messageContainer).toBeInTheDocument();
  });
});
