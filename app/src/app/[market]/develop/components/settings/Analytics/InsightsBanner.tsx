'use client'

import { Fraunces } from 'next/font/google'
import { useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import ChevronLeftIcon from '@ux/icon/chevron-left'
import ChevronRightIcon from '@ux/icon/chevron-right'
import LightbulbIcon from '@ux/icon/lightbulb'
import SparklesIcon from '@ux/icon/sparkles'
import ThumbsDownIcon from '@ux/icon/thumbs-down'
import ThumbsUpIcon from '@ux/icon/thumbs-up'
import text from '@ux/text'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import { useHostInsights } from '@/hooks/useHostInsights'
import { useTranslations } from '@/hooks/useTranslations'
import { serializeInsightsFeedbackForKeepalive } from '@/lib/analytics/insights-feedback-keepalive-body'
import { pageHostFromUrl } from '@/lib/analytics/page-host-from-url'
import { parseInsightValue } from '@/lib/analytics/parse-insight-value'
import type { InsightKind } from '@/types/analytics'

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
})

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

function isDemoMode(demoItems: InsightsBannerItem[] | undefined): demoItems is InsightsBannerItem[] {
  return Array.isArray(demoItems) && demoItems.length > 0
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <text.span
      className="!inline-flex !h-[28px] !min-w-0 !max-w-full !items-center !justify-center !overflow-hidden !text-ellipsis !whitespace-nowrap !px-3 !rounded-lg !text-center !text-[12px] !font-medium !leading-tight"
      style={{ background: 'var(--color-ai-glow)', color: 'var(--color-ai)' }}
    >
      {children}
    </text.span>
  )
}

function KindGlyph({ kind }: { kind: InsightKind }) {
  const Icon = kind === 'insight' ? LightbulbIcon : SparklesIcon
  return (
    <span
      aria-hidden
      className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-lg bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor"
      style={{ color: 'var(--color-ai)', boxShadow: '0 2px 10px -2px var(--color-ai-glow)' }}
    >
      <span className="[&_svg]:h-[15px] [&_svg]:w-[15px]">
        <Icon />
      </span>
    </span>
  )
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

  function toggleUp() {
    if (!currentKey) return
    const next = votes[currentKey] === 'up' ? null : 'up'
    setVotes((v) => ({ ...v, [currentKey]: next }))
    sendVote(next)
  }

  function toggleDown() {
    if (!currentKey) return
    const next = votes[currentKey] === 'down' ? null : 'down'
    setVotes((v) => ({ ...v, [currentKey]: next }))
    sendVote(next)
  }

  if (!demo && !publishedUrl?.trim()) return null
  if (!demo && error) return null
  if (items.length === 0 || !current) return null

  const currentVote = currentKey ? votes[currentKey] ?? null : null

  return (
    <div
      role="region"
      aria-label={t('builder_analytics_insights_region_aria', undefined, 'Insights and recommendations carousel')}
      className="overflow-hidden rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-md transition-shadow hover:shadow-lg"
    >
      <Box gap="sm" className="p-3 sm:p-4">
        <div className="relative overflow-hidden rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-4 sm:p-5 shadow-sm">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: `radial-gradient(circle at 12% -10%, var(--color-ai) 0, transparent 45%),
                radial-gradient(circle at 92% 120%, var(--color-ai-muted) 0, transparent 42%)`,
            }}
          />

          <div className="relative flex gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Pill>{insightKindLabel(current.kind, t)}</Pill>
                  <KindGlyph kind={current.kind} />
                </div>
                {items.length > 1 ? (
                  <div className="flex items-center gap-1.5">
                    {items.map((item, i) => (
                      <button
                        key={key(item.kind, item.value)}
                        type="button"
                        className={`h-1.5 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${i === safeIndex ? 'w-4' : 'w-1.5'}`}
                        aria-label={`Go to item ${i + 1} of ${items.length}`}
                        aria-current={i === safeIndex ? 'true' : undefined}
                        onClick={() => setIndex(i)}
                        style={{
                          background: i === safeIndex
                            ? 'var(--color-ai)'
                            : 'color-mix(in srgb, var(--color-ai) 25%, transparent)',
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              {content.title ? (
                <text.strong className={`${fraunces.className} mt-1.5 block text-base leading-snug tracking-tight sm:text-lg`}>
                  {content.title}
                </text.strong>
              ) : null}
              {content.description ? (
                <text.p className="mt-1.5 mb-0 text-sm leading-relaxed sm:text-[15px] opacity-90" emphasis="passive">
                  {content.description}
                </text.p>
              ) : null}

              <div className="mt-2.5 border-t border-intents-ux-box-borderColor pt-2.5">
                {items.length > 1 ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5">
                    <div className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-1.5">
                      <text.span emphasis="passive" size={-2}>
                        {t('builder_analytics_insights_feedback_prompt', undefined, 'Did you find this useful?')}
                      </text.span>
                      <Button
                        design={currentVote === 'up' ? 'primary' : 'secondary'}
                        size="sm"
                        icon={<ThumbsUpIcon className="h-4 w-4" aria-hidden />}
                        aria-label={t('builder_analytics_insights_thumbs_up_aria', undefined, 'Thumbs up')}
                        aria-pressed={currentVote === 'up'}
                        onClick={toggleUp}
                      />
                      <Button
                        design={currentVote === 'down' ? 'primary' : 'secondary'}
                        size="sm"
                        icon={<ThumbsDownIcon className="h-4 w-4" aria-hidden />}
                        aria-label={t('builder_analytics_insights_thumbs_down_aria', undefined, 'Thumbs down')}
                        aria-pressed={currentVote === 'down'}
                        onClick={toggleDown}
                      />
                    </div>
                    <div className="col-start-1 row-start-2 min-h-0" />
                    <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 self-start">
                      <text.span emphasis="passive" size={-2} className="font-mono opacity-90">
                        {safeIndex + 1}/{items.length}
                      </text.span>
                      <div className="flex items-center gap-1">
                        <Button
                          design="secondary"
                          size="sm"
                          icon={<ChevronLeftIcon />}
                          aria-label={t('builder_analytics_insights_previous_aria', undefined, 'Previous')}
                          disabled={safeIndex <= 0}
                          onClick={() => setIndex((v) => Math.max(0, v - 1))}
                        />
                        <Button
                          design="secondary"
                          size="sm"
                          icon={<ChevronRightIcon />}
                          aria-label={t('builder_analytics_insights_next_aria', undefined, 'Next')}
                          disabled={safeIndex >= items.length - 1}
                          onClick={() => setIndex((v) => Math.min(items.length - 1, v + 1))}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <text.span emphasis="passive" size={-2}>
                        {t('builder_analytics_insights_feedback_prompt', undefined, 'Did you find this useful?')}
                      </text.span>
                      <Button
                        design={currentVote === 'up' ? 'primary' : 'secondary'}
                        size="sm"
                        icon={<ThumbsUpIcon className="h-4 w-4" aria-hidden />}
                        aria-label={t('builder_analytics_insights_thumbs_up_aria', undefined, 'Thumbs up')}
                        aria-pressed={currentVote === 'up'}
                        onClick={toggleUp}
                      />
                      <Button
                        design={currentVote === 'down' ? 'primary' : 'secondary'}
                        size="sm"
                        icon={<ThumbsDownIcon className="h-4 w-4" aria-hidden />}
                        aria-label={t('builder_analytics_insights_thumbs_down_aria', undefined, 'Thumbs down')}
                        aria-pressed={currentVote === 'down'}
                        onClick={toggleDown}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Box>
    </div>
  )
}
