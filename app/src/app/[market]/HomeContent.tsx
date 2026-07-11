'use client'

import { useParams, useRouter } from 'next/navigation'
import { Suspense, useCallback, useEffect } from 'react'
import Box from '@ux/box'
import Spinner from '@ux/spinner'

import { CdsEsmPreload } from '@/app/[market]/develop/components/paywall'
import ErrorBoundary from '@/components/ErrorBoundary'
import { HomePage } from '@/components/home-page/HomePage'
import { isFeatureEnabled } from '@/lib/features'
import { mockAuthManager } from '@/lib/mock-auth'
import type { ServerFeatureFlags } from '@/lib/server-features'

function hasFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('Files') ||
    Array.from(e.dataTransfer.items || []).some(item => item.kind === 'file')
}

interface HomeContentProps {
  serverFeatures: ServerFeatureFlags
}

export default function HomeContent({ serverFeatures }: HomeContentProps) {
  const router = useRouter()
  const params = useParams<{ market: string }>()

  useEffect(() => {
    if (!isFeatureEnabled.mockLogin()) return
    const authState = mockAuthManager.getState()
    if (authState.isAuthenticated) {
      router.replace(`/apps`)
    }
    return mockAuthManager.subscribe((state) => {
      if (state.isAuthenticated) {
        router.replace(`/apps`)
      }
    })
  }, [router, params.market])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault()
  }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault()
  }, [])

  return (
    <div className="contents" onDragOver={handleDragOver} onDrop={handleDrop}>
      <Suspense fallback={
        <Box
          className="min-h-screen"
          inlineAlignChildren='center'
          blockAlignChildren='center'
        >
          <Spinner />
        </Box>
      }>
        <HomePage serverFeatures={serverFeatures} />
      </Suspense>
      <ErrorBoundary fallback={() => null}>
        <CdsEsmPreload />
      </ErrorBoundary>
    </div>
  )
}
