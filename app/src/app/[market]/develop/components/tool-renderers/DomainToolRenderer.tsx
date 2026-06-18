'use client'

import Box from '@ux/box'
import CartIcon from '@ux/icon/cart'
import LinkIcon from '@ux/icon/link'
import text from '@ux/text'

import { DkimStatusBadge } from '@/app/[market]/develop/components/settings/components/DkimStatusBadge'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import DomainAttachWidget from '@/app/[market]/develop/components/widgets/DomainAttachWidget'
import DomainPurchaseWidget from '@/app/[market]/develop/components/widgets/DomainPurchaseWidget'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useDkimAutoOnboard } from '@/hooks/useDkimAutoOnboard'
import { useSwitchboard } from '@/hooks/useSwitchboard'
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
  const displayName = isAttach ? t('builder_tools_domain_attach') : t('builder_tools_domain_purchase')
  const summaryText = isAttach ? t('builder_domain_attach_title') : t('builder_domain_purchase_title')

  // Strict gate on the appbuilder-dkim-onboarding switchboard flag.
  // When the flag is off (or undefined during SSR), no DCC polling or
  // auto-onboard POST happens here. Note: this gate is for the DKIM
  // hooks ONLY — pre-existing domain-attach DCC functionality elsewhere
  // (e.g. useDomainDnsOwnership for pendingDomain in DomainAttach.tsx
  // and DomainAttachWidget.tsx, both used to decide whether to show
  // manual DNS instructions) is independent of this flag and stays
  // working regardless.
  //
  // Also restricted to the CURRENT assistant message: without
  // isLastAssistantMessage gating, every historical domain-attach tool
  // message in the conversation would re-mount these hooks. Hooks
  // still mount unconditionally (rules of hooks) — `enabled: false`
  // is the runtime gate.
  const dkimUiEnabled = useSwitchboard('appbuilder-dkim-onboarding') === true
  const dkimEnabled = dkimUiEnabled && isLastAssistantMessage && isAttach && isSuccess && !!appId && !!domain
  useDkimAutoOnboard({
    appId,
    domain,
    enabled: dkimEnabled,
  })

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
                {isAttach && appId && domain && (
                  <DkimStatusBadge appId={appId} domain={domain} />
                )}
              </Box>
            )}
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
