import type { ReactNode } from 'react'
import text from '@ux/text'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
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
  title: ReactNode
  description?: ReactNode
  /** Optional tooltip shown on info icon next to title */
  tooltip?: string
  /** Optional max height (px) for scrollable table body */
  maxHeight?: number
}

/**
 * Multi-column detail table for analytics drill-down views.
 *
 * Renders a compact, responsive table with zebra striping, tight spacing,
 * and a professional data-dense layout that minimises whitespace.
 */
export function AnalyticsDetailTable<T>({
  data,
  columns,
  title,
  description,
  tooltip,
  maxHeight,
}: AnalyticsDetailTableProps<T>) {
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <AnalyticsCard
        title={<>
          {title}
          {tooltip && (<InfoTooltip content={tooltip}/>)}
        </>}
        description={t('builder_analytics_no_data')}
      />
    )
  }

  return (
    <AnalyticsCard
      title={<>
        {title}
        {tooltip && (<InfoTooltip content={tooltip}/>)}
      </>}
      description={description}
    >
      {/* Table */}
      <div
        className="overflow-x-auto"
        style={maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: 'auto' } : undefined}
      >
        <table className="w-full border-collapse text-xs min-w-0">
          <thead className={maxHeight ? 'sticky -top-px bg-intents-ux-box-backgroundColor' : ''}>
            <tr
              className="border-y border-border/60"
              style={{
                background: 'var(--color-intents-ux-box-backgroundColor, var(--background))',
                boxShadow: maxHeight ? '0 1px 3px rgba(0,0,0,0.08)' : undefined,
              }}
            >
              {columns.map((col, i) => (
                <th
                  key={String(col.key)}
                  className={`
                    py-2 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground whitespace-nowrap
                    ${col.align === 'right' ? 'text-right' : 'text-left'}
                    ${i === 0 ? 'pl-2 pr-1.5' : i === columns.length - 1 ? 'pl-1.5 pr-2' : 'px-1.5'}
                  `}
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
                className={`
                  border-b border-border/30 last:border-b-0
                  transition-colors duration-100
                  hover:bg-[color-mix(in_srgb,var(--color-ai)_5%,transparent)]
                  ${rowIdx % 2 === 1 ? 'bg-[color-mix(in_srgb,var(--color-ai)_2%,transparent)]' : ''}
                `}
              >
                {columns.map((col, i) => {
                  const val = row[col.key]
                  return (
                    <td
                      key={String(col.key)}
                      className={`
                        py-1.5 text-xs leading-tight
                        ${col.align === 'right' ? 'text-right font-semibold tabular-nums' : 'text-left'}
                        ${i === 0 ? 'pl-2 pr-1.5' : i === columns.length - 1 ? 'pl-1.5 pr-2' : 'px-1.5'}
                      `}
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

      {/* Footer row count */}
      <div className="px-2 py-1.5 border-t border-border/40 flex items-center justify-between">
        <text.span className="!text-[10px] !font-medium !text-muted-foreground">
          {data.length} {data.length === 1 ? 'row' : 'rows'}
        </text.span>
      </div>
    </AnalyticsCard>
  )
}
