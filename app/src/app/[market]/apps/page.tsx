'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import ArrowRightIcon from '@ux/icon/arrow-right'
import PlusIcon from '@ux/icon/plus'
import Pagination from '@ux/pagination'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'
import text from '@ux/text'

import AppCard from '@/app/[market]/apps/AppCard'
import AcceptTransferDialog from '@/app/[market]/apps/components/AcceptTransferDialog'
import { APPS_GRID_PAGE_SIZE } from '@/app/[market]/apps/constants'
import { ProtectedRoute } from '@/components/auth'
import { DevelopmentAdminSection } from '@/components/development'
import Header from '@/components/layout/Header'
import { useAuth } from '@/hooks/useAuth'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { SiteStatus } from '@/lib/control-plane/types'
import { logger } from '@/lib/request-context'
import { useSitesStore } from '@/stores/useSitesStore'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'

function SitesPageContent() {
  const t = useTranslations();
  const router = useRouter();
  const { authState } = useAuth();
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null)
  const [isAcceptTransferOpen, setIsAcceptTransferOpen] = useState(false)
  const [appsPage, setAppsPage] = useState(1)
  const isTransferEnabled = useSwitchboard('appbuilder-transfer-ownership')
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

  const isTLA = useMemo(() => {
    const sid = authState?.details?.shopperId;
    return typeof sid === 'string' && sid.length === 3;
  }, [authState]);

  // Allow transfer when flag is loaded and true, or fall back to TLA check while loading
  const canUseTransfer = useMemo(() => {
    if (isTransferEnabled !== undefined) {
      return isTransferEnabled; // Flag loaded - use as source of truth
    }
    return !isTLA; // Loading - block TLAs by default
  }, [isTransferEnabled, isTLA]);


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
    <div className="min-h-screen flex flex-col">
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

      <main className="flex-1 flex flex-col max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 pt-4 pb-24 md:pb-8 w-full">
        <div className="mb-4 flex items-center justify-between" data-testid="apps-page-title">
          <div className="flex flex-col">
            <div className='flex flex-row gap-2 justify-start items-center'>
              <text.h2 as="title" size={3} text={t('builder_common_projects')} />
              <div>
                  {totalSites > 0 && (
                    <Tag emphasis="info">
                      {String(totalSites)}
                    </Tag>
                  )}
                </div>
            </div>
            <text.p size={-1} emphasis="passive">
              {t('builder_apps_title')}
            </text.p>
          </div>

          

          {!isAcceptTransferOpen && (
            <div className={`fixed bottom-0 left-0 right-0 bg-intents-ux-box-backgroundColor border-t border-intents-ux-borderColor p-3 flex gap-2 md:static md:bg-transparent md:border-0 md:p-0 ${totalSites === 0 ? 'md:!hidden' : ''}`}>
            <Button
              design="primary"
              size="sm"
              icon={<PlusIcon />}
              onClick={() => router.push('/')}
              data-testid="create-app-card"
              data-eid={generateClickEID('apps.app_list.new_app')}
              className="flex-1 md:flex-initial"
              text={t('builder_apps_create_project')}
            />
            {canUseTransfer && (
              <Button
                design="secondary"
                size="sm"
                icon={<ArrowRightIcon className="rtl:scale-x-[-1]" />}
                onClick={() => setIsAcceptTransferOpen(true)}
                data-testid="transfer-app-card"
                data-eid={generateClickEID('apps.emptystate.accept_transfer')}
                className="flex-1 md:flex-initial"
                text={t('builder_transfer_accept_button')}
              />
            )}
          </div>
          )}
        </div>

        {error && (
          <div className="mb-3 border rounded-lg p-2">
            <p className="mb-1">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              design="secondary"
              text={t('builder_common_try_again')}
            />
          </div>
        )}

        {totalSites === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 w-full bg-intents-ux-boxLowContrast-backgroundColor rounded-xl mb-4 pb-4 md:mb-0 md:pb-8">
            <Image
              src="/images/empty-projects.png"
              alt=""
              width={192}
              height={192}
              className="object-contain"
              unoptimized
            />
            <text.p size={0} emphasis="passive">
              {t('builder_apps_empty_state')}
            </text.p>
            <div className="hidden md:flex gap-2">
              <Button
                design="primary"
                size="sm"
                icon={<PlusIcon />}
                onClick={() => router.push('/')}
                data-testid="create-app-empty-state"
                data-eid={generateClickEID('apps.emptystate.new_app')}
                text={t('builder_apps_create_project')}
              />
              {canUseTransfer && (
                <Button
                  design="secondary"
                  size="sm"
                  icon={<ArrowRightIcon className="rtl:scale-x-[-1]" />}
                  onClick={() => setIsAcceptTransferOpen(true)}
                  data-testid="transfer-app-empty-state"
                  data-eid={generateClickEID('apps.emptystate.accept_transfer')}
                  text={t('builder_transfer_accept_button')}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-2 md:gap-3 md:grid-cols-2 xl:grid-cols-3">
            {paginatedSites.map((site) => (
              <AppCard
                key={site.id}
                site={site}
                transferAllowed={canUseTransfer}
              />
            ))}
          </div>
        )}

        {totalSites > APPS_GRID_PAGE_SIZE && (
          <div className="flex justify-center mt-4 mb-16 md:mb-0">
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

      {canUseTransfer && isAcceptTransferOpen && (
        <AcceptTransferDialog onClose={() => setIsAcceptTransferOpen(false)} />
      )}
    </div>
  )
}

export default function Sites() {
  return (
    <ProtectedRoute>
      <SitesPageContent />
    </ProtectedRoute>
  )
}
