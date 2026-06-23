/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetErrorType } from '@airo/shared/budget';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { SiteInfo } from '@/lib/control-plane/types';
import { DomainStatus, DomainType } from '@/lib/control-plane/types';
import { createMockSite } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import StreamingIntegratedResponse from './StreamingIntegratedResponse';

const mockLogImpressionEvent = vi.fn();
const mockResponseMetadata = vi.fn();

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string, customProperties?: Record<string, boolean | string | number>) => {
    mockLogImpressionEvent(eid, customProperties);
    return () => {};
  },
}));

vi.mock('@/app/[market]/develop/components/ResponseMetadata', () => ({
  default: (props: Record<string, unknown>) => {
    mockResponseMetadata(props);
    return <div data-testid="response-metadata-stub" />;
  },
}));

let mockSite: SiteInfo | null = null;

vi.mock('@/hooks/useSwitchboard', () => ({
  // Default flags to true, but keep chat plans off so suggestedResponse
  // filtering tests match the flag-off (default) behavior.
  useSwitchboard: (name: string) => name !== 'airo-builder-chat-plans',
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

// Mock auth context — default to non-impersonation session
const mockAuthContextState: { tokenAuthType: string | undefined } = { tokenAuthType: undefined };
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContextState,
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

function upstreamErrorMessage(errorType: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-upstream-1',
    role: 'assistant' as const,
    content: '',
    segments: [],
    timestamp: new Date(),
    upstreamError: true,
    errorType,
    error: 'Test error message',
    ...overrides,
  };
}

describe('StreamingIntegratedResponse', function streamingIntegratedResponseTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockLogImpressionEvent.mockClear();
    mockSite = null;
    // Reset auth context mock to non-impersonation session
    mockAuthContextState.tokenAuthType = undefined;
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

  describe('CRM skip / impersonation session', function impersonationTests() {
    it('hides budget exceeded banner and suppresses impression for e2s session', function e2sBudgetBannerHidden() {
      mockAuthContextState.tokenAuthType = 'e2s';
      mockSite = createMockSite({ id: 'test-app-123' });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('hides budget exceeded banner and suppresses impression for e2s2s session', function e2s2sBudgetBannerHidden() {
      mockAuthContextState.tokenAuthType = 'e2s2s';
      mockSite = createMockSite({ id: 'test-app-123' });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('shows budget exceeded banner for basic auth session', function basicAuthBannerShown() {
      mockAuthContextState.tokenAuthType = 'basic';
      mockSite = createMockSite({ id: 'test-app-123' });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
    });

    it('shows budget exceeded banner when tokenAuthType is undefined', function undefinedTokenAuthTypeBannerShown() {
      mockAuthContextState.tokenAuthType = undefined;
      mockSite = createMockSite({ id: 'test-app-123' });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={budgetExceededMessage()}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
    });
  });

  describe('budget service error handling', function budgetServiceErrorTests() {
    it('shows generic error for BUDGET_NOT_FOUND errorType', function budgetNotFoundError() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage(BudgetErrorType.BUDGET_NOT_FOUND)}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('builder_bms_error_title')).not.toBeInTheDocument();
    });

    it('shows generic error for BUDGET_SERVICE_UNAVAILABLE errorType', function budgetServiceUnavailableError() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage(BudgetErrorType.BUDGET_SERVICE_UNAVAILABLE)}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('builder_bms_error_title')).not.toBeInTheDocument();
    });

    it('shows generic error for BUDGET_SERVICE_ERROR errorType', function budgetServiceError() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage(BudgetErrorType.BUDGET_SERVICE_ERROR)}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('builder_bms_error_title')).not.toBeInTheDocument();
    });

    it('shows generic error for BUDGET_SERVICE_AUTH_ERROR errorType', function budgetServiceAuthError() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage(BudgetErrorType.BUDGET_SERVICE_AUTH_ERROR)}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('builder_bms_error_title')).not.toBeInTheDocument();
    });

    it('shows generic error for unhandled budget error types', function genericErrorFallthrough() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage(BudgetErrorType.BUDGET_NO_CAPACITY)}
          streamingState="idle"
        />
      );

      // BUDGET_NO_CAPACITY uses the same generic upstream error copy as other BMS types
      expect(screen.queryByText('builder_bms_error_title')).not.toBeInTheDocument();
      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('Test error message')).not.toBeInTheDocument();
    });

    it('shows BudgetExceededBanner instead of BMS error when both budgetExceeded and errorType are present', function budgetExceededTakesPrecedence() {
      mockSite = createMockSite({ id: 'test-app-123' });

      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage(BudgetErrorType.BUDGET_NOT_FOUND, { budgetExceeded: true })}
          streamingState="idle"
        />
      );

      // budgetExceeded should win - BMS error banner should NOT appear
      expect(screen.queryByText('builder_bms_error_title')).not.toBeInTheDocument();
      // BudgetExceededBanner should be shown instead
      expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
    });
  });

  describe('retry upstream error', function retryUpstreamErrorTests() {
    it('shows friendly copy for RETRY_ERROR without leaking retryReason or raw error', function retryErrorFriendlyCopy() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('RETRY_ERROR', {
            error: 'retry failed',
            retryAttempts: 2,
            retryReason: 'maxRetriesExceeded',
          })}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('maxRetriesExceeded')).not.toBeInTheDocument();
      expect(screen.queryByText('retry failed')).not.toBeInTheDocument();
      expect(screen.queryByText(/Failed after \d+ attempts/)).not.toBeInTheDocument();
    });

    it('shows friendly copy for RETRY_ERROR even without retryAttempts', function retryErrorWithoutAttempts() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('RETRY_ERROR', { error: 'Fresh retry error' })}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('Fresh retry error')).not.toBeInTheDocument();
    });
  });

  describe('connection dropped upstream error', function connectionDroppedErrorTests() {
    it('shows friendly copy when upstream error message is terminated', function terminatedConnectionDropped() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('UPSTREAM_ERROR', { error: 'terminated' })}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_connection_dropped_title')).toBeInTheDocument();
      expect(screen.getByText('builder_connection_dropped_message')).toBeInTheDocument();
      expect(screen.queryByText('Error')).not.toBeInTheDocument();
      expect(screen.queryByText('terminated')).not.toBeInTheDocument();
    });

    it('suppresses the connection-dropped banner when content already arrived', function terminatedWithContent() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('UPSTREAM_ERROR', {
            error: 'terminated',
            segments: [
              {
                id: 'seg-text-1',
                type: 'text',
                content: 'Here is your answer.',
                timestamp: new Date(),
              },
            ],
          })}
          streamingState="idle"
        />
      );

      // Content renders…
      expect(screen.getByText('Here is your answer.')).toBeInTheDocument();
      // …but the alarming banner does NOT.
      expect(screen.queryByText('builder_connection_dropped_title')).not.toBeInTheDocument();
    });

    it('shows generic error for other unclassified upstream errors', function genericUpstreamError() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('UPSTREAM_ERROR', { error: 'Something went wrong' })}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_connection_dropped_title')).not.toBeInTheDocument();
    });

    it('shows timeout copy for upstream errors with 408 or 504 status', function upstreamTimeoutStatus() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('UPSTREAM_ERROR', { error: 'Gateway Time-out', errorCode: 504 })}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_chat_error_timeout')).toBeInTheDocument();
      expect(screen.queryByText('builder_common_error_generic')).not.toBeInTheDocument();
      expect(screen.queryByText('Gateway Time-out')).not.toBeInTheDocument();
    });

    it('shows generic error for gateway timeout text without status code', function gatewayTimeoutWithoutStatus() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('UPSTREAM_ERROR', { error: 'Gateway Time-out' })}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      expect(screen.queryByText('builder_chat_error_timeout')).not.toBeInTheDocument();
      expect(screen.queryByText('Gateway Time-out')).not.toBeInTheDocument();
    });

    it('shows the stream-error banner for STREAM_TYPE_VALIDATION', function streamTypeValidationError() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('STREAM_TYPE_VALIDATION')}
          streamingState="idle"
        />
      );

      expect(screen.getByText('builder_common_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_stream_error_message')).toBeInTheDocument();
      expect(screen.queryByText('builder_stream_error_title')).not.toBeInTheDocument();
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
                  id: 'color',
                  name: 'colorScheme',
                  input: { mode: 'suggest' },
                  status: 'completed',
                  result: {
                    palettes: [{ name: 'Ocean', colors: ['#0066cc'] }]
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

    it('dedupes blocks when the same tool id appears in multiple tool_call segments', function dedupesDuplicateToolCallSegments() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-dup-tool-call',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'logs', name: 'viewLogs', input: {}, status: 'completed' }
              },
              {
                id: 'seg-2',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'logs', name: 'viewLogs', input: {}, status: 'completed', result: { lines: [] } }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'restart', name: 'serverRestart', input: {}, status: 'completed' }
              }
            ]
          }}
          streamingState="idle"
        />
      );

      // Only two unique tool ids → two grouped actions, not three. Without
      // dedup, the duplicate `logs` segment would push a third block and the
      // group label would read 'Show 3 actions'.
      expect(screen.getByRole('button', { name: 'Show 2 actions' })).toBeInTheDocument();
    });

    it('dedupes blocks when tool_call comes before tool_start with the same id', function dedupesToolCallThenToolStart() {
      // tool_start arriving after tool_call flows through the streaming branch
      // and must read the toolCallsMap entry that the tool_call branch
      // populated. Without the dedup added in the tool_call branch the map
      // lookup would miss and a second block would render with the same id.
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-tool-call-then-start',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'logs', name: 'viewLogs', input: {}, status: 'completed', result: { lines: [] } }
              },
              {
                id: 'seg-2',
                type: 'tool_start',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'logs', name: 'viewLogs', input: { query: 'errors' }, status: 'running' }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'restart', name: 'serverRestart', input: {}, status: 'completed' }
              }
            ]
          }}
          streamingState="idle"
        />
      );

      expect(screen.getByRole('button', { name: 'Show 2 actions' })).toBeInTheDocument();
    });

    it('hides setWizardStep and does not let it split an action group', function hidesSetWizardStepInGroup() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-wizard-1',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'logs', name: 'viewLogs', input: {}, status: 'completed' }
              },
              {
                id: 'seg-2',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'wizard', name: 'setWizardStep', input: { step: 3 }, status: 'completed' }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'restart', name: 'serverRestart', input: {}, status: 'completed' }
              }
            ]
          }}
          streamingState="idle"
        />
      );

      // setWizardStep is filtered before grouping, so viewLogs + serverRestart
      // collapse into one 2-action group — proving the wizard tool neither
      // rendered nor acted as a group boundary.
      expect(screen.getByRole('button', { name: 'Show 2 actions' })).toBeInTheDocument();
    });

    it('renders nothing for a lone setWizardStep tool call (raw-segment fallback path)', function hidesLoneSetWizardStep() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-wizard-2',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'wizard', name: 'setWizardStep', input: { step: 1 }, status: 'completed' }
              }
            ]
          }}
          streamingState="idle"
        />
      );

      // With the only tool filtered out, chronologicalContent is empty and the
      // component falls back to rendering raw segments via MessageToolCallsRenderer —
      // which must also suppress the system tool (DefaultToolRenderer would
      // otherwise show a "SetWizardStep" row).
      expect(screen.queryByText(/SetWizardStep/i)).not.toBeInTheDocument();
    });

    it('dedupes blocks when tool_start and tool_call segments share an id', function dedupesAcrossSegmentTypes() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-dup-mixed',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_start',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'logs', name: 'viewLogs', input: {}, status: 'running' }
              },
              {
                id: 'seg-2',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'logs', name: 'viewLogs', input: {}, status: 'completed' }
              },
              {
                id: 'seg-3',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'restart', name: 'serverRestart', input: {}, status: 'completed' }
              }
            ]
          }}
          streamingState="idle"
        />
      );

      expect(screen.getByRole('button', { name: 'Show 2 actions' })).toBeInTheDocument();
    });
  });

  describe('response metadata', function responseMetadata() {
    it('passes message metadata to ResponseMetadata for persisted feedback', function messageMetadataProp() {
      mockResponseMetadata.mockClear();
      const startTime = new Date('2026-01-01T00:00:00.000Z');

      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-complete-1',
            role: 'assistant',
            content: 'All done',
            timestamp: new Date('2026-01-01T00:01:00.000Z'),
            metadata: { feedback: 'negative' },
          }}
          startTime={startTime}
          streamingState="idle"
        />
      );

      expect(screen.getByTestId('response-metadata-stub')).toBeInTheDocument();
      expect(mockResponseMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-complete-1',
          messageMetadata: { feedback: 'negative' },
        })
      );
    });

    it('passes segment-derived content when message.content is empty', function segmentDerivedContent() {
      mockResponseMetadata.mockClear();
      const startTime = new Date('2026-01-01T00:00:00.000Z');

      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-segments-1',
            role: 'assistant',
            content: '',
            timestamp: new Date('2026-01-01T00:01:00.000Z'),
            segments: [
              {
                id: 'seg-text-1',
                type: 'text',
                content: 'Built from segments.',
                timestamp: new Date(),
              },
            ],
          }}
          startTime={startTime}
          streamingState="idle"
        />
      );

      expect(mockResponseMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-segments-1',
          content: 'Built from segments.',
        })
      );
      expect(mockResponseMetadata.mock.calls[0]?.[0]).not.toHaveProperty('isMessageContentEmpty');
    });

    it('passes empty content when the response has no text segments', function noTextSegments() {
      mockResponseMetadata.mockClear();
      const startTime = new Date('2026-01-01T00:00:00.000Z');

      renderWithProviders(
        <StreamingIntegratedResponse
          message={{
            id: 'msg-tools-only-1',
            role: 'assistant',
            content: '',
            timestamp: new Date('2026-01-01T00:01:00.000Z'),
            segments: [
              {
                id: 'seg-1',
                type: 'tool_call',
                content: '',
                timestamp: new Date(),
                toolCall: { id: 'read1', name: 'fileRead', input: {}, status: 'completed' },
              },
            ],
          }}
          startTime={startTime}
          streamingState="idle"
        />
      );

      expect(mockResponseMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-tools-only-1',
          content: '',
        })
      );
    });
  });
});
