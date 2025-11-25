import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  PlayIcon,
  EyeIcon,
  TrashIcon,
  ClockIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline'
import { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter'
import { hasBeenPublished } from '@/utils/site'
import { generateClickEID } from '@/utils/instrumentation'
import { useSitesStore } from '@/stores/useSitesStore'
import { appFetch } from '@/lib/gasket-config'
import Box from '@ux/box'
import Button from '@ux/button'
import Tag from '@ux/tag'
import { formatDate } from '@/utils/common'
import PlusIcon from '@ux/icon/plus'
import text from '@ux/text'
import AppThumbnail from './AppThumbnail'

interface AlertState {
  siteId: string | null
  type: 'delete' | null
  message: string
}

export default function AppCard({site}) {
  const router = useRouter()

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>({ siteId: null, type: null, message: '' })
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)

  const deleteSite = useSitesStore((state) => state.deleteSite)

  useEffect(() => {
    const fetchSiteDetails = async () => {
      try {
        const response = await appFetch(`/api/sites/${site.id}`)
        if (response.ok) {
          const siteDetails = await response.json()
          if (siteDetails.published_url && hasBeenPublished(siteDetails)) {
            setPublishedUrl(siteDetails.published_url)
          }
        }
      } catch (error) {
        console.error('Error fetching site details:', error)
      }
    }

    fetchSiteDetails()
  }, [site.id])

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
      console.error('Error deleting app:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const showDeleteAlert = (siteId: string, siteName: string) => {
    setAlertState({
      siteId,
      type: 'delete',
      message: `Are you sure you want to delete "${siteName || 'Untitled App'}"? This action cannot be undone.`
    })
  }

  const clearAlert = () => {
    setAlertState({ siteId: null, type: null, message: '' })
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
          data-eid={generateClickEID('apps.app.delete_confirm')}
          className="text-white px-4 py-2 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          text={actionLoading === siteId ? 'Deleting...' : 'Delete'}
          design="critical"
        />
        <Button
          data-eid={generateClickEID('apps.app.delete_cancel')}
          onClick={onCancel}
          text="Cancel"
          design="secondary"
        />
      </Box>
    </div>
  )

  return (
    <div
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
      <div className="flex gap-4 flex-1">
        {/* Thumbnail */}
        <AppThumbnail siteId={site.id} siteName={site.name || 'Untitled App'} size="lg" />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-2 mt-1">
            <div className="flex items-center space-x-2">
              {getStatusLabel(site.status)}
            </div>
          </div>
          <h3 className="font-semibold mb-1">
            {site.name || 'Untitled App'}
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
      </div>

      <div className="flex items-center justify-between pt-4 mt-4 border-t">
        <div className="flex space-x-2">
          {publishedUrl && site.status === 'running' && (
            <Button
              href={publishedUrl}
              data-eid={generateClickEID('apps.app.visit_published')}
              icon={<GlobeAltIcon className="w-3 h-3" />}
              size="sm"
              design="tertiary"
              text="Visit"
              external
            />
          )}

          {site.preview_url && site.status === 'running' && (
            <Button
              href={site.preview_url}
              data-eid={generateClickEID('apps.app.view')}
              icon={<EyeIcon className="w-3 h-3" />}
              size="sm"
              design="tertiary"
              text="Preview"
              external
            />
          )}

          {site.status === 'running' && (
            <Button
              onClick={() => router.push(`/develop/${site.id}?siteId=${site.id}`)}
              data-eid={generateClickEID('apps.app.edit')}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md space-x-1"
              icon={<PlayIcon className="w-3 h-3" />}
              size="sm"
              design="tertiary"
              text="Edit"
            />
          )}
        </div>

        <Button
          onClick={() => showDeleteAlert(site.id, site.name || 'Untitled App')}
          data-eid={generateClickEID('apps.app.delete')}
          aria-label={`Delete app ${site.name || 'Untitled App'}`}
          icon={<TrashIcon className="w-2 h-2" />}
          size="sm"
          design="inline"
        />
      </div>
    </div>
  )
}

export const AppCardEmptyState = () => {
  const router = useRouter()

  return (
    <div
      className="relative flex flex-col min-h-56 justify-center items-center rounded-lg border gap-2 hover:cursor-pointer hover:shadow-lg transition-all group"
      onClick={() => router.push(`/`)}
    >
      <PlusIcon className="size-7 text-ai group-hover:scale-110 transition-all" />
      <text.p>Create a new app</text.p>
    </div>
  )
}
