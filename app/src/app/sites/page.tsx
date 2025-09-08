'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { 
  CodeBracketIcon, 
  PlusIcon, 
  PlayIcon,
  EyeIcon,
  StopIcon,
  TrashIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { appFetch } from '@/lib/gasket-config'
import { ProtectedRoute } from '@/components/auth'
import Header from '@/components/layout/Header'
import { Site } from '@/lib/database/prisma-site-service'
import { DevelopmentAdminSection } from '@/components/development'

interface AlertState {
  siteId: string | null
  type: 'delete' | null
  message: string
}

function SitesPageContent() {
  const [sites, setSites] = useState<Site[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>({ siteId: null, type: null, message: '' })
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const fetchSites = async () => {
      try {
        const response = await appFetch('/api/sites')
        if (!response.ok) {
          throw new Error('Failed to fetch sites')
        }
        
        const sitesData = await response.json()
        setSites(Array.isArray(sitesData) ? sitesData : [])
      } catch (error) {
        console.error('Error fetching sites:', error)
        setError('Failed to connect to server')
      } finally {
        setIsLoading(false)
      }
    }

    fetchSites()
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

  const getStatusColor = (status: Site['status']) => {
    switch (status) {
      case 'running':
        return 'text-green-600 bg-green-50'
      case 'creating':
      case 'created':
        return 'text-yellow-600 bg-yellow-50'
      case 'failed':
      case 'error':
        return 'text-red-600 bg-red-50'
      case 'stopped':
        return 'text-gray-600 bg-gray-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  const getStatusIcon = (status: Site['status']) => {
    switch (status) {
      case 'running':
        return <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
      case 'creating':
      case 'created':
        return <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
      case 'failed':
      case 'error':
        return <div className="w-2 h-2 bg-red-500 rounded-full" />
      case 'stopped':
        return <div className="w-2 h-2 bg-gray-500 rounded-full" />
      default:
        return <div className="w-2 h-2 bg-gray-500 rounded-full" />
    }
  }

  const handleDeleteSite = async (siteId: string) => {
    setActionLoading(siteId)
    try {
      const response = await appFetch(`/api/sites/${siteId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setSites(sites.filter(site => site.id !== siteId))
        setAlertState({ siteId: null, type: null, message: '' })
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to delete site')
      }
    } catch (error) {
      console.error('Error deleting site:', error)
      setError('Failed to delete site')
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
    const runningSites = sites.filter(site => site.status === 'running')
    if (runningSites.length === 0) return

    setAdminActionLoading('stop-all')
    try {
      // Stop all running sites in parallel
      const stopPromises = runningSites.map(site => 
        appFetch(`/api/sites/${site.id}/stop`, { method: 'POST' })
      )
      
      await Promise.all(stopPromises)
      
      // Update site statuses to stopped
      setSites(sites.map(site => 
        site.status === 'running' ? { ...site, status: 'stopped' as Site['status'] } : site
      ))
    } catch (error) {
      console.error('Error stopping all sites:', error)
      setError('Failed to stop all sites')
    } finally {
      setAdminActionLoading(null)
    }
  }

  const handleAdminDeleteAll = async () => {
    if (sites.length === 0) return

    setAdminActionLoading('delete-all')
    try {
      // Delete all sites in parallel
      const deletePromises = sites.map(site => 
        appFetch(`/api/sites/${site.id}`, { method: 'DELETE' })
      )
      
      await Promise.all(deletePromises)
      
      // Clear all sites
      setSites([])
    } catch (error) {
      console.error('Error deleting all sites:', error)
      setError('Failed to delete all sites')
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
    <div className="absolute inset-0 bg-white bg-opacity-95 rounded-lg flex flex-col items-center justify-center p-4 z-10">
      <p className="text-sm text-gray-700 mb-4 text-center">{message}</p>
      <div className="flex space-x-2">
        <button
          onClick={onConfirm}
          disabled={actionLoading === siteId}
          className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {actionLoading === siteId ? 'Deleting...' : 'Delete'}
        </button>
        <button
          onClick={onCancel}
          className="bg-gray-200 text-gray-800 px-4 py-2 rounded text-sm hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  )


  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your sites...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      <Header 
        actions={
          <button
            onClick={handleCreateNew}
            className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center space-x-2"
          >
            <PlusIcon className="w-4 h-4" />
            <span>New Site</span>
          </button>
        }
      />

      {/* Development Admin Section */}
      <DevelopmentAdminSection
        totalItems={sites.length}
        runningItems={sites.filter(site => site.status === 'running').length}
        itemType="sites"
        onStopAll={handleAdminStopAll}
        onDeleteAll={handleAdminDeleteAll}
        isStopAllLoading={adminActionLoading === 'stop-all'}
        isDeleteAllLoading={adminActionLoading === 'delete-all'}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-8">
          <p className="text-gray-600">
            Manage your AI-powered websites and applications
            <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {sites.length} {sites.length === 1 ? 'site' : 'sites'} total
            </span>
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 text-red-600 hover:text-red-500 font-medium"
            >
              Try Again
            </button>
          </div>
        )}

        {sites.length === 0 ? (
          <div className="text-center py-12">
            <CodeBracketIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Sites Yet</h2>
            <p className="text-gray-600 mb-6">Create your first AI-powered website</p>
            <button
              onClick={handleCreateNew}
              className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center space-x-2 mx-auto"
            >
              <PlusIcon className="w-5 h-5" />
              <span>Create Your First Site</span>
            </button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sites.map((site) => (
              <div
                key={site.id}
                className="relative flex flex-col bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-lg transition-all duration-200 px-6 pt-6 pb-4"
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
                  <div className="w-12 h-12 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg flex items-center justify-center">
                    <CodeBracketIcon className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full ${getStatusColor(site.status)}`}>
                      {getStatusIcon(site.status)}
                      <span className="capitalize">{site.status}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-1">
                    {site.title || 'Untitled Site'}
                  </h3>
                  {site.initial_prompt && (
                    <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                      {site.initial_prompt}
                    </p>
                  )}
                  <div className="flex items-center text-xs text-gray-500 space-x-4">
                    <div className="flex items-center space-x-1">
                      <ClockIcon className="w-3 h-3" />
                      <span>Created {formatDate(site.created_at)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-100">
                  <div className="flex space-x-2">
                    {site.preview_url && site.status === 'running' && (
                      <a
                        href={site.preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 space-x-1"
                      >
                        <EyeIcon className="w-3 h-3" />
                        <span>View Site</span>
                      </a>
                    )}
                    
                    {site.status === 'running' && (
                      <button
                        onClick={() => router.push(`/develop/${site.id}?siteId=${site.id}`)}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded-md hover:bg-purple-100 space-x-1"
                      >
                        <PlayIcon className="w-3 h-3" />
                        <span>Edit Site</span>
                      </button>
                    )}
                  </div>
                  
                  <button
                    onClick={() => showDeleteAlert(site.id, site.title || 'Untitled Site')}
                    className="inline-flex items-center px-2 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100"
                    title="Delete Site"
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
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
      requiredAccess="user"
      loadingMessage="Loading Your Sites"
      unauthorizedMessage="You need to be signed in to view your sites."
    >
      <SitesPageContent />
    </ProtectedRoute>
  )
}
