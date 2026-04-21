'use client'

import Features from '@/components/layout/Features'
import { LandingFeaturesData } from './types'

export default function LandingFeatures({ items }: LandingFeaturesData) {
  return <Features features={items} />
}
