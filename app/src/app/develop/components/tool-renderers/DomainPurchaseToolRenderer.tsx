'use client'

import Box from '@ux/box'
import CartIcon from '@ux/icon/cart'
import text from '@ux/text'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import DomainPurchaseWidget from '@/app/develop/components/widgets/DomainPurchaseWidget'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Domain Purchase Tool Renderer
 *
 * Renders the domain purchase widget for searching and buying domains.
 * Shows the full widget only when this is the last assistant message and not streaming;
 * otherwise shows a simple summary to avoid API calls from history.
 *
 * Wrapped in ErrorBoundary so checkout SDK errors don't crash the develop page.
 */
export default function DomainPurchaseToolRenderer({
  toolStatus,
  input,
  result,
  isLastAssistantMessage
}: DefaultToolRendererProps) {
  const t = useTranslations()

  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
  const widgetData = resultObj.widgetData as { brandName?: string; domain?: string; appId?: string } | undefined
  const brandName = widgetData?.brandName || (input?.brandName as string | undefined)
  const domain = widgetData?.domain || (input?.domain as string | undefined)
  const appId = widgetData?.appId || (input?.appId as string | undefined)

  const displayName = t('builder_tools_domain_purchase')

  return (
    <div>
      <ToolHeader
        icon={<CartIcon className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={false}
      />

      {toolStatus === 'completed' && (
        <div className="my-2">
          <ErrorBoundary>
            {isLastAssistantMessage ? (
              <DomainPurchaseWidget brandName={brandName} domain={domain} appId={appId} />
            ) : (
              <Box
                className="rounded-2xl border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor p-4"
                orientation="vertical"
                gap="md"
              >
                <text.strong size={0}>
                  {t('builder_domain_purchase_title')}
                </text.strong>
              </Box>
            )}
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
