'use client'

import { useCallback, useState } from 'react'
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { useImpression } from '@/hooks/useImpression'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { logClickEvent } from '@/utils/instrumentation'

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
  landingPagePath?: string
  assets: PlannedAsset[]
  assumptions?: string[]
  whyThisMix?: string
  expectation?: string
}

interface ToolResult {
  output?: { widgetData?: { plan?: CampaignPlan } }
  widgetData?: { plan?: CampaignPlan }
}

const ASSET_LABEL_KEYS: Record<string, string> = {
  'landing-page': 'builder_marketing_campaign_plan_asset_landing_page',
  banner: 'builder_marketing_campaign_plan_asset_banner',
  blog: 'builder_marketing_content_type_blog_post',
  social: 'builder_marketing_content_type_social_post',
  email: 'builder_marketing_content_type_email',
  ad: 'builder_marketing_campaign_plan_asset_ad',
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
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const [submitted, setSubmitted] = useState(false)

  const widgetData = ((result as ToolResult)?.output ?? (result as ToolResult))?.widgetData
  const plan = widgetData?.plan

  useImpression('chat.campaignPlan.view', { enabled: Boolean(plan) })

  const handleComplete = useCallback((selections: Record<string, string | string[] | null>) => {
    if (isProcessing || submitted || !sendUserMessage) return
    const sel = selections['0']
    if (!sel) return
    setSubmitted(true)
    const selected = Array.isArray(sel) ? sel[0] : sel
    if (selected === '1') {
      logClickEvent('chat.campaignPlan.approve')()
      sendUserMessage('Approve — generate the content', { isActionRequest: true })
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
        {plan.assumptions && plan.assumptions.length > 0 && (
          <div className="mb-3">
            <p className="font-semibold mb-1">{t('builder_marketing_campaign_plan_assumptions_heading')}</p>
            <ul className="list-disc pl-5 space-y-1">
              {plan.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="font-semibold mb-1">{t('builder_marketing_campaign_plan_heading', { name: plan.name })}</p>
        <ul className="list-disc pl-5 space-y-1">
          {plan.assets.map((asset, i) => (
            <li key={i}>
              <span className="font-medium">
                {ASSET_LABEL_KEYS[asset.assetType] ? t(ASSET_LABEL_KEYS[asset.assetType]) : asset.assetType}
              </span>
              {': '}
              {asset.title}
              {asset.scheduledDate && (
                <span className="text-intents-ux-textSubtle-textColor"> — {formatDate(asset.scheduledDate)}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-intents-ux-textSubtle-textColor">
          {t('builder_marketing_campaign_plan_runs', { startDate: formatDate(plan.startDate), endDate: formatDate(plan.endDate) })}
        </p>
        {plan.whyThisMix && (
          <p className="mt-3"><span className="font-medium">{t('builder_marketing_campaign_plan_why_label')}</span> {plan.whyThisMix}</p>
        )}
        {plan.expectation && (
          <p className="mt-2"><span className="font-medium">{t('builder_marketing_campaign_plan_expectation_label')}</span> {plan.expectation}</p>
        )}
      </div>

      {showInteractions && (
        <ChoiceList
          ariaLabel={t('builder_marketing_campaign_plan_approval_aria')}
          disabled={isProcessing}
          allowOther={true}
          otherPlaceholder={t('builder_marketing_campaign_plan_change_placeholder')}
          onComplete={handleComplete}
        >
          <ChoiceList.Step
            id="0"
            title={t('builder_marketing_campaign_plan_approval_title')}
            selectionMode="single"
          >
            <ChoiceList.Item value="1">{t('builder_marketing_campaign_plan_approve_option')}</ChoiceList.Item>
          </ChoiceList.Step>
        </ChoiceList>
      )}
    </div>
  )
}
