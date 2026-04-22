import text from '@ux/text'

import { ContentTooltip } from '@/components/ui/ContentTooltip'
import { useTranslations } from '@/hooks/useTranslations'

interface PageData {
  page: string
  visitors: number
}

interface AnalyticsTablesProps {
  pageData: PageData[]
  /** Table title (e.g. "Page Views" or "Type of Clicks") */
  tableTitle?: string
  /** Column header for the value (e.g. "Views" or "Clicks") */
  valueHeader?: string
}

/**
 * Tables component displaying pages
 *
 * Shows a table for page analytics.
 * Displays empty state when no data is available.
 * Includes hover tooltips for each row showing detailed information.
 *
 * @param pageData - Array of page data with visitor counts
 */
export function AnalyticsTables({
  pageData,
  tableTitle = 'page',
  valueHeader
}: AnalyticsTablesProps) {
  const t = useTranslations()
  const valueLabel = valueHeader ?? t('builder_analytics_table_views')

  const renderTable = <T extends { visitors: number }>(
    title: string,
    data: T[],
    keyField: keyof T,
    getDescription: (row: T) => string
  ) => {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-intents-ux-box-backgroundColor p-2 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px">
        <div className="flex items-center justify-between text-sm font-medium">
          <div className="flex items-center gap-2">
            <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-ai)', boxShadow: '0 0 6px var(--color-ai-glow)' }} />
            <text.p className="!capitalize !text-[13px] !font-semibold !mb-0">{title}</text.p>
          </div>
          <text.p emphasis="passive" className="!text-xs !uppercase !tracking-wider !mb-0">{valueLabel}</text.p>
        </div>
        {data.length === 0 ? (
          <text.p emphasis="passive">
            {t('builder_analytics_no_data')}
          </text.p>
        ) : (
          <div className="space-y-2">
            {data.map((row, index) => {
              const value = String(row[keyField])
              const description = getDescription(row)

              return (
                <ContentTooltip
                  key={value}
                  content={
                    <div className="flex flex-col gap-0">
                      <div className="text-sm font-semibold leading-none">{t('builder_analytics_table_count_visitors', {count: row.visitors})}</div>
                      <div className="text-xs text-muted-foreground mt-1.5">{description}</div>
                    </div>
                  }
                  contentClassName="p-1"
                >
                  <div className="flex items-center justify-between gap-3 text-sm cursor-pointer hover:opacity-80 transition-opacity">
                    <text.span className="!truncate !min-w-0">{value}</text.span>
                    <text.span className="!flex-shrink-0 !tabular-nums !font-semibold">{row.visitors}</text.span>
                  </div>
                </ContentTooltip>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const getPageDescription = (row: PageData) => {
    return `${t('builder_analytics_table_number_views')} - ${row.page === '/' ? t('builder_common_home') : row.page} ${t('builder_common_page')}.`
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {renderTable(tableTitle, pageData, 'page', getPageDescription)}
    </div>
  )
}

