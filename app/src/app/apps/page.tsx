'use client'

import { useState, useEffect } from 'react'
import { ProtectedRoute } from '@/components/auth'
import Header from '@/components/layout/Header'
import AppInactivityAlert from '@/components/layout/AppInactivityAlert'
import { DevelopmentAdminSection } from '@/components/development'
import { logImpressionEvent } from '@/utils/instrumentation'
import { useSitesStore } from '@/stores/useSitesStore'
import { logger } from '@/lib/request-context'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'
import AppCard, { AppCardEmptyState } from '@/app/apps/AppCard'

function SitesPageContent() {
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null)

  // Use the sites store (automatically loads sites on first use)
  const sites = useSitesStore((state) => state.allSites)
  const isLoading = useSitesStore((state) => state.isLoadingAll)
  const error = useSitesStore((state) => state.error)
  const stopAllSites = useSitesStore((state) => state.stopAllSites)
  const deleteAllSites = useSitesStore((state) => state.deleteAllSites)
  const refreshSites = useSitesStore((state) => state.refreshSites)

  const totalSites = sites ? sites.length : 0
  const runningCount = sites ? sites.filter(site => site.status === 'running').length : 0

  useEffect(() => {
    logImpressionEvent('apps.page.view')();
    // Always refresh apps when the page loads to show newly created apps
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

  if (isLoading) {
    return (
      <Box className="min-h-screen flex items-center justify-center" data-partial="accentAiro">
        <Spinner />
      </Box>
    )
  }

  return (
    <div className="min-h-screen">
      <Header location='sites' />

      {/* Development Admin Section */}
      <DevelopmentAdminSection
        totalItems={totalSites}
        runningItems={runningCount}
        itemType="sites"
        onStopAll={handleAdminStopAll}
        onDeleteAll={handleAdminDeleteAll}
        isStopAllLoading={adminActionLoading === 'stop-all'}
        isDeleteAllLoading={adminActionLoading === 'delete-all'}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 pt-4 pb-8">
        <AppInactivityAlert />
        <div className="mb-4">
          <Box orientation="horizontal" gap="md" data-partial="componentAiro">
            Manage your AI-powered websites and applications
            <Tag emphasis="highlight">
              {`${totalSites} ${totalSites === 1 ? 'app' : 'apps'} total`}
            </Tag>
          </Box>
        </div>

        {error && (
          <div className="mb-3 border rounded-lg p-2">
            <p className="text-red-700 mb-1">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              design="secondary"
            >
              Try Again
            </Button>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <AppCardEmptyState />
          {totalSites > 0 && sites.map((site) => (
            <AppCard
              key={site.id}
              site={site}
            />
          ))}
        </div>
      </main>
    </div>
  )
}

export default function Sites() {
  return (
    <ProtectedRoute
      unauthorizedMessage="You need to be signed in to view your sites."
    >
      <SitesPageContent />
    </ProtectedRoute>
  )
}
