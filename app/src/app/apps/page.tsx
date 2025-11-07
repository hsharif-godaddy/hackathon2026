'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CodeBracketIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { ProtectedRoute } from '@/components/auth'
import Header from '@/components/layout/Header'
import AppInactivityAlert from '@/components/layout/AppInactivityAlert'
import { DevelopmentAdminSection } from '@/components/development'
import { logImpressionEvent } from '@/utils/instrumentation'
import { useSites } from '@/stores/useSitesStore'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'
import AppCard, { AppCardEmptyState } from '@/app/apps/AppCard'

function SitesPageContent() {
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null)
  const router = useRouter()

  // Use the sites store (automatically loads sites on first use)
  const {
    sites,
    isLoading,
    error,
    stopAllSites,
    deleteAllSites,
    totalSites,
    runningCount,
    refreshSites
  } = useSites()

  console.log('SITES', sites)

  useEffect(() => {
    logImpressionEvent('apps.page.view')();
    // Always refresh apps when the page loads to show newly created apps
    refreshSites();
  }, [refreshSites])

  const handleCreateNew = () => {
    router.push('/')
  }

  const handleAdminStopAll = async () => {
    if (runningCount === 0) return

    setAdminActionLoading('stop-all')
    try {
      await stopAllSites()
    } catch (error) {
      console.error('Error stopping all apps:', error)
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
      console.error('Error deleting all apps:', error)
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <AppInactivityAlert />
        <div className="mb-8">
          <Box orientation="horizontal" gap="md">
            Manage your AI-powered websites and applications
            <Tag emphasis="info">
              {`${totalSites} ${totalSites === 1 ? 'app' : 'apps'} total`}
            </Tag>
          </Box>
        </div>

        {error && (
          <div className="mb-6 border rounded-lg p-4">
            <p className="text-red-700">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 text-red-600 hover:text-red-500 font-medium"
            >
              Try Again
            </button>
          </div>
        )}

        {totalSites === 0 ? (
          <div className="text-center py-12">
            <CodeBracketIcon className="w-16 h-16 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Apps Yet</h2>
            <p className="mb-6">Create your first AI-powered app</p>
            <Button
              onClick={handleCreateNew}
              className="px-6 py-3 rounded-lg transition-all flex items-center space-x-2 mx-auto"
              icon={<PlusIcon className="w-5 h-5" />}
              design="primary"
              text="Create Your First App"
            />
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <AppCardEmptyState />
            {sites.map((site) => (
              <AppCard
                key={site.id}
                site={site}
              />
            ))}
          </div>
        )}
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
