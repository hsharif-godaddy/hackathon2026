import { headers } from 'next/headers'

import { getServerFeatureFlags } from '@/lib/server-features'
import HomeContent from './HomeContent'

// Force dynamic rendering so feature flags are read at request time, not build time
export const dynamic = 'force-dynamic'

export default async function Home() {
  const headersList = await headers()
  const serverFeatures = await getServerFeatureFlags({ headers: headersList })

  return <HomeContent serverFeatures={serverFeatures} />
}
