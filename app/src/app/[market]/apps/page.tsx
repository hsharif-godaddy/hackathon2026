'use client'

import { useRouter } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'

import { PromptModalContent } from '@/app/[market]/apps/components/PromptModalContent'
import ProjectsLayout from '@/app/[market]/projects/ProjectsLayout'
import { ProtectedRoute } from '@/components/auth'
import { DevelopmentAdminSection } from '@/components/development'
import Header from '@/components/layout/Header'
import { useAuth } from '@/hooks/useAuth'
import { useHomepageSubmission } from '@/hooks/useHomepageSubmission'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { SiteStatus } from '@/lib/control-plane/types'
import { isTLAShopper } from '@/lib/is-tla-shopper'
import { logger } from '@/lib/request-context'
import { useSitesStore } from '@/stores/useSitesStore'
import { logImpressionEvent } from '@/utils/instrumentation'

function SitesPageContent() {
  const router = useRouter()
  const t = useTranslations()
  const { authState } = useAuth()
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null)
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false)
  const hp = useHomepageSubmission({ route: 'apps' })
  const sites = useSitesStore((state) => state.allSites)
  const isLoading = useSitesStore((state) => state.isLoadingAll)
  const error = useSitesStore((state) => state.error)
  const stopAllSites = useSitesStore((state) => state.stopAllSites)
  const deleteAllSites = useSitesStore((state) => state.deleteAllSites)
  const refreshSites = useSitesStore((state) => state.refreshSites)
  const isTransferEnabled = useSwitchboard('appbuilder-transfer-ownership')

  const totalSites = sites ? sites.length : 0
  const runningCount = sites
    ? sites.filter((site) => site.status === SiteStatus.Running).length
    : 0

  // Next.js shares the route bundle across all /develop/[id] routes,
  // so one prefetch warms the cache for every card.
  const firstSiteId = sites?.[0]?.id
  useEffect(
    function prefetchDevelopRoute() {
      if (firstSiteId) {
        router.prefetch(`/develop/${firstSiteId}`)
      }
    },
    [router, firstSiteId]
  )

  const isTLA = useMemo(() => isTLAShopper(authState?.details?.shopperId), [authState])

  // Allow transfer when flag is loaded and true, or fall back to TLA check while loading
  const canUseTransfer = useMemo(() => {
    if (isTransferEnabled !== undefined) {
      return isTransferEnabled
    }
    return !isTLA
  }, [isTransferEnabled, isTLA])

  useEffect(() => {
    logImpressionEvent('apps.page.view')()
    refreshSites()
  }, [refreshSites])

  // Refresh the list when the tab becomes visible again. The GET /api/sites it
  // triggers runs the server-side invitee-pull (reconciles the caller's shared
  // apps from their FGA membership), so an invite accepted while this tab sat idle
  // surfaces on the next glance without a manual reload. The pull is throttled
  // server-side, so frequent visibility events don't hammer it. We listen only to
  // visibilitychange (not window focus) because switching back to a tab fires both
  // and we want a single refresh per return, not two back-to-back.
  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshSites()
      }
    }
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [refreshSites])

  const handleAdminStopAll = async () => {
    if (runningCount === 0) return

    setAdminActionLoading('stop-all')
    try {
      await stopAllSites()
    } catch (error) {
      logger.error('sites.stop_all.failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setAdminActionLoading(null)
    }
  }

  const handleAdminDeleteAll = async () => {
    if (totalSites === 0) return

    setAdminActionLoading('delete-all')
    try {
      await deleteAllSites()
    } catch (error) {
      logger.error('sites.delete_all.failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setAdminActionLoading(null)
    }
  }

  if (isLoading && sites.length === 0) {
    return (
      <Box className="min-h-screen flex items-center justify-center" data-partial="accentAiro">
        <Spinner />
      </Box>
    )
  }

  if (error && sites.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header location="sites" />
        <Box className="flex flex-col items-center justify-center flex-1 gap-4">
          <p>{error}</p>
          <Button onClick={refreshSites} text={t('builder_common_try_again')} />
        </Box>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header location="sites" />

      <DevelopmentAdminSection
        totalItems={totalSites}
        runningItems={runningCount}
        itemType="sites"
        onStopAll={handleAdminStopAll}
        onDeleteAll={handleAdminDeleteAll}
        isStopAllLoading={adminActionLoading === 'stop-all'}
        isDeleteAllLoading={adminActionLoading === 'delete-all'}
      />

      <ProjectsLayout
        sites={sites}
        transferAllowed={canUseTransfer}
        onCreateProject={() => setIsPromptModalOpen(true)}
      />

      {isPromptModalOpen && (
        <PromptModalContent hp={hp} onClose={() => setIsPromptModalOpen(false)} />
      )}
    </div>
  )
}

export default function Sites() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={
          <Box className="min-h-screen flex items-center justify-center" data-partial="accentAiro">
            <Spinner />
          </Box>
        }
      >
        <SitesPageContent />
      </Suspense>
    </ProtectedRoute>
  )
}
