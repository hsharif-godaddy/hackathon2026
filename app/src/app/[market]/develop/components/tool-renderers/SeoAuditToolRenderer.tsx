'use client'

import { Search } from 'lucide-react'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import SeoAuditReportWidget, {
  type SeoAuditReportView,
} from '@/app/[market]/develop/components/widgets/SeoAuditReportWidget'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useTranslations } from '@/hooks/useTranslations'

function extractWidgetPayload(result: DefaultToolRendererProps['result']): {
  report?: SeoAuditReportView
  offerFix?: boolean
  appId?: string
} | null {
  if (!result || typeof result !== 'object') return null
  const resultObj = result as Record<string, unknown>
  const output =
    resultObj.output && typeof resultObj.output === 'object'
      ? (resultObj.output as Record<string, unknown>)
      : resultObj
  const widgetData = output.widgetData as Record<string, unknown> | undefined
  if (!widgetData?.report) return null
  return {
    report: widgetData.report as SeoAuditReportView,
    offerFix: widgetData.offerFix === true,
    appId: typeof widgetData.appId === 'string' ? widgetData.appId : undefined,
  }
}

export default function SeoAuditToolRenderer({
  toolName,
  toolStatus,
  result,
  isLastAssistantMessage,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const payload = extractWidgetPayload(result)
  const displayName =
    toolName === 'seoAnalysis'
      ? t('builder_tools_seo_analysis', undefined, 'SEO analysis')
      : t('builder_tools_seo_audit', undefined, 'SEO audit')

  if (toolStatus !== 'completed' || !payload?.report) {
    return (
      <ToolHeader
        icon={<Search className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={false}
      />
    )
  }

  return (
    <div>
      <ToolHeader
        icon={<Search className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={false}
      />
      <ErrorBoundary>
        <SeoAuditReportWidget
          appId={payload.appId ?? payload.report.appId}
          report={payload.report}
          offerFix={payload.offerFix}
          fixEnabled={isLastAssistantMessage === true}
        />
      </ErrorBoundary>
    </div>
  )
}
