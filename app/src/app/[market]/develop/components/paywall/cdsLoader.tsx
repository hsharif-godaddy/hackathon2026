'use client'

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as ReactIntl from 'react-intl'
import depsEsm from '@cds/deps-esm'
import CdsComponentLoader from '@venture/cds-loader'

import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { ensurePropTypes } from '@/utils/propTypes'
import { shimReactInternals } from '@/utils/reactCompat'

shimReactInternals()

// UMD CDS components expect PropTypes and react-intl on window globals.
// The ESM path injects deps directly, but UMD fallback still needs these.
if (typeof window !== 'undefined') {
  if (!(window as unknown as Record<string, unknown>).ux) {
    (window as unknown as Record<string, unknown>).ux = {}
  }
  ;(window as unknown as Record<string, Record<string, unknown>>).ux.intl = ReactIntl as unknown as Record<string, unknown>
  ensurePropTypes().catch((err: Error) =>
    logger.error('cdsLoader.propTypesLoadFailed', { error: err.message })
  )
}

interface CdsComponentLoaderProps extends Record<string, unknown> {
  type: string
  cds?: unknown
  subType?: string
  deps?: Record<string, unknown>
  locale?: string
  loaderMode?: string
  // Widens upstream @venture/cds-loader (ReactElement | null) to accept the factory form we pass.
  LoadingComponent?: ReactNode | (() => ReactNode)
  renderErrorFallback?: (error: Error) => ReactNode
  source?: string
  onLoadError?: (error: Error) => void
}

// TODO: remove MutationObserver fallback detection once CDS surfaces proper
// error callbacks. The onError prop is already wired; once CDS fires it for
// load failures, the entire observer block can be deleted.
//
// The CDS ESM loader temporarily renders a FallbackComponent div during async
// import map setup. To avoid treating that transient state as a real error, the
// observer starts immediately but only acts on fallback-container elements that
// persist for this duration.
const FALLBACK_DEBOUNCE_MS = 5000

export function ComponentLoader({
  renderErrorFallback,
  source,
  onLoadError,
  ...props
}: CdsComponentLoaderProps) {
  const [error, setError] = useState<Error | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLoadErrorRef = useRef(onLoadError)
  const erroredRef = useRef(false)

  const handleError = useCallback((err: Error) => {
    if (erroredRef.current) return
    erroredRef.current = true
    observerRef.current?.disconnect()
    logger.error('cds-loader.error', { error: err.message, source, stack: err.stack })
    shipAnalyticsLog('paywall.cds.error', {
      source,
      error: err.message,
      errorType: 'cds_callback',
      component: 'cdsLoader',
    })
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setError(err)
    onLoadError?.(err)
  }, [source, onLoadError])

  onLoadErrorRef.current = onLoadError

  useEffect(() => {
    const container = containerRef.current
    if (!container || error) return

    const triggerFallbackError = () => {
      if (erroredRef.current) return
      erroredRef.current = true
      observerRef.current?.disconnect()
      const fallbackError = new Error('CDS internal error - fallback component rendered')
      logger.error('cds-loader.internal-fallback-detected', { source, type: props.type, subType: props.subType })
      shipAnalyticsLog('paywall.cds.internal-fallback.detected', {
        source,
        type: props.type,
        subType: props.subType,
        errorType: 'internal_fallback',
        component: 'cdsLoader',
      })
      setError(fallbackError)
      onLoadErrorRef.current?.(fallbackError)
    }

    const checkForFallback = () => {
      if (erroredRef.current) return
      const hasFallback = !!container.querySelector('[data-testid="fallback-container"]')
      if (hasFallback && !debounceRef.current) {
        debounceRef.current = setTimeout(() => {
          if (container.querySelector('[data-testid="fallback-container"]')) {
            triggerFallbackError()
          }
          debounceRef.current = null
        }, FALLBACK_DEBOUNCE_MS)
      } else if (!hasFallback && debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }

    checkForFallback()
    observerRef.current = new MutationObserver(checkForFallback)
    observerRef.current.observe(container, { childList: true, subtree: true })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = null
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [source, error])

  if (error) return renderErrorFallback ? <>{renderErrorFallback(error)}</> : null

  const loader = (
    <div ref={containerRef} className="cds-paywall-portal" data-testid="cds-loader-root">
      <CdsComponentLoader source={source} onError={handleError} {...props} {...(props.loaderMode === 'esm' && { deps: depsEsm })} />
    </div>
  )

  // UPP mounts #UpgradeLibraryPortal inside this wrapper and @ux/disrupt sets
  // data-inert + overflow:hidden on that parent. On mobile develop, ancestors
  // also use overflow-hidden/ios-fixed-container. Portaling to body avoids the
  // ancestor chain; paywall SCSS overrides data-inert clipping on the portal.
  if (typeof document === 'undefined') {
    return loader
  }

  return createPortal(loader, document.body)
}
