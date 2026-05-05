import {
  RadialBar,
  RadialBarChart,
  ResponsiveContainer
} from 'recharts'
import text from '@ux/text'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { useTranslations } from '@/hooks/useTranslations'

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsRadialChartProps {
  data: ChartDataPoint[]
  label?: string
}

/**
 * Radial gauge chart for displaying engagement rate or percentage metrics
 *
 * Renders a half-circle gauge with a percentage value.
 * Best for single-value metrics like engagement rate, completion rate, etc.
 *
 * @param data - Array of data points with date and value
 * @param label - Chart label
 */
export function AnalyticsRadialChart({ data, label = 'Engagement' }: AnalyticsRadialChartProps) {
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <AnalyticsCard
        title={label}
        description={t('builder_analytics_no_data')}
      />
    )
  }

  // Calculate a synthetic engagement rate from the data
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const engaged = data.filter(d => d.value > 0).length
  const rate = data.length > 0 ? Number(((engaged / data.length) * 100).toFixed(1)) : 0

  const gaugeData = [{ value: rate, fill: 'var(--color-ai)' }]

  return (
    <AnalyticsCard data-slot="chart" title={label} className="min-h-[250px]">
      <div className="flex flex-col items-center w-full">
        <ResponsiveContainer width="100%" height={220}>
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="90%"
            data={gaugeData}
            startAngle={180}
            endAngle={0}
            barSize={14}
          >
            <RadialBar
              background={{ fill: 'color-mix(in srgb, var(--color-ai) 10%, hsl(var(--background)))' }}
              dataKey="value"
              cornerRadius={10}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="flex flex-col items-center gap-1 -mt-12">
          <text.span
            className="!text-4xl !font-extrabold !tracking-tighter"
            style={{
              background: 'linear-gradient(90deg, var(--color-ai-dark) 0%, var(--color-ai-muted) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}
          >
            {rate}%
          </text.span>
          <text.span emphasis="passive" className="!text-xs">
            {t('builder_analytics_radial_summary', { engaged, periods: data.length, total })}
          </text.span>
        </div>
      </div>
    </AnalyticsCard>
  )
}
