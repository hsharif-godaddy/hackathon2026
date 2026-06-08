'use client'

import { useCallback, useState } from 'react'
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

interface PlannedAsset {
  assetType: 'landing-page' | 'banner' | 'blog' | 'social' | 'email' | 'ad'
  title: string
  scheduledDate?: string
  description?: string
}

interface CampaignPlan {
  name: string
  offer: string
  startDate: string
  endDate: string
  campaignType: 'landing-page' | 'banner' | 'content-only'
  landingPagePath?: string
  assets: PlannedAsset[]
}

interface ToolResult {
  output?: { widgetData?: { plan?: CampaignPlan } }
  widgetData?: { plan?: CampaignPlan }
}

const ASSET_LABELS: Record<string, string> = {
  'landing-page': 'Landing page',
  banner: 'Banner',
  blog: 'Blog post',
  social: 'Social post',
  email: 'Email',
  ad: 'Ad',
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CampaignPlanProposeToolRenderer({
  toolName,
  toolStatus,
  result,
  isLastAssistantMessage,
  ...rest
}: DefaultToolRendererProps) {
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const [submitted, setSubmitted] = useState(false)

  const widgetData = ((result as ToolResult)?.output ?? (result as ToolResult))?.widgetData
  const plan = widgetData?.plan

  const handleComplete = useCallback((selections: Record<string, string | string[] | null>) => {
    if (isProcessing || submitted || !sendUserMessage) return
    const sel = selections['0']
    if (!sel) return
    setSubmitted(true)
    const selected = Array.isArray(sel) ? sel[0] : sel
    if (selected === '1') {
      sendUserMessage('Approve — generate the content', { isActionRequest: true })
    } else if (selected === '2') {
      sendUserMessage('I want to make changes to the plan', { isActionRequest: true })
    } else {
      sendUserMessage(selected, { isActionRequest: true })
    }
  }, [isProcessing, submitted, sendUserMessage])

  if (toolStatus === 'error' || (toolStatus === 'completed' && !plan)) {
    return <DefaultToolRenderer toolName={toolName} toolStatus={toolStatus} result={result} isLastAssistantMessage={isLastAssistantMessage} {...rest} />
  }

  if (toolStatus !== 'completed' || !plan) return null

  const showInteractions = !submitted && isLastAssistantMessage !== false

  return (
    <div className="mt-1">
      <div className="text-sm leading-relaxed mb-3">
        <p className="font-semibold mb-1">Here&apos;s the plan for your {plan.name}:</p>
        <ul className="list-disc pl-5 space-y-1">
          {plan.assets.map((asset, i) => (
            <li key={i}>
              <span className="font-medium">{ASSET_LABELS[asset.assetType] || asset.assetType}</span>
              {': '}
              {asset.title}
              {asset.scheduledDate && (
                <span className="text-intents-ux-textSubtle-textColor"> — {formatDate(asset.scheduledDate)}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-intents-ux-textSubtle-textColor">
          Campaign runs: {formatDate(plan.startDate)} – {formatDate(plan.endDate)}
        </p>
      </div>

      {showInteractions && (
        <ChoiceList
          ariaLabel="Campaign plan approval"
          disabled={isProcessing}
          allowOther={true}
          otherPlaceholder="Describe what you'd like to change..."
          onComplete={handleComplete}
        >
          <ChoiceList.Step
            id="0"
            title="Does this plan look good?"
            selectionMode="single"
          >
            <ChoiceList.Item value="1">Approve — generate the content</ChoiceList.Item>
            <ChoiceList.Item value="2">Make changes to the plan</ChoiceList.Item>
          </ChoiceList.Step>
        </ChoiceList>
      )}
    </div>
  )
}
