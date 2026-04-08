import {
  RadialBar,
  RadialBarChart,
  ResponsiveContainer
} from 'recharts'
import text from '@ux/text'

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
      <text.p emphasis="passive" className="!text-center !py-8">{t('builder_analytics_no_data')}</text.p>
    )
  }

  // Calculate a synthetic engagement rate from the data
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const engaged = data.filter(d => d.value > 0).length
  const rate = data.length > 0 ? Number(((engaged / data.length) * 100).toFixed(1)) : 0

  const gaugeData = [{ value: rate, fill: 'var(--color-ai)' }]

  return (
    <div
      data-slot="chart"
      className="flex flex-col items-center w-full rounded-lg border bg-intents-ux-box-backgroundColor p-2 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px]"
    >
      <div className="flex items-center gap-2 mb-3.5 self-start">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-chart-violet)', boxShadow: '0 0 6px color-mix(in srgb, var(--color-chart-violet) 25%, transparent)' }} />
        <text.span className="!text-[13px] !font-semibold">{label}</text.span>
      </div>
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
  )
}
