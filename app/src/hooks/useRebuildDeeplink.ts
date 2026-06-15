'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

import { isRebuildModalDirection, type RebuildModalDirection } from '@/lib/rebuild-design-choice'

export interface RebuildDeeplinkConfig {
  url: string
  designDirection?: RebuildModalDirection
}

/** Normalize a bare domain or URL to an https URL, or null if it isn't a plausible host. */
function normalizeRebuildUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Reject anything with internal whitespace before we prepend a scheme.
  if (/\s/.test(trimmed)) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes('.')) return null
    return withScheme
  } catch {
    return null
  }
}

/**
 * Reads the Switchers rebuild deep-link config from homepage query params.
 * Returns null unless a valid `rebuildUrl` is present. This is the single place
 * new deep-link params (e.g. `scope`) get added.
 */
export function useRebuildDeeplink(): RebuildDeeplinkConfig | null {
  const searchParams = useSearchParams()
  const rebuildUrlParam = searchParams.get('rebuildUrl')
  const designDirectionParam = searchParams.get('designDirection')

  return useMemo(() => {
    if (!rebuildUrlParam) return null
    const url = normalizeRebuildUrl(rebuildUrlParam)
    if (!url) return null
    return {
      url,
      designDirection: isRebuildModalDirection(designDirectionParam) ? designDirectionParam : undefined,
    }
  }, [rebuildUrlParam, designDirectionParam])
}
