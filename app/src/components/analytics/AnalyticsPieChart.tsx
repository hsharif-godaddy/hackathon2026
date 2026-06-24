import { DonutChart } from '@godaddy/antares'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { formatChartValue } from '@/components/analytics/ChartTooltip'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import { useTranslations } from '@/hooks/useTranslations'

function formatDonutLegendLabel(name: string, value: number, total: number): string {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return `${pct}% ${name}`
}

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsPieChartProps {
  data: ChartDataPoint[]
  label?: string
  /** Center donut sublabel (e.g. "Sessions") */
  subLabel?: string
  /** Optional tooltip shown on info icon next to title */
  tooltip?: string
  fetched?: boolean
}

/**
 * Donut chart component for displaying analytics distribution.
 */
export function AnalyticsPieChart({ data, label = 'Distribution', subLabel, tooltip, fetched = false }: AnalyticsPieChartProps) {
  const t = useTranslations()

  const total = (data ?? []).reduce(function sum(acc, d) {
    return acc + d.value
  }, 0)
  const slices = (data ?? [])
    .filter(function positiveValue(d) {
      return d.value > 0
    })
    .map(function mapSlice(d, index) {
      return {
        id: `slice-${index}`,
        name: formatDonutLegendLabel(d.date, d.value, total),
        value: d.value,
      }
    })

  if (!data || data.length === 0 || slices.length === 0) {
    return (
      <AnalyticsCard
        title={<>
          {label}
          {tooltip && (<InfoTooltip content={tooltip}/>)}
        </>}
        description={fetched ? '0' : t('builder_analytics_no_data')}
      />
    )
  }

  return (
    <AnalyticsCard
      data-slot="chart"
      title={<>
        {label}
        {tooltip && (<InfoTooltip content={tooltip}/>)}
      </>}
    >
      <div className="flex flex-grow items-center justify-center">
        <DonutChart
          data={slices}
          label={formatChartValue(total)}
          subLabel={subLabel}
          formatValue={formatChartValue}
          legend="right"
          gap="sm"
          aria-label={label}
          // Using font-size override to match surrounding typography
          className="w-full min-w-0 max-w-[300px] [&_[role='listitem']]:!text-xs"
        />
      </div>
    </AnalyticsCard>
  )
}
