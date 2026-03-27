/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

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
  useSwitchboard: () => ({ data: true }),
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
});
