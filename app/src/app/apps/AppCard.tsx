import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Box from '@ux/box'
import Button from '@ux/button'
import ClockIcon from '@ux/icon/clock'
import PlayIcon from '@ux/icon/play'
import PlusIcon from '@ux/icon/plus'
import ShowIcon from '@ux/icon/show'
import TrashIcon from '@ux/icon/trash'
import WebsiteIcon from '@ux/icon/website'
import Tag from '@ux/tag'
import text from '@ux/text'

import AppThumbnail from '@/app/apps/AppThumbnail'
import { useTranslations } from '@/hooks/useTranslations'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter'
import { useSitesStore } from '@/stores/useSitesStore'
import { formatDate } from '@/utils/common'
import { generateClickEID } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

interface AlertState {
  siteId: string | null
  type: 'delete' | null
  message: string | React.ReactNode
}

function getStatusConfig(status: string): { key: string; emphasis: 'success' | 'warning' | 'info' | 'critical' | 'neutral' } {
  switch (status) {
    case 'running':
      return { key: 'builder_status_running', emphasis: 'success' };
    case 'creating':
    case 'created':
      return { key: 'builder_status_creating', emphasis: 'warning' };
    case 'failed':
    case 'error':
      return { key: 'builder_status_failed', emphasis: 'critical' };
    case 'stopped':
      return { key: 'builder_status_stopped', emphasis: 'info' };
    default:
      return { key: 'builder_status_unknown', emphasis: 'neutral' };
  }
}

export default function AppCard({ site }: { site: SiteInfo }) {
  const router = useRouter();
  const t = useTranslations();

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
        logger.error('site.details.fetch.failed', {
          siteId: site.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    fetchSiteDetails()
  }, [site.id])

  const renderStatusTag = () => {
    const { key, emphasis } = getStatusConfig(site.status);
    return <Tag emphasis={emphasis}>{t(key)}</Tag>;
  }

  const handleDeleteSite = async (siteId: string) => {
    setActionLoading(siteId)
    try {
      const success = await deleteSite(siteId)
      if (success) {
        setAlertState({ siteId: null, type: null, message: '' })
      }
    } catch (error) {
      logger.error('site.delete.failed', {
        siteId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setActionLoading(null)
    }
  }

  const showDeleteAlert = (siteId: string, siteName: string) => {
    setAlertState({
      siteId,
      type: 'delete',
      message: <FormattedMessage id='builder_apps_alert_delete' values={{ siteName: siteName || t('builder_apps_alert_delete_untitled') }} />
    })
  }

  const clearAlert = () => {
    setAlertState({ siteId: null, type: null, message: '' })
  }

  // Inline alert component
  const InlineAlert = ({ siteId, message, onConfirm, onCancel }: {
    siteId: string
    message: string | React.ReactNode
    onConfirm: () => void
    onCancel: () => void
  }) => (
    <div className="absolute inset-0 bg-intents-ux-box-backgroundColor rounded-lg flex flex-col items-center justify-center p-2 z-10">
      <p className="text-sm mb-2 text-center">{message}</p>
      <Box orientation="horizontal" gap="md">
        <Button
          onClick={onConfirm}
          disabled={actionLoading === siteId}
          data-eid={generateClickEID('apps.app.delete_confirm')}
          className="text-white px-2 py-1 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          text={actionLoading === siteId ? t('builder_common_deleting') : t('builder_common_delete')}
          design="critical"
          size="sm"
        />
        <Button
          data-eid={generateClickEID('apps.app.delete_cancel')}
          onClick={onCancel}
          text={t('builder_common_cancel')}
          design="secondary"
          size="sm"
        />
      </Box>
    </div>
  )

  return (
    <div
      className="relative flex flex-col rounded-lg border hover:shadow-lg transition-all duration-200 px-3 pt-3 pb-2"
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
      <div className="flex gap-2 flex-1">
        {/* Thumbnail */}
        <AppThumbnail siteId={site.id} siteName={site.name || t('builder_apps_alert_delete_untitled')} size="lg" />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-1 mt-0.5">
            {renderStatusTag()}
          </div>
          <h3 className="font-semibold mb-0.5">
            {site.name || t('builder_apps_alert_delete_untitled')}
          </h3>
          {site.initial_prompt && (
            <p className="text-sm mb-1 line-clamp-2">
              {site.initial_prompt}
            </p>
          )}
          <div className="flex items-center text-xs space-x-2">
            <div className="flex items-center space-x-0.5">
              <ClockIcon className="w-1.5 h-1.5" />
              <span>
                <FormattedMessage
                  id='builder_apps_created'
                  values={{ date: formatDate(site.created_at) }}
                />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 mt-2 border-t">
        <div className="flex space-x-1">
          {/* Visit published site */}
          {publishedUrl && (
            <Button
              href={publishedUrl}
              data-eid={generateClickEID('apps.app.visit_published')}
              icon={<WebsiteIcon />}
              size="sm"
              design="tertiary"
              text={t('builder_common_visit')}
              external
            />
          )}

          {/* Preview site - only show when running */}
          {site.status === 'running' && site.preview_url && (
            <Button
              href={site.preview_url}
              data-eid={generateClickEID('apps.app.view')}
              icon={<ShowIcon />}
              size="sm"
              design="tertiary"
              text={t('builder_common_preview')}
              external
            />
          )}

          {/* Edit button */}
          {site.status === 'running' && (
            <Button
              onClick={() => router.push(`/develop/${site.id}?siteId=${site.id}`)}
              data-eid={generateClickEID('apps.app.edit')}
              icon={<PlayIcon />}
              size="sm"
              design="tertiary"
              text={t('builder_common_edit')}
            />
          )}
        </div>

        <Button
          onClick={() => showDeleteAlert(site.id, site.name || t('builder_apps_alert_delete_untitled'))}
          data-eid={generateClickEID('apps.app.delete')}
          aria-label={`Delete app ${site.name || t('builder_apps_alert_delete_untitled')}`}
          icon={<TrashIcon />}
          size="sm"
          design="inline"
        />
      </div>
    </div>
  )
}

export const AppCardEmptyState = () => {
  const t = useTranslations();
  const router = useRouter()

  return (
    <div
      className="relative flex flex-col min-h-28 justify-center items-center rounded-lg border gap-1 hover:cursor-pointer hover:shadow-lg transition-all group"
      onClick={() => router.push(`/`)}
    >
      <PlusIcon className="size-3 text-ai group-hover:scale-110 transition-all" />
      <text.p>{t('builder_apps_empty_create')}</text.p>
    </div>
  )
}
