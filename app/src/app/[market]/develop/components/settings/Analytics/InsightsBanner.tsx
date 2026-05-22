'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Card, { spaceOptions } from '@ux/card'
import BinocularsIcon from '@ux/icon/binoculars'
import BullseyeIcon from '@ux/icon/bullseye'
import ChevronLeftIcon from '@ux/icon/chevron-left'
import ChevronRightIcon from '@ux/icon/chevron-right'
import SparklesIcon from '@ux/icon/sparkles'
import ThumbsDownIcon from '@ux/icon/thumbs-down'
import ThumbsUpIcon from '@ux/icon/thumbs-up'
import Tag from '@ux/tag'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import { useHostInsights } from '@/hooks/useHostInsights'
import { useTranslations } from '@/hooks/useTranslations'
import { serializeInsightsFeedbackForKeepalive } from '@/lib/analytics/insights-feedback-keepalive-body'
import { pageHostFromUrl } from '@/lib/analytics/page-host-from-url'
import { parseInsightValue } from '@/lib/analytics/parse-insight-value'
import { cn } from '@/lib/utils'
import type { InsightKind } from '@/types/analytics'

export interface InsightsBannerItem {
  kind: InsightKind
  value: string
}

export interface InsightsBannerProps {
  demoItems?: InsightsBannerItem[]
}

type Vote = 'up' | 'down' | null

function key(kind: string, value: string): string {
  return `${kind}:${value}`
}

type Translate = ReturnType<typeof useTranslations>

function insightKindLabel(kind: InsightKind, t: Translate): string {
  switch (kind) {
    case 'insight':
      return t('builder_analytics_insights_kind_insights', undefined, 'Insights')
    case 'recommendation':
      return t('builder_analytics_insights_kind_recommendation', undefined, 'Recommendation')
    case 'prediction':
      return t('builder_analytics_insights_kind_prediction', undefined, 'Prediction')
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

const kindIcon: Record<InsightKind, ReactNode> = {
  insight: <SparklesIcon />,
  recommendation: <BullseyeIcon />,
  prediction: <BinocularsIcon />,
}

function isDemoMode(demoItems: InsightsBannerItem[] | undefined): demoItems is InsightsBannerItem[] {
  return Array.isArray(demoItems) && demoItems.length > 0
}

export default function InsightsBanner(props: InsightsBannerProps = {}) {
  const { demoItems } = props
  const t = useTranslations()
  const demo = isDemoMode(demoItems)

  const appId = useAppIdFromParams()
  const publishedUrl = usePublishedUrl()
  const { date, error, items: fetchedItems, raw } = useHostInsights({
    publishedUrl,
    appId,
    enabled: Boolean(publishedUrl?.trim()) && !demo,
  })
  const items = demo ? demoItems : fetchedItems
  const snapshotDate = demo ? null : date
  const insightRaw = demo ? { homepageInsightsUiDemo: true } : raw

  const [index, setIndex] = useState(0)
  const [votes, setVotes] = useState<Record<string, Vote>>({})

  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1)
  const current: InsightsBannerItem | null = items[safeIndex] ?? null
  const currentKey = current ? key(current.kind, current.value) : null

  const content = useMemo(() => (current ? parseInsightValue(current.value) : { title: '', description: '' }), [current])

  function sendVote(next: Vote) {
    if (demo || !current || !publishedUrl?.trim()) return

    // Fire-and-forget: never await; errors ignored. UI is optimistic (thanks + vote state).
    // keepalive bodies are ~64KiB-capped in browsers; serializeInsightsFeedbackForKeepalive truncates raw/titles.
    void fetch('/api/analytics/insights-feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serializeInsightsFeedbackForKeepalive({
        vote: next === null ? 'none' : next,
        appId: appId ?? null,
        pageHostId: pageHostFromUrl(publishedUrl),
        insightKind: current.kind,
        insightTitle: content.title || insightKindLabel(current.kind, t),
        insightBody: content.description || content.title,
        partitionSnapDate: snapshotDate,
        insightRaw,
      }),
      keepalive: true,
    }).catch(() => {})
  }

  const [thumbUpCount, setThumbUpCount] = useState(0)
  const [thumbDownCount, setThumbDownCount] = useState(0)

  function toggleUp() {
    if (!currentKey) return
    const next = votes[currentKey] === 'up' ? null : 'up'
    setVotes((v) => ({ ...v, [currentKey]: next }))
    sendVote(next)
    if (next === 'up') setThumbUpCount((c) => c + 1)
  }

  function toggleDown() {
    if (!currentKey) return
    const next = votes[currentKey] === 'down' ? null : 'down'
    setVotes((v) => ({ ...v, [currentKey]: next }))
    sendVote(next)
    if (next === 'down') setThumbDownCount((c) => c + 1)
  }

  if (!demo && !publishedUrl?.trim()) return null
  if (!demo && error) return null
  if (items.length === 0 || !current) return null

  const currentVote = currentKey ? votes[currentKey] ?? null : null

  return (
    <Box
      orientation="vertical"
      gap="sm"
      className="mb-1"
      role="region"
      aria-label={t('builder_analytics_insights_region_aria', undefined, 'Insights and recommendations carousel')}
    >
      <Card
        space={{ block: spaceOptions.MD, inline: spaceOptions.MD }}
        data-partial="accentAiro"
      >
        <Box
          orientation="vertical"
          gap="md"
        >
          <Tag
            emphasis="highlight"
            icon={kindIcon[current.kind]}
            className="self-start"
          >
            {insightKindLabel(current.kind, t)}
          </Tag>

          <TextLockup title={content.title} size="sm">
            {content.description}
          </TextLockup>

          <Box
            orientation="horizontal"
            gap="sm"
            inlineAlignChildren="center"
            blockAlignChildren="end"
          >
            <text.span emphasis="passive" size={-1}>
              {t('builder_analytics_insights_feedback_prompt', undefined, 'Did you find this useful?')}
            </text.span>
            <Button
              design="control"
              size="sm"
              icon={
                <span
                  key={thumbUpCount}
                  className={cn('origin-bottom-left', thumbUpCount > 0 && 'animate-thumb-bounce-up')}
                >
                  <ThumbsUpIcon aria-hidden />
                </span>
              }
              aria-label={t('builder_analytics_insights_thumbs_up_aria', undefined, 'Thumbs up')}
              aria-pressed={currentVote === 'up'}
              active={currentVote === 'up'}
              onClick={toggleUp}
              data-partial="componentAiro"
            />
            <Button
              design="control"
              size="sm"
              icon={
                <span
                  key={thumbDownCount}
                  className={cn('origin-top-right', thumbDownCount > 0 && 'animate-thumb-bounce-down')}
                >
                  <ThumbsDownIcon aria-hidden />
                </span>
              }
              aria-label={t('builder_analytics_insights_thumbs_down_aria', undefined, 'Thumbs down')}
              aria-pressed={currentVote === 'down'}
              active={currentVote === 'down'}
              onClick={toggleDown}
              data-partial="componentAiro"
            />
          </Box>
        </Box>
      </Card>
      {items.length > 1 && (
        <Box
          orientation="horizontal"
          inlineAlignChildren="center"
          blockAlignChildren="center"
          gap="sm"
        >
          <Button
            design="tertiary"
            size="sm"
            icon={<ChevronLeftIcon />}
            aria-label={t('builder_analytics_insights_previous_aria', undefined, 'Previous')}
            disabled={safeIndex <= 0}
            onClick={() => setIndex((v) => Math.max(0, v - 1))}
          />
          <text.span size={-1}>
            {safeIndex + 1}/{items.length}
          </text.span>
          <Button
            design="tertiary"
            size="sm"
            icon={<ChevronRightIcon />}
            aria-label={t('builder_analytics_insights_next_aria', undefined, 'Next')}
            disabled={safeIndex >= items.length - 1}
            onClick={() => setIndex((v) => Math.min(items.length - 1, v + 1))}
          />
        </Box>
      )}
      </Box>
  )
}
