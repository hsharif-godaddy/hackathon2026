/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { SiteInfo } from '@/lib/control-plane/types';
import { DomainStatus, DomainType } from '@/lib/control-plane/types';
import { createMockSite } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import StreamingIntegratedResponse from './StreamingIntegratedResponse';

const mockLogImpressionEvent = vi.fn();

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string, customProperties?: Record<string, boolean | string | number>) => {
    mockLogImpressionEvent(eid, customProperties);
    return () => {};
  },
}));

let mockSite: SiteInfo | null = null;

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (name: string) => ({
    // Default flags to true, but keep chat plans off so suggestedResponse
    // filtering tests match the flag-off (default) behavior.
    data: name === 'airo-builder-chat-plans' ? false : true,
  }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ data: { id: 'sub-1' }, isLoading: false }),
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: () => ({ data: [] }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openUpgradeModal: vi.fn(), openCreditsModal: vi.fn(), site: mockSite }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('react-intl', async () => {
  const actual = await vi.importActual<typeof import('react-intl')>('react-intl');
  return {
    ...actual,
    useIntl: () => ({
      formatDate: (d: Date, opts?: Record<string, string>) =>
        opts?.month ? 'January' : '12:00 PM',
      formatMessage: () => '',
    }),
  };
});

function budgetExceededMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-budget-1',
    role: 'assistant' as const,
    content: '',
    segments: [],
    timestamp: new Date(),
    budgetExceeded: true,
    ...overrides,
  };
}

describe('StreamingIntegratedResponse', function streamingIntegratedResponseTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockLogImpressionEvent.mockClear();
    mockSite = null;
  });

  describe('budget exceeded impression', function budgetExceededImpression() {
    it('logs impression when budget exceeded is shown', async function logImpressionWhenShown() {
      mockSite = createMockSite({ id: 'test-app-123', variants: ['preview'] });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      await waitFor(function assertImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledWith(
          'chat.budgetExceeded.view',
          expect.objectContaining({
            has_published_app: false,
            has_custom_domain: false,
          })
        );
      });
    });

    it('includes has_published_app true when site has publish variant', async function hasPublishedAppTrue() {
      mockSite = createMockSite({ id: 'test-app-123', variants: ['preview', 'publish'] });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      await waitFor(function assertImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledWith(
          'chat.budgetExceeded.view',
          expect.objectContaining({
            has_published_app: true,
            has_custom_domain: false,
          })
        );
      });
    });

    it('includes has_custom_domain true when site has active custom domain', async function hasCustomDomainTrue() {
      mockSite = createMockSite({
        id: 'test-app-123',
        variants: ['preview'],
        domains: [
          {
            fqdn: 'myapp.example.com',
            domainType: DomainType.CUSTOM,
            status: DomainStatus.ACTIVE,
            isPrimary: true,
            prefix: '',
            createdAt: '',
            updatedAt: '',
          },
        ],
      } as Partial<SiteInfo>);

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      await waitFor(function assertImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledWith(
          'chat.budgetExceeded.view',
          expect.objectContaining({
            has_published_app: false,
            has_custom_domain: true,
          })
        );
      });
    });

    it('does not log impression when message has no budgetExceeded', async function noImpressionWhenNotExceeded() {
      mockSite = createMockSite({ id: 'test-app-123' });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage({ budgetExceeded: false })}
          streamingState="idle"
        />
      );

      await waitFor(function assertNoImpression() {
        expect(document.body).toBeTruthy();
      });

      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('logs impression only once on re-renders', async function singleImpressionOnRerender() {
      mockSite = createMockSite({ id: 'test-app-123' });

      const { rerender } = renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      await waitFor(function assertFirstImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
      });

      rerender(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('action grouping', function actionGroupingTests() {
    it('collapses consecutive compact tool actions by default and expands on click', function collapsesAndExpandsActionGroup() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-actions-1',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'logs',
                  name: 'viewLogs',
                  input: {},
                  status: 'completed'
                }
              },
              {
                id: 'seg-2',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'restart',
                  name: 'serverRestart',
                  input: {},
                  status: 'completed'
                }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'git',
                  name: 'gitOperation',
                  input: {},
                  status: 'completed'
                }
              }
            ]
          }}
          streamingState="idle"
        />
      );

      const toggleButton = screen.getByRole('button', { name: 'Show 3 actions' });
      expect(toggleButton).toBeInTheDocument();
      expect(screen.queryByText('View Logs')).not.toBeInTheDocument();

      fireEvent.click(toggleButton);

      expect(screen.getByRole('button', { name: 'Hide 3 actions' })).toBeInTheDocument();
      expect(screen.getByText('View Logs')).toBeInTheDocument();
      expect(screen.getByText('Server Restart')).toBeInTheDocument();
      expect(screen.getByText('Git Operation')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Hide 3 actions' }));

      expect(screen.queryByText('View Logs')).not.toBeInTheDocument();
    });

    it('does not collapse across rich inline tool boundaries', function respectsRichToolBoundaries() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-actions-2',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'logs',
                  name: 'viewLogs',
                  input: {},
                  status: 'completed'
                }
              },
              {
                id: 'seg-2',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'ask',
                  name: 'askQuestion',
                  input: {},
                  status: 'completed',
                  result: {
                    question: 'Need more detail?',
                    options: [
                      { label: 'Yes', value: 'yes' }
                    ]
                  }
                }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'restart',
                  name: 'serverRestart',
                  input: {},
                  status: 'completed'
                }
              },
              {
                id: 'seg-4',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'git',
                  name: 'gitOperation',
                  input: {},
                  status: 'completed'
                }
              }
            ]
          }}
          streamingState="idle"
        />
      );

      expect(screen.getByRole('button', { name: 'Show 2 actions' })).toBeInTheDocument();
      expect(screen.getByText('View Logs')).toBeInTheDocument();
    });

    it('filters suggestedResponse so it does not split action groups when not last assistant message', function suggestedResponseFilteredWhenNotLast() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-sr-1',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'read1', name: 'fileRead', input: {}, status: 'completed' }
              },
              {
                id: 'seg-2',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'sr1', name: 'suggestedResponse', input: {}, status: 'completed' }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'edit1', name: 'fileEdit', input: {}, status: 'completed' }
              }
            ]
          }}
          isLastAssistantMessage={false}
          streamingState="idle"
        />
      );

      // All three tools should be in one group (suggestedResponse filtered, not a boundary)
      expect(screen.getByRole('button', { name: 'Show 2 actions' })).toBeInTheDocument();
    });

    it('preserves suggestedResponse in blocks when it is the last assistant message', function suggestedResponsePreservedWhenLast() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-sr-2',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'read1', name: 'fileRead', input: {}, status: 'completed' }
              },
              {
                id: 'seg-2',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'sr1', name: 'suggestedResponse', input: {}, status: 'completed' }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'edit1', name: 'fileEdit', input: {}, status: 'completed' }
              }
            ]
          }}
          isLastAssistantMessage={true}
          streamingState="idle"
        />
      );

      // suggestedResponse is NOT filtered — it acts as a boundary, so fileRead is standalone
      // and fileEdit is standalone (no group of 2+ consecutive eligible tools)
      expect(screen.queryByRole('button', { name: /actions/ })).not.toBeInTheDocument();
    });

    it('keeps completed tools grouped while trailing running tool renders standalone', function staysCollapsedWhileStreaming() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-actions-3',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_result',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'logs',
                  name: 'viewLogs',
                  input: {},
                  status: 'completed'
                }
              },
              {
                id: 'seg-2',
                type: 'tool_result',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'git',
                  name: 'gitOperation',
                  input: {},
                  status: 'completed'
                }
              },
              {
                id: 'seg-3',
                type: 'tool_start',
                content: '',
                timestamp: new Date(),
                toolCall: {
                  id: 'restart',
                  name: 'serverRestart',
                  input: {},
                  status: 'running'
                }
              }
            ]
          }}
          isActiveStream={true}
          streamingState="streaming"
        />
      );

      // Completed tools are grouped and collapsed
      const toggleButton = screen.getByRole('button', { name: 'Show 2 actions' });
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

      // Running tool renders standalone (visible outside the group)
      expect(screen.getByText('Server Restart')).toBeInTheDocument();
    });
  });
});
