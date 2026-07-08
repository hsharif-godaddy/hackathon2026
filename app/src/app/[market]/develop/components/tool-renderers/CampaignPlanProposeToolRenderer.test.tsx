/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'
import CampaignPlanProposeToolRenderer from './CampaignPlanProposeToolRenderer'

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

const mockSendUserMessage = vi.fn()
vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: () => mockSendUserMessage,
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

const mockPlan = {
  name: 'Summer Sale',
  offer: 'Boost summer bookings',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  assets: [
    { assetType: 'social' as const, title: 'Launch post' },
  ],
}

function makeResult(plan: typeof mockPlan | undefined) {
  return { output: { widgetData: { plan } } }
}

const defaultProps = {
  toolName: 'campaignPlanPropose',
  toolStatus: 'completed' as const,
  isLastAssistantMessage: true,
}

describe('CampaignPlanProposeToolRenderer instrumentation', function proposeInstrumentation() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  it('fires logImpressionEvent once with chat.campaignPlan.view when the plan is present and completed', function impressionFires() {
    const innerFn = vi.fn()
    vi.mocked(logImpressionEvent).mockReturnValue(innerFn)

    render(
      <CampaignPlanProposeToolRenderer {...defaultProps} result={makeResult(mockPlan)} />
    )

    expect(logImpressionEvent).toHaveBeenCalledOnce()
    expect(logImpressionEvent).toHaveBeenCalledWith('chat.campaignPlan.view', undefined)
    expect(innerFn).toHaveBeenCalledOnce()
  })

  it('does not fire logImpressionEvent a second time on re-render with the same plan', function impressionOnce() {
    const innerFn = vi.fn()
    vi.mocked(logImpressionEvent).mockReturnValue(innerFn)

    const { rerender } = render(
      <CampaignPlanProposeToolRenderer {...defaultProps} result={makeResult(mockPlan)} />
    )
    rerender(
      <CampaignPlanProposeToolRenderer {...defaultProps} result={makeResult(mockPlan)} />
    )

    expect(logImpressionEvent).toHaveBeenCalledOnce()
    expect(innerFn).toHaveBeenCalledOnce()
  })

  it('does not fire logImpressionEvent when there is no plan', function impressionSkipped() {
    render(
      <CampaignPlanProposeToolRenderer {...defaultProps} result={makeResult(undefined)} />
    )

    expect(logImpressionEvent).not.toHaveBeenCalled()
  })

  it('fires logClickEvent chat.campaignPlan.approve and sends the approve message when the approve option is selected', async function approveSelected() {
    const innerFn = vi.fn()
    vi.mocked(logClickEvent).mockReturnValue(innerFn)
    const user = userEvent.setup()

    render(
      <CampaignPlanProposeToolRenderer {...defaultProps} result={makeResult(mockPlan)} />
    )

    await user.click(
      screen.getByRole('option', { name: /builder_marketing_campaign_plan_approve_option/ })
    )

    expect(logClickEvent).toHaveBeenCalledWith('chat.campaignPlan.approve')
    expect(innerFn).toHaveBeenCalledOnce()
    expect(mockSendUserMessage).toHaveBeenCalledWith('Approve — generate the content', {
      isActionRequest: true,
    })
  })
})
