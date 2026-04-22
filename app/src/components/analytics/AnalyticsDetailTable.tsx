import text from '@ux/text'

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
  title: string
  subtitle?: string
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
  subtitle,
  tooltip,
  maxHeight,
}: AnalyticsDetailTableProps<T>) {
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-intents-ux-box-backgroundColor p-2">
        <text.p className="!text-[13px] !font-semibold !mb-0">{title}</text.p>
        <text.p emphasis="passive" className="!text-xs">{t('builder_analytics_no_data')}</text.p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-intents-ux-box-backgroundColor p-2 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px">
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-ai)', boxShadow: '0 0 6px var(--color-ai-glow)' }} />
        <text.p className="!text-[13px] !font-semibold !mb-0">{title}</text.p>
        {tooltip && (
          <InfoTooltip
            content={tooltip}
            iconClassName="size-[13px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            contentClassName="p-1 max-w-[240px] text-xs"
          />
        )}
        {subtitle && (
          <text.p emphasis="passive" className="!text-[11px] !mt-0.5 !mb-0 !pl-[14px]">{subtitle}</text.p>
        )}
      </div>

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
    </div>
  )
}
