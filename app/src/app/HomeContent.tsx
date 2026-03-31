'use client'

import { Suspense } from 'react'
import Box from '@ux/box'
import Spinner from '@ux/spinner'

import { HomePageByCohort } from '@/experiments/homepage-engagement-variations'
import type { ServerFeatureFlags } from '@/lib/server-features'

interface HomeContentProps {
  serverFeatures: ServerFeatureFlags
}

export default function HomeContent({ serverFeatures }: HomeContentProps) {
  return (
    <Suspense fallback={
      <Box
        className="min-h-screen"
        inlineAlignChildren='center'
        blockAlignChildren='center'
      >
        <Spinner />
      </Box>
    }>
      <HomePageByCohort serverFeatures={serverFeatures} />
    </Suspense>
  )
}
