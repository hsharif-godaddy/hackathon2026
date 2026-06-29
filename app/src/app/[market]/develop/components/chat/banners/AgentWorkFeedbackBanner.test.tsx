/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import AgentWorkFeedbackBanner from './AgentWorkFeedbackBanner';

const mockLogImpression = vi.fn(function (_eid: string) { return vi.fn(); });
const mockLogClick = vi.fn(function (_eid: string) { return vi.fn(); });
const mockShipAnalyticsLog = vi.fn();
const mockMarkSubmitted = vi.fn();
const mockSetShowBanner = vi.fn();

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (id: string) => mockLogImpression(id),
  logClickEvent: (id: string) => mockLogClick(id),
  generateClickEID: (id: string) => id,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}));

vi.mock('@/hooks/chat/useChatHelpers', () => ({
  getConversationIdFromCookie: () => 'conv-1',
}));

const mockAgentFetch = vi.fn();
vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (url: string, options: RequestInit & { siteId: string }) => mockAgentFetch(url, options),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ baseUrl: 'http://agents.test' }),
  },
}));

let mockAgentTargetId: string | null = 'airo-app-builder-InitialAgent';
let mockTraceIds: { traceId: string; observationId: string } | null = {
  traceId: 'trace-1',
  observationId: 'obs-1',
};

const mockShowThanksBanner = vi.fn();

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        currentAppId: 'app-1',
        agentWorkFeedbackAgentId: mockAgentTargetId,
        agentWorkFeedbackTraceIds: mockTraceIds,
        agentWorkFeedbackRevealMilestone: 'logoDownload',
        markAgentWorkFeedbackSubmitted: mockMarkSubmitted,
        setShowAgentWorkFeedbackBanner: mockSetShowBanner,
        showResponseFeedbackThanksBannerTemporarily: mockShowThanksBanner,
      }),
    {
      getState: () => ({
        agentWorkFeedbackRevealMilestone: 'logoDownload',
        showResponseFeedbackThanksBannerTemporarily: mockShowThanksBanner,
      }),
    }
  ),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      availableAgents: [{ id: 'InitialAgent', name: 'Initial Agent' }],
      currentAgentName: 'InitialAgent',
    }),
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}));

describe('AgentWorkFeedbackBanner', function bannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue({ ok: true, status: 200 });
    mockAgentTargetId = 'airo-app-builder-InitialAgent';
    mockTraceIds = { traceId: 'trace-1', observationId: 'obs-1' };
  });

  it('returns null when agentTargetId is missing', function noAgent() {
    mockAgentTargetId = null;
    const { container } = renderWithProviders(<AgentWorkFeedbackBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('logs an impression and renders the agent-work banner', function render() {
    renderWithProviders(<AgentWorkFeedbackBanner />);
    expect(mockLogImpression).toHaveBeenCalledWith('skill-invoke.feedback.view');
    expect(screen.getByTestId('agent-work-feedback-banner')).toBeInTheDocument();
    expect(screen.getByTestId('agent-work-feedback-prompt')).toBeInTheDocument();
  });

  it('submits positive feedback with invocation target level', async function positive() {
    const { user } = renderWithProviders(<AgentWorkFeedbackBanner />);

    const thumbsUp = document.querySelector('[data-eid="chat.response_metadata.thumbs_up"]');
    expect(thumbsUp).toBeTruthy();
    await user.click(thumbsUp!);

    await waitFor(function waitSubmit() {
      expect(mockAgentFetch).toHaveBeenCalled();
    });

    const body = JSON.parse(mockAgentFetch.mock.calls[0][1].body as string);
    expect(body.targetLevel).toBe('invocation');
    expect(body.targetId).toBe('airo-app-builder-logo');
    expect(mockMarkSubmitted).toHaveBeenCalled();
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'skill-invoke.feedback.submit',
      expect.objectContaining({
        flow: 'skill-invoke',
        initialBuildRevealMilestone: 'logoDownload',
      })
    );
  });

  it('closes the banner when the close control is used', function close() {
    renderWithProviders(<AgentWorkFeedbackBanner />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(mockLogClick).toHaveBeenCalledWith('skill-invoke.feedback.close');
    expect(mockSetShowBanner).toHaveBeenCalledWith(false, null);
  });
});
