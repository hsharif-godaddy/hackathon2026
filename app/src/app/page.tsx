import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getControlPlaneAdapter } from '@/lib/control-plane'
import { isFeatureEnabled } from '@/lib/features'
import { isAuthDisabledSync } from '@/lib/gasket-config'
import { getServerFeatureFlags } from '@/lib/server-features'
import HomeContent from './HomeContent'

// Force dynamic rendering so feature flags are read at request time, not build time
export const dynamic = 'force-dynamic'

function isNextRedirect(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('digest' in err)) return false
  const digest = (err as Record<string, unknown>).digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

export default async function Home() {
  const serverFeatures = getServerFeatureFlags()

  if (!isAuthDisabledSync() && !isFeatureEnabled.mockLogin()) {
    try {
      const token = (await cookies()).get('auth_idp')?.value
      if (token) {
        const sites = await getControlPlaneAdapter().listSites(token)
        if (sites.length > 0) {
          redirect('/apps')
        }
      }
    } catch (err) {
      if (isNextRedirect(err)) throw err
    }
  }

  return <HomeContent serverFeatures={serverFeatures} />
}
