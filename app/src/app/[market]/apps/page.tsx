'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Pagination from '@ux/pagination'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'

import AppCard, { AppCardEmptyState, TransferAppCard } from '@/app/[market]/apps/AppCard'
import AcceptTransferDialog from '@/app/[market]/apps/components/AcceptTransferDialog'
import { APPS_GRID_PAGE_SIZE } from '@/app/[market]/apps/constants'
import { ProtectedRoute } from '@/components/auth'
import { DevelopmentAdminSection } from '@/components/development'
import AppInactivityAlert from '@/components/layout/AppInactivityAlert'
import Header from '@/components/layout/Header'
import { useAuth } from '@/hooks/useAuth'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { SiteStatus } from '@/lib/control-plane/types'
import { logger } from '@/lib/request-context'
import { useSitesStore } from '@/stores/useSitesStore'
import { logImpressionEvent } from '@/utils/instrumentation'

function SitesPageContent() {
  const t = useTranslations();
  const router = useRouter();
  const { getUserInfo } = useAuth();
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null)
  const [isAcceptTransferOpen, setIsAcceptTransferOpen] = useState(false)
  const [appsPage, setAppsPage] = useState(1)
  const { data: isTransferEnabled } = useSwitchboard('appbuilder-transfer-ownership')

  const { shopperId } = getUserInfo();
  // TLA (Three Letter Account) shopperIds have 3 or fewer characters
  const isTLA = typeof shopperId === 'string' && shopperId.length <= 3;

  const sites = useSitesStore((state) => state.allSites)
  const isLoading = useSitesStore((state) => state.isLoadingAll)
  const error = useSitesStore((state) => state.error)
  const stopAllSites = useSitesStore((state) => state.stopAllSites)
  const deleteAllSites = useSitesStore((state) => state.deleteAllSites)
  const refreshSites = useSitesStore((state) => state.refreshSites)

  const totalSites = sites ? sites.length : 0
  const runningCount = sites ? sites.filter(site => site.status === SiteStatus.Running).length : 0

  // Next.js shares the route bundle across all /develop/[id] routes,
  // so one prefetch warms the cache for every card.
  const firstSiteId = sites?.[0]?.id;
  useEffect(function prefetchDevelopRoute() {
    if (firstSiteId) {
      router.prefetch(`/develop/${firstSiteId}`);
    }
  }, [router, firstSiteId]);

  const appsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(Math.max(0, totalSites) / APPS_GRID_PAGE_SIZE)),
    [totalSites]
  )

  useEffect(() => {
    setAppsPage((p) => Math.min(p, appsTotalPages))
  }, [appsTotalPages])

  const paginatedSites = useMemo(() => {
    const start = (appsPage - 1) * APPS_GRID_PAGE_SIZE
    return sites.slice(start, start + APPS_GRID_PAGE_SIZE)
  }, [sites, appsPage])

  const changeAppsPage = useCallback(function changeAppsPage(newOffset: number) {
    setAppsPage(Math.max(1, Math.min(
      Math.floor(newOffset / APPS_GRID_PAGE_SIZE) + 1,
      appsTotalPages
    )))
  }, [appsTotalPages])

  useEffect(() => {
    logImpressionEvent('apps.page.view')();
    refreshSites();
  }, [refreshSites])

  const handleAdminStopAll = async () => {
    if (runningCount === 0) return

    setAdminActionLoading('stop-all')
    try {
      await stopAllSites()
    } catch (error) {
      logger.error('sites.stop_all.failed', {
        error: error instanceof Error ? error.message : String(error)
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
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setAdminActionLoading(null)
    }
  }

  if (isLoading && !isAcceptTransferOpen) {
    return (
      <Box className="min-h-screen flex items-center justify-center" data-partial="accentAiro">
        <Spinner />
      </Box>
    )
  }

  return (
    <div className="min-h-screen">
      <Header location='sites' />

      <DevelopmentAdminSection
        totalItems={totalSites}
        runningItems={runningCount}
        itemType="sites"
        onStopAll={handleAdminStopAll}
        onDeleteAll={handleAdminDeleteAll}
        isStopAllLoading={adminActionLoading === 'stop-all'}
        isDeleteAllLoading={adminActionLoading === 'delete-all'}
      />

      <main className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 pt-4 pb-8">
        <AppInactivityAlert />
        <div className="mb-4 flex items-center justify-between" data-testid="apps-page-title">
          <Box orientation="horizontal" gap="md">
            {t('builder_apps_title')}
            {totalSites > 0 && (
              <div>
                <Tag emphasis="info">
                  {t('builder_apps_count', { count: totalSites })}
                </Tag>
              </div>
            )}
          </Box>
        </div>

        {error && (
          <div className="mb-3 border rounded-lg p-2">
            <p className="mb-1">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              design="secondary"
            >
              {t('builder_common_try_again')}
            </Button>
          </div>
        )}

        <div className="grid gap-2 md:gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AppCardEmptyState />
          <TransferAppCard
            isTransferEnabled={isTransferEnabled && !isTLA}
            onAcceptTransfer={() => setIsAcceptTransferOpen(true)}
          />
          {totalSites > 0 && paginatedSites.map((site) => (
            <AppCard
              key={site.id}
              site={site}
            />
          ))}
        </div>

        {totalSites > APPS_GRID_PAGE_SIZE && (
          <div className="flex justify-center mt-4">
            <Pagination
              limit={APPS_GRID_PAGE_SIZE}
              offset={(appsPage - 1) * APPS_GRID_PAGE_SIZE}
              total={totalSites}
              onChange={changeAppsPage}
              atStart={appsPage === 1}
              atEnd={appsPage === appsTotalPages}
            />
          </div>
        )}
      </main>

      {isTransferEnabled && !isTLA && isAcceptTransferOpen && (
        <AcceptTransferDialog onClose={() => setIsAcceptTransferOpen(false)} />
      )}
    </div>
  )
}

export default function Sites() {
  const t = useTranslations();
  return (
    <ProtectedRoute
      unauthorizedMessage={t('builder_apps_signed_in')}
    >
      <SitesPageContent />
    </ProtectedRoute>
  )
}
