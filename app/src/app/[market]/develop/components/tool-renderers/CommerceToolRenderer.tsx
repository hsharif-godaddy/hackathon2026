'use client'

import { ShoppingBag } from 'lucide-react'
import { useState } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { getToolDisplayName } from '@/utils/toolNameMapping'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

/** Internal fields that should never be shown to users. */
const HIDDEN_KEYS = new Set([
  'storeId', 'skuId', 'skuGroupId', 'priceId', 'locationId',
  'channelId', 'mediaObjectId', 'orderId',
  'manageLinks', 'manageUrl', 'dashboardLinks',
  'accessToken', 'token', 'redirectUrl', 'state',
])

function isHiddenKey(key: string): boolean {
  return HIDDEN_KEYS.has(key) || key.endsWith('Url') || key.endsWith('url')
}

/**
 * Parse commerce tool result into display state.
 *
 * Commerce tools return:
 *   { success: true, data: { ... } }
 *   { success: false, error: "..." }
 *   { needsAuth: true, ... }
 */
function parseResult(raw: unknown): {
  status: 'success' | 'error' | 'auth' | 'info'
  message: string
} {
  if (!raw) return { status: 'success', message: 'Completed' }

  let obj: Record<string, unknown>
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return { status: 'success', message: 'Completed' } }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  } else {
    return { status: 'success', message: 'Completed' }
  }

  if (obj.needsAuth === true) {
    return { status: 'auth', message: 'Authentication required' }
  }

  // withCommerceAuth wraps results as { success: true, data: { ... } } —
  // unwrap so we can detect needsInfo/message inside data.
  const payload = obj.success === true && typeof obj.data === 'object' && obj.data !== null
    ? obj.data as Record<string, unknown>
    : obj

  if (payload.needsInfo === true) {
    return { status: 'info', message: typeof payload.message === 'string' ? payload.message : 'Additional information needed' }
  }
  if (obj.success === false && typeof obj.error === 'string') {
    return { status: 'error', message: obj.error }
  }
  if (typeof obj.error === 'string' && !('success' in obj)) {
    return { status: 'error', message: obj.error }
  }
  return { status: 'success', message: 'Completed' }
}

/**
 * Custom renderer for commerce skill tools.
 *
 * Shows a clean status view instead of raw JSON.  Tool results contain
 * internal API data (store IDs, service URLs) that should not be exposed.
 */
export default function CommerceToolRenderer({
  toolName,
  toolStatus,
  input,
  result,
  error,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)

  const displayName = getToolDisplayName(toolName)
  const parsed = result ? parseResult(result) : null
  const hasDetails = Boolean(error || parsed)

  // Filter arguments to user-meaningful scalar fields only (hide objects/arrays)
  const visibleArgs = input && typeof input === 'object'
    ? Object.entries(input as Record<string, unknown>).filter(
        ([k, v]) => !isHiddenKey(k) && v != null && typeof v !== 'object'
      )
    : []

  return (
    <div>
      <ToolHeader
        icon={<ShoppingBag className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={displayName}
      >
        <div className="flex-1 overflow-y-auto space-y-2">
          {/* Status */}
          {toolStatus === 'completed' && parsed && (
            <>
              {parsed.status === 'success' && (
                <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                  <span>&#10003;</span>
                  <span>{parsed.message}</span>
                </div>
              )}
              {parsed.status === 'error' && (
                <div>
                  <div className="text-sm font-bold mb-1 text-destructive">{t('builder_status_error')}</div>
                  <div className="bg-destructive/10 border border-destructive/30 p-1.5 rounded">
                    <pre className="text-xs whitespace-pre-wrap font-mono text-destructive-foreground">
                      {parsed.message}
                    </pre>
                  </div>
                </div>
              )}
              {parsed.status === 'info' && (
                <div className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 font-medium">
                  <span>&#8505;</span>
                  <span>{parsed.message}</span>
                </div>
              )}
              {parsed.status === 'auth' && (
                <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 font-medium">
                  <span>&#128274;</span>
                  <span>{parsed.message}</span>
                </div>
              )}
            </>
          )}

          {/* AI SDK level error */}
          {error && (
            <div>
              <div className="text-sm font-bold mb-1 text-destructive">{t('builder_status_error')}</div>
              <div className="bg-destructive/10 border border-destructive/30 p-1.5 rounded">
                <pre className="text-xs whitespace-pre-wrap font-mono text-destructive-foreground">
                  {error}
                </pre>
              </div>
            </div>
          )}

          {/* Filtered arguments */}
          {visibleArgs.length > 0 && (
            <div>
              <div className="text-sm font-bold mb-1">{t('builder_tools_default_arguments')}</div>
              <div className="bg-muted p-1.5 rounded border border-border">
                <dl className="space-y-0.5">
                  {visibleArgs.map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-xs">
                      <dt className="font-mono text-foreground/60 min-w-[100px] flex-shrink-0">
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()}:
                      </dt>
                      <dd className="text-foreground break-all">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
        </div>
      </ToolModal>
    </div>
  )
}
