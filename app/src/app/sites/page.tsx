'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CodeBracketIcon,
  PlusIcon,
  PlayIcon,
  EyeIcon,
  TrashIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { ProtectedRoute } from '@/components/auth'
import Header from '@/components/layout/Header'
import { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter'
import { DevelopmentAdminSection } from '@/components/development'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'
import { useSites } from '@/stores/useSitesStore'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'

interface AlertState {
  siteId: string | null
  type: 'delete' | null
  message: string
}

function SitesPageContent() {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>({ siteId: null, type: null, message: '' })
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null)
  const router = useRouter()

  // Use the sites store (automatically loads sites on first use)
  const {
    sites,
    isLoading,
    error,
    deleteSite,
    stopAllSites,
    deleteAllSites,
    totalSites,
    runningCount
  } = useSites()

  console.log('SITES', sites)

  useEffect(() => {
    logImpressionEvent('sites.page.view')();
  }, [])

  const handleCreateNew = () => {
    router.push('/')
  }

  const formatDate = (date: string | Date) => {
    const dateObj = date instanceof Date ? date : new Date(date)
    return dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getStatusLabel = (status: SiteInfo['status']) => {
    switch (status) {
      case 'running':
        return <Tag emphasis="success">Running</Tag>
      case 'creating':
      case 'created':
        return <Tag emphasis="warning">Creating</Tag>
      case 'failed':
      case 'error':
        return <Tag emphasis="critical">Failed</Tag>
      case 'stopped':
        return <Tag emphasis="info">Stopped</Tag>
      default:
        return <Tag emphasis="neutral">Unknown</Tag>
    }
  }

  const handleDeleteSite = async (siteId: string) => {
    setActionLoading(siteId)
    try {
      const success = await deleteSite(siteId)
      if (success) {
        setAlertState({ siteId: null, type: null, message: '' })
      }
    } catch (error) {
      console.error('Error deleting site:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const showDeleteAlert = (siteId: string, siteName: string) => {
    setAlertState({
      siteId,
      type: 'delete',
      message: `Are you sure you want to delete "${siteName || 'Untitled Site'}"? This action cannot be undone.`
    })
  }

  const clearAlert = () => {
    setAlertState({ siteId: null, type: null, message: '' })
  }

  const handleAdminStopAll = async () => {
    if (runningCount === 0) return

    setAdminActionLoading('stop-all')
    try {
      await stopAllSites()
    } catch (error) {
      console.error('Error stopping all sites:', error)
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
      console.error('Error deleting all sites:', error)
    } finally {
      setAdminActionLoading(null)
    }
  }

  // Inline alert component
  const InlineAlert = ({ siteId, message, onConfirm, onCancel }: {
    siteId: string
    message: string
    onConfirm: () => void
    onCancel: () => void
  }) => (
    <div className="absolute inset-0 bg-intents-ux-box-backgroundColor rounded-lg flex flex-col items-center justify-center p-4 z-10">
      <p className="text-sm mb-4 text-center">{message}</p>
      <Box orientation="horizontal" gap="md">
        <Button
          onClick={onConfirm}
          disabled={actionLoading === siteId}
          data-eid={generateClickEID('sites.site.delete_confirm')}
          className="text-white px-4 py-2 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          text={actionLoading === siteId ? 'Deleting...' : 'Delete'}
          design="critical"
        />
        <Button
          data-eid={generateClickEID('sites.site.delete_cancel')}
          onClick={onCancel}
          text="Cancel"
          design="secondary"
        />
      </Box>
    </div>
  )

  if (isLoading) {
    return (
      <Box className="min-h-screen flex items-center justify-center" data-partial="accentAiro">
        <Spinner size="lg" />
        <p className="mt-4">Loading your sites...</p>
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
        <div className="mb-8">
          <Box orientation="horizontal" gap="md">
            Manage your AI-powered websites and applications
            <Tag emphasis="info">
              {`${totalSites} ${totalSites === 1 ? 'site' : 'sites'} total`}
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
            <h2 className="text-xl font-semibold mb-2">No Sites Yet</h2>
            <p className="mb-6">Create your first AI-powered website</p>
            <Button
              onClick={handleCreateNew}
              className="px-6 py-3 rounded-lg transition-all flex items-center space-x-2 mx-auto"
              icon={<PlusIcon className="w-5 h-5" />}
              design="primary"
              text="Create Your First Site"
            />
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sites.map((site) => (
              <div
                key={site.id}
                className="relative flex flex-col rounded-lg border hover:shadow-lg transition-all duration-200 px-6 pt-6 pb-4"
              >
                {/* Inline Alert */}
                {alertState.siteId === site.id && alertState.type && (
                  <InlineAlert
                    siteId={site.id}
                    message={alertState.message}
                    onConfirm={() => handleDeleteSite(site.id)}
                    onCancel={clearAlert}
                  />
                )}

                <div className="flex items-start justify-between mb-4">
                  <Box
                    className="w-12 h-12 p-1 flex items-center justify-center"
                    rounding="reduced"
                    data-partial="gradientAiro"
                    style={{
                      background: "var(--ux-cao06b)",
                    }}
                  >
                    <CodeBracketIcon className="w-7 h-7 text-ai" />
                  </Box>
                  <div className="flex items-center space-x-2">
                    {getStatusLabel(site.status)}
                  </div>
                </div>

                <div className="flex-1">
                  <h3 className="font-semibold mb-1">
                    {site.name || 'Untitled Site'}
                  </h3>
                  {site.initial_prompt && (
                    <p className="text-sm mb-2 line-clamp-2">
                      {site.initial_prompt}
                    </p>
                  )}
                  <div className="flex items-center text-xs space-x-4">
                    <div className="flex items-center space-x-1">
                      <ClockIcon className="w-3 h-3" />
                      <span>Created {formatDate(site.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 mt-4 border-t">
                  <div className="flex space-x-2">
                    {site.preview_url && site.status === 'running' && (
                      <Button
                        href={site.preview_url}
                        data-eid={generateClickEID('sites.site.view')}
                        icon={<EyeIcon className="w-3 h-3" />}
                        size="sm"
                        design="tertiary"
                        text="View Site"
                        external
                      />
                    )}

                    {site.status === 'running' && (
                      <Button
                        onClick={() => router.push(`/develop/${site.id}?siteId=${site.id}`)}
                        data-eid={generateClickEID('sites.site.edit')}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md space-x-1"
                        icon={<PlayIcon className="w-3 h-3" />}
                        size="sm"
                        design="tertiary"
                        text="Edit Site"
                      />
                    )}
                  </div>

                  <Button
                    onClick={() => showDeleteAlert(site.id, site.name || 'Untitled Site')}
                    data-eid={generateClickEID('sites.site.delete')}
                    aria-label={`Delete site ${site.name || 'Untitled Site'}`}
                    icon={<TrashIcon className="w-2 h-2" />}
                    size="sm"
                    design="inline"
                  />
                </div>
              </div>
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
      loadingMessage="Loading Your Sites"
      unauthorizedMessage="You need to be signed in to view your sites."
    >
      <SitesPageContent />
    </ProtectedRoute>
  )
}
