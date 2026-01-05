import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip
} from 'recharts'

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsChartProps {
  data: ChartDataPoint[]
}

interface TooltipPayload {
  payload: ChartDataPoint
  value: number
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
}

/**
 * Area chart component for displaying analytics trends over time
 *
 * Renders an area chart with gradient fill showing visitor/pageview trends
 * with proper axis labels and grid lines. Supports responsive sizing and data updates.
 * Uses Recharts library for maintainable and feature-rich charting.
 *
 * @param data - Array of data points with date and value
 */
export function AnalyticsChart({ data }: AnalyticsChartProps) {
  if (!data || data.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-8">No chart data available</p>
    )
  }

  /**
   * Format large numbers with K/M suffixes for readability
   *
   * @param val - Number to format
   * @returns Formatted string with K/M suffix if applicable
   */
  const formatValue = (val: number): string => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`
    return Math.round(val).toString()
  }

  /**
   * Custom tooltip component for the chart
   *
   * @param props - Tooltip props from Recharts
   * @returns Tooltip JSX element
   */
  const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-2">
          <p className="text-sm font-medium">{payload[0].payload.date}</p>
          <p className="text-sm text-muted-foreground">
            Page Views: <span className="font-semibold">{formatValue(payload[0].value)}</span>
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div
      data-slot="chart"
      className="flex justify-center w-full rounded-md border bg-intents-ux-box-backgroundColor p-2"
      style={{ minHeight: '250px' }}
    >
      <ResponsiveContainer width="100%" height={400} minHeight={250}>
        <AreaChart
          data={data}
          margin={{
            top: 20,
            right: 40,
            bottom: 40,
            left: 50
          }}
        >
          <defs>
            <linearGradient id="fillGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--muted-border))"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
            tickFormatter={formatValue}
            label={{
              value: 'Page Views',
              angle: -90,
              position: 'insideLeft',
              style: { textAnchor: 'middle', fill: 'hsl(var(--muted-foreground))', fontSize: 12 }
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#fillGradient)"
            fillOpacity={0.6}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

