'use client'

import { Suspense, useCallback } from 'react'
import Box from '@ux/box'
import Spinner from '@ux/spinner'

import { CdsEsmPreload } from '@/app/[market]/develop/components/paywall'
import ErrorBoundary from '@/components/ErrorBoundary'
import { HomePage } from '@/components/home-page/HomePage'
import type { ServerFeatureFlags } from '@/lib/server-features'

function hasFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('Files') ||
    Array.from(e.dataTransfer.items || []).some(item => item.kind === 'file')
}

interface HomeContentProps {
  serverFeatures: ServerFeatureFlags
}

export default function HomeContent({ serverFeatures }: HomeContentProps) {
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
