'use client'

import dynamic from 'next/dynamic'
import { ComponentType, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import * as ReactIntl from 'react-intl'

import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { ensurePropTypes } from '@/utils/propTypes'
import { shimReactInternals } from '@/utils/reactCompat'

/**
 * Props for the CDS ComponentLoader.
 * Uses Record type to allow for the dynamic props the CDS library accepts.
 */
interface CdsComponentLoaderProps extends Record<string, unknown> {
  /** CDS component type identifier */
  type: string
  /** CDS configuration object */
  cds?: unknown
  /** Component subtype (e.g., 'SinglePlanUpgrade', 'StandaloneAddon') */
  subType?: string
  /** UX component dependencies with module and version */
  deps?: Record<string, { module: unknown; version: string }>
  /** Locale for i18n */
  locale?: string
  /** Loading component to show while CDS loads */
  LoadingComponent?: ReactNode
  /** Error fallback render function - receives the actual error */
  renderErrorFallback?: (error: Error) => ReactNode
  /** Source identifier for analytics */
  source?: string
  /** Callback when CDS/UPP fails */
  onLoadError?: (error: Error) => void
}

/**
 * Dynamically loaded CDS ComponentLoader with required global setup.
 */
const DynamicComponentLoader: ComponentType<CdsComponentLoaderProps> = dynamic(
  async () => {
    try {
      shimReactInternals()
      const [, cdsLoaderModule] = await Promise.all([
        ensurePropTypes(),
        import('@venture/cds-loader'),
      ])

      if (typeof window !== 'undefined') {
        if (!(window as any).ux) {
          (window as any).ux = {}
        }
        (window as any).ux.intl = ReactIntl
      }

      return cdsLoaderModule.default
    } catch (error) {
      logger.error('cds-loader.dynamic-import.failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      shipAnalyticsLog('paywall.cds.import.failed', {
        error: error instanceof Error ? error.message : String(error),
        errorType: 'dynamic_import',
        component: 'cdsLoader',
      })
      throw error
    }
  },
  { ssr: false }
)

/**
 * CDS ComponentLoader with error handling for:
 * 1. Async errors from CDS/UPP (via onError callback)
 * 2. CDS internal fallback detection (MutationObserver)
 *
 * Render errors should be caught by the parent ErrorBoundary in container components.
 */
export function ComponentLoader({
  renderErrorFallback,
  source,
  onLoadError,
  ...props
}: CdsComponentLoaderProps) {
  const [error, setError] = useState<Error | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleError = useCallback((err: Error) => {
    logger.error('cds-loader.error', {
      error: err.message,
      source,
      stack: err.stack,
    })
    shipAnalyticsLog('paywall.cds.error', {
      source,
      error: err.message,
      errorType: 'cds_callback',
      component: 'cdsLoader',
    })
    setError(err)
    onLoadError?.(err)
  }, [source, onLoadError])

  // Detect CDS's internal fallback-container
  // CDS has a hardcoded FallbackComponent that cannot be overridden via props
  // TODO: remove once CDS is updated to allow for an error fallback component
  useEffect(() => {
    const container = containerRef.current
    if (!container || error) return

    const checkForFallback = () => {
      if (container.querySelector('[data-testid="fallback-container"]')) {
        const fallbackError = new Error('CDS internal error - fallback component rendered')
        logger.error('cds-loader.internal-fallback-detected', { source })
        shipAnalyticsLog('paywall.cds.internal-fallback.detected', {
          source,
          errorType: 'internal_fallback',
          component: 'cdsLoader',
        })
        setError(fallbackError)
        onLoadError?.(fallbackError)
      }
    }

    checkForFallback()
    const observer = new MutationObserver(checkForFallback)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [source, error, onLoadError])

  if (error) {
    return renderErrorFallback ? <>{renderErrorFallback(error)}</> : null
  }

  return (
    <div ref={containerRef}>
      <DynamicComponentLoader source={source} onError={handleError} {...props} />
    </div>
  )
}
