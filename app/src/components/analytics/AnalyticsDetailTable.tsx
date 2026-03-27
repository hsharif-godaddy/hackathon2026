import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

interface ColumnDef<T> {
  key: keyof T
  header: string
  align?: 'left' | 'right'
  /** Optional render function for custom cell formatting */
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface AnalyticsDetailTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  title: string
  subtitle?: string
  /** Optional max height (px) for scrollable table body */
  maxHeight?: number
}

/**
 * Multi-column detail table for analytics drill-down views.
 *
 * Renders a fully styled table matching the index2.html reference dashboard.
 * Supports arbitrary column definitions, custom cell renderers, and alignment.
 *
 * Used for:
 * - Clicks by Page & Device
 * - Session Click Behavior
 * - Element Clicks by Device
 * - Period Comparison
 */
export function AnalyticsDetailTable<T>({
  data,
  columns,
  title,
  subtitle,
  maxHeight,
}: AnalyticsDetailTableProps<T>) {
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-intents-ux-box-backgroundColor p-5">
        <text.p className="!text-[13px] !font-semibold !mb-0">{title}</text.p>
        <text.p emphasis="passive">{t('builder_analytics_no_data')}</text.p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-intents-ux-box-backgroundColor p-5 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px">
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-ai)', boxShadow: '0 0 6px var(--color-ai-glow)' }} />
        <text.p className="!text-[13px] !font-semibold !mb-0">{title}</text.p>
      </div>
      {subtitle && (
        <text.p emphasis="passive" className="!text-xs !-mt-1 !mb-1">{subtitle}</text.p>
      )}
      <div className="overflow-x-auto -mx-2 px-2" style={maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: 'auto' } : undefined}>
        <table className="w-full border-collapse text-[13px]">
          <thead className={maxHeight ? 'sticky top-0 z-10 bg-intents-ux-box-backgroundColor' : ''}>
            <tr className="border-b-2 border-border">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-border/50 last:border-b-0 transition-colors hover:bg-[color-mix(in_srgb,var(--color-ai)_3%,transparent)]"
              >
                {columns.map((col) => {
                  const val = row[col.key]
                  return (
                    <td
                      key={String(col.key)}
                      className={`px-3 py-2.5 ${
                        col.align === 'right' ? 'text-right font-semibold tabular-nums' : 'text-left'
                      }`}
                    >
                      {col.render ? col.render(val, row) : String(val ?? '')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
