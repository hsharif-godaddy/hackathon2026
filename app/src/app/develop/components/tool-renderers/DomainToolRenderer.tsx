'use client'

import Box from '@ux/box'
import CartIcon from '@ux/icon/cart'
import LinkIcon from '@ux/icon/link'
import text from '@ux/text'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import DomainAttachWidget from '@/app/develop/components/widgets/DomainAttachWidget'
import DomainPurchaseWidget from '@/app/develop/components/widgets/DomainPurchaseWidget'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Domain Tool Renderer
 *
 * Renders the appropriate domain widget based on the action (purchase or attach).
 * Shows the full widget only when this is the last assistant message and not streaming;
 * otherwise shows a simple summary to avoid API calls from history.
 *
 * Wrapped in ErrorBoundary so SDK errors don't crash the develop page.
 */
export default function DomainToolRenderer({
  toolStatus,
  input,
  result,
  isLastAssistantMessage
}: DefaultToolRendererProps) {
  const t = useTranslations()

  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
  const widgetData = resultObj.widgetData as { brandName?: string; domain?: string; appId?: string; type?: string } | undefined
  const action = (input?.action as string) || (widgetData?.type === 'domain-attach' ? 'attach' : 'purchase')
  const brandName = widgetData?.brandName || (input?.brandName as string | undefined)
  const domain = widgetData?.domain || (input?.domain as string | undefined)
  const appId = widgetData?.appId || (input?.appId as string | undefined)

  const isAttach = action === 'attach'
  const isSuccess = resultObj.success === true
  const icon = isAttach ? <LinkIcon className="w-2 h-2" /> : <CartIcon className="w-2 h-2" />
  const displayName = isAttach
    ? t('builder_tools_domain_attach', undefined, 'Domain Attach')
    : t('builder_tools_domain_purchase', undefined, 'Domain Purchase')
  const summaryText = isAttach
    ? t('builder_domain_attach_title', undefined, 'Connect a domain')
    : t('builder_domain_purchase_title', undefined, 'Purchase a new domain')

  return (
    <div>
      <ToolHeader
        icon={icon}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={false}
      />

      {toolStatus === 'completed' && isSuccess && (
        <div className="my-2">
          <ErrorBoundary>
            {isLastAssistantMessage ? (
              isAttach
                ? <DomainAttachWidget brandName={brandName} appId={appId} />
                : <DomainPurchaseWidget brandName={brandName} domain={domain} appId={appId} />
            ) : (
              <Box
                className="rounded-2xl border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor p-4"
                orientation="vertical"
                gap="md"
              >
                <text.strong size={0}>
                  {summaryText}
                </text.strong>
              </Box>
            )}
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
