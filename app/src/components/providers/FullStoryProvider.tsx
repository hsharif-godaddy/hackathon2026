'use client'

import { useEffect } from 'react'
import * as FS from '@fullstory/browser'

export default function FullStoryProvider({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    // Only initialize FullStory in production (not on localhost/local networks)
    const isLocalhost = typeof window !== 'undefined' &&
      (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '::1' ||
        window.location.hostname.startsWith('192.168.') ||
        window.location.hostname.startsWith('10.')
      )

    if (isLocalhost) {
      return
    }

    // Initialize FullStory with cross-domain iframe recording
    FS.init({
      orgId: 'YKBRC',
      recordCrossDomainIFrames: true
    })

    // Add global unmask class to body for dashboard selector
    document.body.classList.add('fs-unmask-airo-app-builder')

    console.log('🔍 FullStory initialized - main app + iframe capture ready')
  }, [])

  return <>{children}</>
}
