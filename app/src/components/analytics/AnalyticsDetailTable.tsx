import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/lib/shadcn/tooltip'

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
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-intents-ux-box-backgroundColor p-4">
        <text.p className="!text-[13px] !font-semibold !mb-0">{title}</text.p>
        <text.p emphasis="passive" className="!text-xs">{t('builder_analytics_no_data')}</text.p>
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-intents-ux-box-backgroundColor shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: 'var(--color-ai)', boxShadow: '0 0 6px var(--color-ai-glow)' }} />
          <text.p className="!text-[13px] !font-bold !tracking-tight !mb-0">{title}</text.p>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="More information" className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
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
          <thead className={maxHeight ? 'sticky top-0 z-10 bg-intents-ux-box-backgroundColor' : ''}>
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
                    ${i === 0 ? 'pl-4 pr-2' : i === columns.length - 1 ? 'pl-2 pr-4' : 'px-2'}
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
                        ${i === 0 ? 'pl-4 pr-2' : i === columns.length - 1 ? 'pl-2 pr-4' : 'px-2'}
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
      <div className="px-4 py-1.5 border-t border-border/40 flex items-center justify-between">
        <text.span className="!text-[10px] !font-medium !text-muted-foreground">
          {data.length} {data.length === 1 ? 'row' : 'rows'}
        </text.span>
      </div>
    </div>
  )
}
