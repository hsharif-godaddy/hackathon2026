'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { shipAnalyticsLog } from '@/lib/logging'
import { LEGACY_MODE_PARAM, MODE_PARAM } from '@/lib/mode-param'

/**
 * On a durable landing surface, rewrites a legacy `?template=` URL to the
 * canonical `?mode=` form once per load (adds `mode` if absent, drops
 * `template`) and fires a one-shot retirement log so we can watch legacy
 * traffic drain to zero. No-op when no legacy param is present.
 */
export function useCanonicalizeModeParam(): void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasCanonicalizedRef = useRef<boolean>(false)

  useEffect(() => {
    if (hasCanonicalizedRef.current) return
    const legacy: string | null = searchParams.get(LEGACY_MODE_PARAM)
    if (legacy === null) return

    hasCanonicalizedRef.current = true
    shipAnalyticsLog('mode_param.legacy_used', { param: LEGACY_MODE_PARAM, value: legacy })

    const params: URLSearchParams = new URLSearchParams(searchParams.toString())
    if (params.get(MODE_PARAM) === null) {
      params.set(MODE_PARAM, legacy)
    }
    params.delete(LEGACY_MODE_PARAM)

    const queryString: string = params.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])
}
