import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Box from '@ux/box'
import Button from '@ux/button'
import Card, { MediaCard } from '@ux/card'
import MenuIcon from '@ux/icon/menu'
import PlusIcon from '@ux/icon/plus'
import SettingsIcon from '@ux/icon/settings'
import ShowIcon from '@ux/icon/show'
import TrashIcon from '@ux/icon/trash'
import WebsiteIcon from '@ux/icon/website'
import { Menu, MenuButton, MenuItem, MenuList, MenuSeparator } from '@ux/menu'
import Tag from '@ux/tag'
import text from '@ux/text'

import AppThumbnail from '@/app/apps/AppThumbnail'
import { useMenuClickPrevention } from '@/hooks/useMenuClickPrevention'
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

  const { menuWrapperProps, menuItemProps, shouldPreventClick } = useMenuClickPrevention()
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
      <p className="mb-2 text-center">{message}</p>
      <Box orientation="horizontal" gap="sm">
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

  const cornerActions = (
    <div {...menuWrapperProps}>
      <Menu
        id="app-card-menu"
        size="sm"
        closeOnSelect
      >
        <MenuButton
          aria-label={t('builder_apps_menu_actions')}
          design="control"
          size="sm"
          icon={<MenuIcon />}
        />
        <MenuList stretch>
          {publishedUrl && (
            <MenuItem
              {...menuItemProps()}
              data-eid={generateClickEID('apps.app.visit_published')}
              onClick={(e) => {
                window.open(publishedUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              <Box orientation="horizontal" gap="sm">
                <WebsiteIcon />
                <text.span>{t('builder_apps_menu_visit')}</text.span>
              </Box>
            </MenuItem>
          )}
          {site.status === 'running' && site.preview_url && (
            <MenuItem
              {...menuItemProps()}
              data-eid={generateClickEID('apps.app.view')}
              onClick={(e) => {
                window.open(site.preview_url, '_blank', 'noopener,noreferrer');
              }}
            >
              <Box orientation="horizontal" gap="sm">
                <ShowIcon />
                <text.span>{t('builder_apps_menu_preview')}</text.span>
              </Box>
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            {...menuItemProps()}
            href={`/develop/${site.id}?siteId=${site.id}&settings=domain&tab=settings`}
            isLink={true}
          >
            <Box orientation="horizontal" gap="sm">
              <SettingsIcon />
              <text.span>{t('builder_apps_menu_settings')}</text.span>
            </Box>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            {...menuItemProps()}
            data-eid={generateClickEID('apps.app.delete')}
            onClick={(e) => {
              showDeleteAlert(site.id, site.name || t('builder_apps_alert_delete_untitled'));
            }}
            aria-label={t('builder_apps_menu_delete', { siteName: site.name || t('builder_apps_alert_delete_untitled') })}
          >
            <Box orientation="horizontal" gap="sm">
              <text.span emphasis="critical"><TrashIcon /></text.span>
              <text.span emphasis="critical">{t('builder_apps_menu_delete')}</text.span>
            </Box>
          </MenuItem>
        </MenuList>
      </Menu>
    </div>
  )

  const createdDate = (
    <text.span className="font-normal" emphasis="passive" size={-2}>
      <FormattedMessage
        id='builder_apps_created'
        values={{ date: formatDate(site.created_at) }}
      />
    </text.span>
  )
  
  const title = (
    <div className="flex flex-col gap-1 w-full">
      <div>
        {renderStatusTag()}
      </div>
      <div className="flex flex-col w-full">
        <span className="line-clamp-1">{site.name || t('builder_apps_alert_delete_untitled')}</span>
        {createdDate}
      </div>
    </div>
  )

  const description = (
    <div className="line-clamp-2 sm:line-clamp-3">
      {site.initial_prompt}
    </div>
  )

  const media = (
    <div className="w-full sm:w-1/2 h-[144px] sm:h-[192px] rounded-lg overflow-hidden">
      <AppThumbnail
        siteId={site.id}
        siteName={site.name || t('builder_apps_alert_delete_untitled')}
      />
    </div>
  )

  return (
    <MediaCard
      as="button"
      onClick={(e) => {
        if (shouldPreventClick(e)) {
          return;
        }
        router.push(`/develop/${site.id}?siteId=${site.id}`);
      }}
      data-eid={generateClickEID('apps.app.edit')}
      aria-label={t('builder_common_edit') + ' ' + site.name || t('builder_apps_alert_delete_untitled')}
      className="sm:!flex-row"
      cornerActions={cornerActions}
      title={title}
      description={description}
      media={media}
      mediaBleed={false}
      mediaStart={true}
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
    </MediaCard>
  )
}

export const AppCardEmptyState = () => {
  const t = useTranslations();
  const router = useRouter()

  return (
    <Card
      as="button"
      onClick={() => router.push(`/`)}
      className="items-center justify-center"
    >
      <div className="w-full h-full flex flex-col gap-1 items-center justify-center">
        <PlusIcon className="size-3 text-ai" />
        <text.p>{t('builder_apps_empty_create')}</text.p>
      </div>
    </Card>
  )
}
