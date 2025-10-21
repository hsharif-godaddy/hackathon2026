'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowTopRightOnSquareIcon, CalendarIcon, RectangleStackIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { ProtectedRoute } from '@/components/auth'
import Header from '@/components/layout/Header'
import { appFetch } from '@/lib/gasket-config'
import { isFeatureEnabled } from '@/lib/features'
import { formatDate } from '@/utils/common'

interface Site {
  id: string
  name: string
  account_id?: string
  initial_prompt?: string
  agent_url?: string
  backend_url?: string
  preview_url?: string
  status: 'init' | 'creating' | 'created' | 'running' | 'stopped' | 'error' | 'failed'
  created_at: string
  updated_at: string
}

type SitesResponse = Site[]

function GalleryContent() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    // Check if feature is enabled
    if (!isFeatureEnabled.galleryPage()) {
      router.push('/') // Redirect to home if feature is disabled
      return
    }

    fetchSites()
  }, [router])

  const fetchSites = async () => {
    try {
      setLoading(true)
      const response = await appFetch('/api/sites')

      if (!response.ok) {
        throw new Error(`Failed to fetch sites: ${response.status}`)
      }

      const data: SitesResponse = await response.json()

      // Filter out sites that are not in running/created state and sort by creation date (newest first)
      const filteredAndSortedSites = (data || [])
        .filter(site => ['created', 'running'].includes(site.status))
        .sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      setSites(filteredAndSortedSites)
    } catch (err) {
      console.error('Error fetching sites:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const getDisplayTitle = (site: Site) => {
    // Use name if available, otherwise generate from initial_prompt or use ID
    if (site.name) {
      return site.name
    }
    if (site.initial_prompt) {
      // Create a title from first few words of prompt
      const words = site.initial_prompt.split(' ').slice(0, 6).join(' ')
      return words.length < site.initial_prompt.length ? words + '...' : words
    }
    return `Site ${site.id.slice(0, 8)}`
  }

  const copyPromptToClipboard = async (site: Site) => {
    if (!site.initial_prompt) return

    try {
      await navigator.clipboard.writeText(site.initial_prompt)
      setCopiedPromptId(site.id)
      setTimeout(() => setCopiedPromptId(null), 2000) // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy prompt:', err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading sites...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
          <div className="text-center py-12">
            <div className="text-red-600 text-6xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold mb-2">Error Loading Sites</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={fetchSites}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header location='gallery' />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Gallery</h1>
          <p className="text-gray-600">
            Browse and explore all created applications with their details and initial prompts
          </p>
        </div>

        {sites.length === 0 ? (
          <div className="text-center py-12">
            <RectangleStackIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Sites Found</h2>
            <p className="text-gray-600 mb-6">No sites have been created yet.</p>
            <button
              onClick={() => router.push('/')}
              className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
            >
              Create Your First Site
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sites.map((site) => (
              <div
                key={site.id}
                className="bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all duration-200 p-4 flex flex-col"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 truncate mb-2">
                      {getDisplayTitle(site)}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center text-sm text-gray-500 mb-3">
                  <CalendarIcon className="w-4 h-4 mr-1 flex-shrink-0" />
                  <span className="truncate">Created {formatDate(site.created_at, true)}</span>
                </div>

                {site.initial_prompt && (
                  <div className="bg-gray-50 rounded-lg p-3 mb-4 flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-medium text-gray-700">Initial Prompt:</h4>
                      <button
                        onClick={() => copyPromptToClipboard(site)}
                        className="flex items-center space-x-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                        title="Copy prompt to clipboard"
                      >
                        <ClipboardDocumentIcon className="w-3 h-3" />
                        <span>{copiedPromptId === site.id ? 'Copied!' : 'Copy'}</span>
                      </button>
                    </div>
                    <div className="max-h-24 overflow-y-auto text-xs text-gray-600 leading-relaxed">
                      {site.initial_prompt}
                    </div>
                  </div>
                )}

                <div className="mt-auto space-y-3">
                  {(site.preview_url || site.backend_url) ? (
                    <a
                      href={site.preview_url || site.backend_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200"
                      title="Open preview in new tab"
                    >
                      <ArrowTopRightOnSquareIcon className="w-4 h-4 mr-1" />
                      Preview
                    </a>
                  ) : (
                    <div className="inline-flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-gray-400 rounded-lg border border-gray-200">
                      <ArrowTopRightOnSquareIcon className="w-4 h-4 mr-1" />
                      No Preview Available
                    </div>
                  )}

                  <div className="text-xs text-gray-400 text-center">
                    Updated {formatDate(site.updated_at, true)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default function GalleryPage() {
  return (
    <ProtectedRoute
      unauthorizedMessage="You need to be signed in to view the gallery."
    >
      <GalleryContent />
    </ProtectedRoute>
  )
}
