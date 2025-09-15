'use client'

import { useEffect } from 'react'
import * as FS from '@fullstory/browser'

export default function FullStoryProvider({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
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
