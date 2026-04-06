import { getServerFeatureFlags } from '@/lib/server-features'
import HomeContent from './HomeContent'

// Force dynamic rendering so feature flags are read at request time, not build time
export const dynamic = 'force-dynamic'

export default function Home() {
  const serverFeatures = getServerFeatureFlags()

  return <HomeContent serverFeatures={serverFeatures} />
}
