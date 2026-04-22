import { useIntl } from 'react-intl'
import text from '@ux/text'

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
  /** Optional subtitle */
  subtitle?: string
  /** Optional tooltip shown on info icon next to title */
  tooltip?: string
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
  subtitle,
  tooltip,
}: StatProgressListProps) {
  const t = useTranslations()
  const intl = useIntl()

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border bg-intents-ux-box-backgroundColor p-5">
        <text.span className="!text-[13px] !font-bold !tracking-tight">{title}</text.span>
        <text.p emphasis="passive" className="!text-xs !mb-0">{t('builder_analytics_no_data')}</text.p>
      </div>
    )
  }

  const displayItems = items.slice(0, maxItems)
  const maxValue = Math.max(...displayItems.map((d) => d.value), 1)
  const totalValue = displayItems.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="flex flex-col rounded-xl border bg-intents-ux-box-backgroundColor p-5 transition-all duration-200 ease-out hover:shadow-md hover:-translate-y-0.5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
          style={{ background: color, boxShadow: `0 0 8px color-mix(in srgb, ${color} 30%, transparent)` }}
        />
        <text.span className="!text-[13px] !font-bold !tracking-tight">{title}</text.span>
        {tooltip && (
          <InfoTooltip
            content={tooltip}
            iconClassName="size-[13px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            contentClassName="p-1 max-w-[240px] text-xs"
          />
        )}
      </div>
      {subtitle && (
        <text.span className="!text-[11px] !text-muted-foreground !mb-3 !pl-[14px]">{subtitle}</text.span>
      )}

      {/* Items */}
      <div className="flex flex-col gap-2.5 mt-2">
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
              <div className="group flex items-center gap-2 cursor-default">
                <text.span className="!text-[10px] !font-bold !text-muted-foreground/50 !w-4 !text-right !tabular-nums !shrink-0">
                  {idx + 1}
                </text.span>

                {item.icon && <span className="shrink-0 flex items-center">{item.icon}</span>}

                <text.span className="!text-xs !font-medium !truncate !min-w-0 !max-w-[50%] shrink">
                  {item.label}
                </text.span>

                <div className="flex-1 h-[6px] rounded-full bg-muted/40 overflow-hidden min-w-[40px]">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.max(barWidth, 2)}%`,
                      background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 70%, transparent))`,
                    }}
                  />
                </div>

                <div className="flex items-baseline gap-1.5 shrink-0 tabular-nums">
                  <text.span className="!text-xs !font-bold" style={{ color: barColor }}>
                    {item.value.toLocaleString()}
                  </text.span>
                  {showPercent && (
                    <text.span className="!text-[10px] !text-muted-foreground">
                      {pct.toFixed(0)}%
                    </text.span>
                  )}
                </div>
              </div>
            </ContentTooltip>
          )
        })}
      </div>

      {/* Show "+N more" if truncated */}
      {items.length > maxItems && (
        <text.span className="!text-[10px] !text-muted-foreground !mt-2 !pl-[14px]">
          {t('builder_analytics_more_items', { count: items.length - maxItems })}
        </text.span>
      )}
    </div>
  )
}
