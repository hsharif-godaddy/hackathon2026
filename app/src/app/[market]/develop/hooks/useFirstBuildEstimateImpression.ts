import { useCallback, useRef } from 'react'

import { useAnalytics } from '@/hooks/useAnalytics'

/**
 * Returns a `markShown` callback that logs a "pill shown" impression the first
 * time it is called for the current app.
 *
 * The callback is meant to be wired to the pill's OWN render (e.g. an effect in
 * the component that draws the pill), not to the gating value. This guarantees
 * the impression reflects a pill the user actually saw: early-return states such
 * as a failed build, resume, or image-reload — which can satisfy the gating
 * conditions but render a different screen — never invoke it.
 *
 * @param appId - Current app id; resets the once-per-app guard when it changes.
 * @returns A stable callback to invoke from where the pill renders.
 */
export function useFirstBuildEstimateImpression(appId: string): () => void {
  const { logAnalytics } = useAnalytics({})
  const loggedRef = useRef(false)
  const lastAppIdRef = useRef(appId)

  // Reset the once-per-app guard during render (before any child effects run),
  // so a genuine app switch re-arms the impression with correct ordering
  // relative to the child effect that calls the returned callback.
  if (lastAppIdRef.current !== appId) {
    lastAppIdRef.current = appId
    loggedRef.current = false
  }

  return useCallback(() => {
    if (loggedRef.current) {
      return
    }
    loggedRef.current = true
    logAnalytics(
      'firstBuildTimeEstimate.shown',
      { appId },
      { kind: 'impression', eid: 'develop.firstBuildTimeEstimate.shown', impressionProps: { appId } },
    )
  }, [appId, logAnalytics])
}
