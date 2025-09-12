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

    console.log('FullStory initialized with official SDK')
  }, [])

  return <>{children}</>
}
