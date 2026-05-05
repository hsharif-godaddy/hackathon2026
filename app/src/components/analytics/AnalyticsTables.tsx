import text from '@ux/text'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
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
      <AnalyticsCard
        title={title}
      >
        {data.length === 0 ? (
          <text.p as="caption" size={-1} emphasis="passive">
            {t('builder_analytics_no_data')}
          </text.p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between uppercase border-y-1 p-2">
              <text.span as="caption" emphasis="passive" size={-2}>{t('builder_analytics_page_name')}</text.span>
              <text.span as="caption" emphasis="passive" size={-2}>{valueLabel}</text.span>
            </div>
            {data.map((row) => {
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
      </AnalyticsCard>
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

