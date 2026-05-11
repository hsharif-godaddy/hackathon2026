import { useEffect, useRef } from 'react'

import { logImpressionEvent } from '@/utils/instrumentation'

interface ImpressionOptions {
  enabled?: boolean
  customProperties?: Record<string, boolean | string | number>
}

export function useImpression(eid: string, { enabled = true, customProperties }: ImpressionOptions = {}): void {
  const hasLoggedRef = useRef(false)

  useEffect(() => {
    if (!enabled || hasLoggedRef.current) {
      return
    }

    hasLoggedRef.current = true
    logImpressionEvent(eid, customProperties)()
  }, [enabled])
}
