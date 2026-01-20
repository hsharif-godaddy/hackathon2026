import { useTranslations } from '@/hooks/useTranslations'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/lib/shadcn/tooltip'

interface PageData {
  page: string
  visitors: number
}

interface AnalyticsTablesProps {
  pageData: PageData[]
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
  pageData
}: AnalyticsTablesProps) {
  const t = useTranslations()

  const renderTable = <T extends { visitors: number }>(
    title: string,
    data: T[],
    keyField: keyof T,
    getDescription: (row: T) => string
  ) => {
    return (
      <div className="flex flex-col gap-4 rounded-md border border-border bg-intents-ux-box-backgroundColor p-2">
        <div className="flex items-center justify-between text-sm font-medium">
          <p className="capitalize">{title}</p>
          <p>{t('builder_analytics_table_views')}</p>
        </div>
        {data.length === 0 ? (
          <p className="text-base text-muted-foreground md:text-sm">
            {t('builder_analytics_table_no_data')}
          </p>
        ) : (
          <div className="space-y-2">
            {data.map((row, index) => {
              const value = String(row[keyField])
              const description = getDescription(row)

              return (
                <Tooltip key={index}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between text-sm cursor-pointer hover:opacity-80 transition-opacity">
                      <span className="capitalize">{value}</span>
                      <span>{row.visitors}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-background text-foreground border border-border shadow-lg">
                    <div className="flex flex-col gap-0">
                      <div className="text-sm font-semibold leading-none">{t('builder_analytics_table_count_visitors', {count: row.visitors})}</div>
                      <div className="text-xs text-muted-foreground mt-1.5">{description}</div>
                    </div>
                  </TooltipContent>
                </Tooltip>
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
    <div className="grid grid-cols-1 gap-6">
      {renderTable('page', pageData, 'page', getPageDescription)}
    </div>
  )
}

