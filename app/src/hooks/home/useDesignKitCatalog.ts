'use client'

import { useCallback, useEffect, useState } from 'react'

import { DESIGN_KIT_BASE_URL, type DesignKit, normalizeCatalog, type RawDesignKitCatalog } from '@/lib/design-kits'

interface CatalogState {
  kits: DesignKit[]
  isLoading: boolean
  error: Error | null
  /** True once a fetch has resolved — distinguishes "not yet loaded" from "loaded, but empty". */
  loaded: boolean
}

interface CatalogStateWithReload extends CatalogState {
  reload: () => void
}

let cache: DesignKit[] | null = null
let inflight: Promise<DesignKit[]> | null = null

export function _resetCatalogCacheForTest(): void {
  cache = null
  inflight = null
}

async function loadCatalog(): Promise<DesignKit[]> {
  if (cache) return cache
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(`${DESIGN_KIT_BASE_URL}/catalog.json`)
      if (!res.ok) throw new Error(`design-kit catalog fetch ${res.status}`)
      const raw = (await res.json()) as RawDesignKitCatalog
      const kits = normalizeCatalog(raw)
      cache = kits
      return kits
    })().catch((err: Error) => { inflight = null; throw err })
  }
  return inflight
}

export function useDesignKitCatalog(enabled: boolean): CatalogStateWithReload {
  const [state, setState] = useState<CatalogState>(() => ({
    kits: enabled ? (cache ?? []) : [],
    isLoading: enabled && !cache,
    error: null,
    loaded: enabled && cache != null,
  }))

  useEffect(() => {
    if (!enabled) return
    if (cache) {
      setState({ kits: cache, isLoading: false, error: null, loaded: true })
      return
    }
    let active = true
    setState((s) => ({ ...s, isLoading: true, error: null }))
    loadCatalog()
      .then((kits) => { if (active) setState({ kits, isLoading: false, error: null, loaded: true }) })
      .catch((error: Error) => { if (active) setState({ kits: [], isLoading: false, error, loaded: false }) })
    return () => { active = false }
  }, [enabled])

  // Allow a fresh attempt after a failed load. loadCatalog() retries the
  // fetch when both cache and inflight are null (the post-error state).
  const reload = useCallback(() => {
    setState((s) => ({ ...s, isLoading: true, error: null }))
    loadCatalog()
      .then((kits) => setState({ kits, isLoading: false, error: null, loaded: true }))
      .catch((error: Error) => setState({ kits: [], isLoading: false, error, loaded: false }))
  }, [])

  return { ...state, reload }
}
