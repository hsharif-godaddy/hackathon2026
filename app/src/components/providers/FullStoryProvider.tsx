'use client'

import { useEffect, useRef } from 'react'
import * as FS from '@fullstory/browser'

import { isLocalDev } from '@/utils/is-local-dev'

export default function FullStoryProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // Ref persists for component's lifetime (not reset on re-render) to prevent double initialization
  // in React strict mode, which intentionally mounts components twice in development
  const initializedRef = useRef(false)

  useEffect(() => {
    // Guard against double initialization (React strict mode in development)
    if (initializedRef.current) {
      return
    }

    if (isLocalDev()) {
      return
    }

    // Initialize FullStory with cross-domain iframe recording
    FS.init({
      orgId: 'YKBRC',
      recordCrossDomainIFrames: true
    })

    // Add global unmask class to body for dashboard selector
    document.body.classList.add('fs-unmask-airo-app-builder')

    initializedRef.current = true
  }, [])

  return <>{children}</>
}
