import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CodeBracketIcon,
  PlayIcon,
  EyeIcon,
  TrashIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter'
import { generateClickEID } from '@/utils/instrumentation'
import { useSites } from '@/stores/useSitesStore'
import Box from '@ux/box'
import Button from '@ux/button'
import Tag from '@ux/tag'
import { formatDate } from '@/utils/common'
import PlusIcon from '@ux/icon/plus'

interface AlertState {
  siteId: string | null
  type: 'delete' | null
  message: string
}

export default function SiteCard({site}) {
  const router = useRouter()

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>({ siteId: null, type: null, message: '' })

  const { deleteSite } = useSites()

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
  )
}

export const SiteCardEmptyState = () => {
  const router = useRouter()

  return (
    <div
      className="relative flex flex-col justify-center items-center rounded-lg border hover:cursor-pointer hover:shadow-lg transition-all group"
      onClick={() => router.push(`/`)}
    >
      <PlusIcon className="size-7 text-ai group-hover:scale-110 transition-all" />
    </div>
  )
}
