import { useIntl } from 'react-intl'
import text from '@ux/text'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { ContentTooltip } from '@/components/ui/ContentTooltip'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import { useTranslations } from '@/hooks/useTranslations'

export interface StatProgressItem {
  label: string
  value: number
  /** Optional icon/flag element */
  icon?: React.ReactNode
  /** Optional color override for this item's bar */
  color?: string
}

interface StatProgressListProps {
  items: StatProgressItem[]
  title: string
  /** Accent color for progress bars */
  color?: string
  /** Show percentage next to value */
  showPercent?: boolean
  /** Maximum items to display */
  maxItems?: number
  /** Optional tooltip shown on info icon next to title */
  tooltip?: string
  /** When true and items are empty, show 0 instead of "no data" */
  fetched?: boolean
}

function columns(hasIcons: boolean, showPercent: boolean): string {
  return [
    'max-content',
    ...(hasIcons ? ['max-content'] : []),
    'minmax(0,1fr)',
    'minmax(40px,1fr)',
    'max-content',
    ...(showPercent ? ['max-content'] : []),
  ].join(' ')
}

/**
 * Flighty-inspired horizontal progress bar list
 *
 * Displays a ranked list of items with proportional progress bars.
 * Used for geographic distribution, device breakdown, referrer sources, etc.
 * Each item shows: optional icon + label, colored progress bar, value (+ optional %).
 */
export function StatProgressList({
  items,
  title,
  color = 'var(--color-ai)',
  showPercent = true,
  maxItems = 8,
  tooltip,
  fetched = false,
}: StatProgressListProps) {
  const t = useTranslations()
  const intl = useIntl()

  if (!items || items.length === 0) {
    return (
      <AnalyticsCard
        title={<>
          {title}
          {tooltip && (<InfoTooltip content={tooltip}/>)}
        </>}
        description={fetched ? '0' : t('builder_analytics_no_data')}
      />
    )
  }

  const displayItems = items.slice(0, maxItems)
  const maxValue = Math.max(...displayItems.map((d) => d.value), 1)
  const totalValue = displayItems.reduce((sum, d) => sum + d.value, 0)
  const hasIcons = displayItems.some((d) => d.icon)
  const gridTemplateColumns = columns(hasIcons, showPercent)

  return (
    <AnalyticsCard
      title={<>
        {title}
        {tooltip && (<InfoTooltip content={tooltip}/>)}
      </>}
    >
      <div
        className="grid gap-x-2"
        style={{ gridTemplateColumns }}
      >
        {displayItems.map((item, idx) => {
          const pct = totalValue > 0 ? (item.value / totalValue) * 100 : 0
          const barWidth = maxValue > 0 ? (item.value / maxValue) * 100 : 0
          const barColor = item.color || color

          return (
            <ContentTooltip
              key={`${item.label}-${idx}`}
              content={
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{item.label}</span>
                  <span>{intl.formatMessage({ id: 'builder_analytics_tooltip_stat_row', defaultMessage: '{value} — {pct}% of total' }, { value: item.value.toLocaleString(), pct: pct.toFixed(1) })}</span>
                </div>
              }
              contentClassName="p-1 text-xs"
            >
              <div
                className="col-span-full grid grid-cols-subgrid gap-x-2 items-center cursor-default rounded-sm -mx-1 px-1 py-1 transition-colors hover:bg-[color-mix(in_srgb,var(--color-ai)_5%,transparent)]"
              >
                <text.span emphasis="passive" size={-2} className="text-right tabular-nums">
                  {idx + 1}
                </text.span>

                {hasIcons && (
                  <span className="flex items-center justify-center">
                    {item.icon ?? null}
                  </span>
                )}

                <text.span as="label" size={-2} className="truncate min-w-0">
                  {item.label}
                </text.span>

                <div className="h-[6px] rounded-full overflow-hidden min-w-0 bg-intents-ux-boxLowContrast-backgroundColor">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.max(barWidth, 2)}%`,
                      background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 70%, transparent))`,
                    }}
                  />
                </div>

                <text.span as="label" size={-2} className="text-right tabular-nums" style={{ color: barColor }}>
                  {item.value.toLocaleString()}
                </text.span>

                {showPercent && (
                  <text.span emphasis="passive" size={-2} className="tabular-nums">
                    {pct.toFixed(0)}%
                  </text.span>
                )}
              </div>
            </ContentTooltip>
          )
        })}
      </div>

      {items.length > maxItems && (
        <text.span emphasis="passive" size={-2}>
          {t('builder_analytics_more_items', { count: items.length - maxItems })}
        </text.span>
      )}
    </AnalyticsCard>
  )
}
