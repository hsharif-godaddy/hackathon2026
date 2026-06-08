'use client'

import { useEffect, useRef, useState } from 'react'
import depsEsm from '@cds/deps-esm'
import CdsComponentLoader from '@venture/cds-loader'

import { useGasketData } from '@/hooks/useGasketData'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { PAYWALL_UMD_FALLBACK } from './cdsConfig'

declare global {
  interface Window {
    __CDS_IMPORT_MAP_SETUP__?: boolean
    __CDS_IMPORT_MAP_PROMISE__?: Promise<void>
  }
}

const UPP_TYPE = 'godaddyUnifiedPlansAndPricingLibraryEsm'
const LOCAL_DEV_URL = 'http://localhost:9000'
const IMPORT_MAP_POLL_INTERVAL_MS = 200
const IMPORT_MAP_TIMEOUT_MS = 10000
const WARM_CACHE_IMPORT_TIMEOUT_MS = 15000

function getVersionOverride(): string | null {
  if (typeof window === 'undefined') return null

  const lsRaw = localStorage.getItem('cdsVersion')
  if (lsRaw) {
    try {
      const parsed = JSON.parse(lsRaw)?.[UPP_TYPE]
      if (parsed) return parsed
    } catch { /* ignore malformed JSON */ }
  }

  const qsVal = new URLSearchParams(window.location.search).get('cdsVersion')
  if (qsVal) {
    const [type, version] = qsVal.split('--')
    if (type === UPP_TYPE) return version
  }

  return null
}

function buildEntryUrl(
  cdnBaseUrl: string,
  entry: string,
  versionOverride: string | null,
): string {
  if (versionOverride === 'local') {
    const localEntry = entry.replace(/^[^.]+\./, 'local.')
    return `${LOCAL_DEV_URL}/esm/${UPP_TYPE}/${localEntry}`
  }

  if (versionOverride) {
    const overrideEntry = entry.replace(/^[^.]+\./, `${versionOverride}.`)
    return `${cdnBaseUrl}/esm/${UPP_TYPE}/${overrideEntry}`
  }

  return `${cdnBaseUrl}/esm/${UPP_TYPE}/${entry}`
}

export function getUppEntryUrl(registry: Record<string, unknown>): string | null {
  try {
    const config = registry[UPP_TYPE] as { js?: string; cdnBaseUrl?: string } | undefined
    if (!config?.js || !config?.cdnBaseUrl) return null

    const versionOverride = getVersionOverride()
    return buildEntryUrl(config.cdnBaseUrl, config.js, versionOverride)
  } catch {
    return null
  }
}

async function callWarmCache(registry: Record<string, unknown>): Promise<void> {
  const url = getUppEntryUrl(registry)
  if (!url) return

  const importWithTimeout = Promise.race([
    import(/* webpackIgnore: true */ url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('warmCache import timeout')), WARM_CACHE_IMPORT_TIMEOUT_MS)
    ),
  ])

  const mod = await importWithTimeout
  const warmCache = (mod as { warmCache?: () => Promise<void> })?.warmCache
  if (typeof warmCache === 'function') {
    await warmCache()
  } else {
    logger.warn('paywall.cds.preload.warmCache.missing', { url })
  }
}

export function CdsEsmPreload() {
  const umdFallback = useSwitchboard(PAYWALL_UMD_FALLBACK) ?? false
  const gasketData = useGasketData()
  const [initialized, setInitialized] = useState(false)
  const registryMissingLoggedRef = useRef(false)

  useEffect(() => {
    if (umdFallback) return

    const checkReady = () => {
      if (window.__CDS_IMPORT_MAP_SETUP__) {
        clearInterval(interval)
        clearTimeout(timeout)
        const importMapReady = window.__CDS_IMPORT_MAP_PROMISE__ ?? Promise.resolve()
        const registry = (gasketData?.cds?.registry ?? {}) as Record<string, unknown>
        importMapReady
          .then(() => callWarmCache(registry))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn('paywall.cds.preload.warmCache.failed', { error: message })
            shipAnalyticsLog('paywall.cds.preload.warmCache.failed', {
              error: message,
              component: 'CdsEsmPreload',
            })
          })
          .finally(() => {
            setInitialized(true)
          })
      }
    }

    const interval = setInterval(checkReady, IMPORT_MAP_POLL_INTERVAL_MS)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      logger.warn('paywall.cds.preload.importMap.timeout', {})
      shipAnalyticsLog('paywall.cds.preload.importMap.timeout', {
        component: 'CdsEsmPreload',
      })
      setInitialized(true)
    }, IMPORT_MAP_TIMEOUT_MS)

    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [umdFallback, gasketData?.cds?.registry])

  if (umdFallback) return null

  if (initialized || !gasketData?.cds) return null

  const uppConfig = (gasketData.cds.registry as Record<string, { js?: string; cdnBaseUrl?: string } | undefined> | undefined)?.[UPP_TYPE]
  if (!uppConfig?.js || !uppConfig?.cdnBaseUrl) {
    if (!registryMissingLoggedRef.current) {
      registryMissingLoggedRef.current = true
      logger.warn('paywall.cds.preload.registry.missing', {})
      shipAnalyticsLog('paywall.cds.preload.registry.missing', {
        component: 'CdsEsmPreload',
      })
    }
    return null
  }

  return (
    <div className="hidden" aria-hidden="true">
      <CdsComponentLoader
        type={UPP_TYPE}
        loaderMode="esm"
        subType="UpgradeLoadingSkeleton"
        source="preload"
        cds={gasketData.cds}
        deps={ depsEsm }
        locale={gasketData?.intl?.locale || 'en-US'}
        LoadingComponent={null}
        onError={(err: Error) => {
          logger.warn('paywall.cds.preload.load.failed', { error: err?.message })
          shipAnalyticsLog('paywall.cds.preload.load.failed', {
            source: 'preload',
            error: err?.message,
            component: 'CdsEsmPreload',
          })
          setInitialized(true)
        }}
      />
    </div>
  )
}
