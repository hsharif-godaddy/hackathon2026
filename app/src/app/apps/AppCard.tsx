import clsx from 'clsx';
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Box from '@ux/box'
import Button from '@ux/button'
import Card, { MediaCard } from '@ux/card'
import CopyIcon from '@ux/icon/copy'
import EditIcon from '@ux/icon/edit'
import MenuIcon from '@ux/icon/menu'
import PlusIcon from '@ux/icon/plus'
import SettingsIcon from '@ux/icon/settings'
import ShareIcon from '@ux/icon/share'
import ShowIcon from '@ux/icon/show'
import TrashIcon from '@ux/icon/trash'
import UnlinkIcon from '@ux/icon/unlink'
import WebsiteIcon from '@ux/icon/website'
import { Menu, MenuButton, MenuItem, MenuList, MenuSeparator } from '@ux/menu'
import Modal from '@ux/modal'
import Tag from '@ux/tag'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import AppThumbnail from '@/app/apps/AppThumbnail'
import TransferInitiateDialog from '@/app/apps/components/TransferInitiateDialog'
import UnpublishConfirmationModal from '@/components/layout/UnpublishConfirmationModal'
import { useAppRename } from '@/hooks/useAppRename'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useUnpublishApp } from '@/hooks/useUnpublishApp'
import { SiteInfo } from '@/lib/control-plane/types'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useSitesStore } from '@/stores/useSitesStore'
import { formatDate } from '@/utils/common'
import { generateClickEID } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

interface AlertState {
  siteId: string | null
  type: 'delete' | 'cancel-transfer' | null
  message: string | React.ReactNode
}

interface ActiveTransfer {
  transferToken: string
  status: string
  expiresAt?: string
}

export default function AppCard({ site }: { site: SiteInfo }) {
  const router = useRouter();
  const t = useTranslations();

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>({ siteId: null, type: null, message: '' })
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false)
  const [cancelTransferError, setCancelTransferError] = useState<string | null>(null)
  const [activeTransfer, setActiveTransfer] = useState<ActiveTransfer | null>(null)
  const [copied, setCopied] = useState(false)
  const [isUnpublishModalOpen, setIsUnpublishModalOpen] = useState(false)
  const [newName, setNewName] = useState(site.name || '')
  const [renameError, setRenameError] = useState<string | null>(null)

  const menuClosedRef = useRef(false)
  const deleteSite = useSitesStore((state) => state.deleteSite)
  const fetchAllSites = useSitesStore((state) => state.fetchAllSites)
  const refreshSites = useSitesStore((state) => state.refreshSites)
  const { mutate: renameApp, isPending: isRenamePending } = useAppRename()
  const { data: isUnpublishEnabled } = useSwitchboard('appbuilder-unpublish')
  const { data: isTransferEnabled } = useSwitchboard('appbuilder-transfer-ownership')
  const unpublishMutation = useUnpublishApp()

  const fetchTransferStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await appFetch(`/api/apps/${site.id}/transfer`, { signal })
      if (response.ok) {
        const data = await response.json()
        if (data.status === 'initiated' || data.status === 'processing') {
          setActiveTransfer({ transferToken: data.transferToken, status: data.status, expiresAt: data.expiresAt })
        } else {
          setActiveTransfer(null)
        }
      } else {
        setActiveTransfer(null)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }, [site.id])

  useEffect(function load() {
    const controller = new AbortController()

    const fetchSiteDetails = async () => {
      try {
        const response = await appFetch(`/api/sites/${site.id}`, { signal: controller.signal })
        if (response.ok) {
          const siteDetails = await response.json()
          if (siteDetails.published_url && hasBeenPublished(siteDetails)) {
            setPublishedUrl(siteDetails.published_url)
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        logger.error('site.details.fetch.failed', {
          siteId: site.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    fetchSiteDetails()
    if (isTransferEnabled) {
      fetchTransferStatus(controller.signal)
    }
    return () => controller.abort()
  }, [site.id, fetchTransferStatus, isTransferEnabled])

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

  const handleCancelTransfer = async () => {
    setActionLoading('cancel-transfer')
    setCancelTransferError(null)
    try {
      const response = await appFetch(`/api/apps/${site.id}/transfer/cancel`, { method: 'POST' })
      if (response.ok) {
        setActiveTransfer(null)
        setAlertState({ siteId: null, type: null, message: '' })
        refreshSites()
      } else {
        const data = await response.json()
        logger.error('transfer.cancel.ui.failed', { appId: site.id, error: data })
        setAlertState({ siteId: null, type: null, message: '' })
        setCancelTransferError(data.error || t('builder_transfer_error_cancel_failed', undefined, 'Failed to cancel transfer. Please try again.'))
      }
    } catch (error) {
      logger.error('transfer.cancel.ui.error', {
        appId: site.id,
        error: error instanceof Error ? error.message : String(error)
      })
      setAlertState({ siteId: null, type: null, message: '' })
      setCancelTransferError(t('builder_transfer_error_cancel_failed', undefined, 'Failed to cancel transfer. Please try again.'))
    } finally {
      setActionLoading(null)
    }
  }

  const [copyFailed, setCopyFailed] = useState(false)

  const handleCopyToken = async () => {
    if (!activeTransfer?.transferToken) return
    try {
      await navigator.clipboard.writeText(activeTransfer.transferToken)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
      setTimeout(() => setCopyFailed(false), 3000)
    }
  }

  const showDeleteAlert = (siteId: string, siteName: string) => {
    setAlertState({
      siteId,
      type: 'delete',
      message: <FormattedMessage id='builder_apps_alert_delete' values={{ siteName: siteName || t('builder_apps_alert_delete_untitled') }} />
    })
  }

  const showCancelTransferAlert = () => {
    setAlertState({
      siteId: site.id,
      type: 'cancel-transfer',
      message: t('builder_transfer_cancel_confirm', { appName: site.name || t('builder_apps_alert_delete_untitled', undefined, 'Untitled') }, 'Cancel transfer for {appName}?')
    })
  }

  const clearAlert = () => {
    setAlertState({ siteId: null, type: null, message: '' })
  }

  const openRenameDialog = () => {
    setNewName(site.name || '')
    setRenameError(null)
    setIsRenameDialogOpen(true)
  }

  const closeRenameDialog = () => {
    setIsRenameDialogOpen(false)
    setNewName(site.name || '')
    setRenameError(null)
  }

  const handleUnpublish = (disconnectDomain: boolean) => {
    unpublishMutation.mutate(
      { appId: site.id, disconnectDomain },
      {
        onSuccess: async () => {
          setIsUnpublishModalOpen(false)
          setPublishedUrl(null)
          await fetchAllSites()
        },
      }
    )
  }

  const handleRename = () => {
    const trimmed = newName.trim()

    if (!trimmed) {
      setRenameError(t('builder_apps_rename_error_empty'))
      return
    }

    if (trimmed.length > 100) {
      setRenameError(t('builder_apps_rename_error_too_long'))
      return
    }

    if (trimmed === site.name) {
      closeRenameDialog()
      return
    }

    renameApp(
      { appId: site.id, newName: trimmed },
      {
        onSuccess: () => {
          logger.info('app-card.rename.success', { appId: site.id, newName: trimmed })
          closeRenameDialog()
        },
        onError: (error) => {
          logger.error('app-card.rename.error', { appId: site.id, error: error.message })
          setRenameError(error.message || t('builder_apps_rename_error_failed'))
        }
      }
    )
  }

  const InlineAlert = ({ message, onConfirm, onCancel, confirmLabel, isLoading: loading }: {
    message: string | React.ReactNode
    onConfirm: () => void
    onCancel: () => void
    confirmLabel?: string
    isLoading?: boolean
  }) => (
    <div data-testid="inline-confirmation" onClick={(e) => e.stopPropagation()} className="absolute inset-0 bg-intents-ux-box-backgroundColor rounded-lg flex flex-col items-center justify-center p-2 z-10">
      <p className="mb-2 text-center">{message}</p>
      <Box orientation="horizontal" gap="sm">
        <Button
          data-testid="confirm-button"
          onClick={onConfirm}
          disabled={loading}
          data-eid={generateClickEID('apps.app.confirm')}
          className="text-white px-2 py-1 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          text={confirmLabel || t('builder_common_confirm')}
          design="critical"
          size="sm"
        />
        <Button
          data-eid={generateClickEID('apps.app.cancel')}
          onClick={onCancel}
          text={t('builder_common_cancel')}
          design="secondary"
          size="sm"
        />
      </Box>
    </div>
  )

  const hasActiveTransfer = activeTransfer !== null

  const transferMenuItem = (
    <MenuItem
      onClick={() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        setIsTransferDialogOpen(true)
      }}
      data-eid={generateClickEID('apps.app.transfer')}
      data-testid="app-card-transfer-button"
    >
      <Box orientation="horizontal" gap="sm">
        <ShareIcon />
        <text.span>{t('builder_transfer_menu_item', undefined, 'Transfer')}</text.span>
      </Box>
    </MenuItem>
  )

  const cornerActions = (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Menu
        id="app-card-menu"
        size="sm"
        closeOnSelect
        onSelect={() => {
          menuClosedRef.current = true;
          setTimeout(() => { menuClosedRef.current = false; }, 300);
        }}
      >
        <MenuButton
          aria-label={t('builder_apps_menu_actions')}
          data-testid="app-card-menu-button"
          design="control"
          size="sm"
          icon={<MenuIcon />}
        />
        <MenuList stretch>
          <MenuItem
            data-eid={generateClickEID('apps.app.menu_edit')}
            href={`/develop/${site.id}?siteId=${site.id}`}
            isLink={true}
          >
            <Box orientation="horizontal" gap="sm">
              <EditIcon />
              <text.span>{t('builder_common_edit')}</text.span>
            </Box>
          </MenuItem>
          {publishedUrl && (
            <MenuItem
              onClick={() => window.open(publishedUrl, '_blank', 'noopener,noreferrer')}
              data-eid={generateClickEID('apps.app.visit_published')}
            >
              <Box orientation="horizontal" gap="sm">
                <WebsiteIcon />
                <text.span>{t('builder_apps_menu_visit')}</text.span>
              </Box>
            </MenuItem>
          )}
          {isUnpublishEnabled && hasBeenPublished(site) && (
            <MenuItem
              onClick={() => setIsUnpublishModalOpen(true)}
              data-eid={generateClickEID('apps.app.unpublish')}
              data-testid="app-card-unpublish-button"
            >
              <Box orientation="horizontal" gap="sm">
                <UnlinkIcon />
                <text.span>{t('builder_apps_menu_unpublish')}</text.span>
              </Box>
            </MenuItem>
          )}
          {site.status === 'running' && site.preview_url && (
            <MenuItem
              onClick={() => window.open(site.preview_url, '_blank', 'noopener,noreferrer')}
              data-eid={generateClickEID('apps.app.view')}
              data-testid="app-card-view-button"
            >
              <Box orientation="horizontal" gap="sm">
                <ShowIcon />
                <text.span>{t('builder_apps_menu_preview')}</text.span>
              </Box>
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            href={`/develop/${site.id}?siteId=${site.id}&settings=domain&tab=settings`}
            isLink={true}
          >
            <Box orientation="horizontal" gap="sm">
              <SettingsIcon />
              <text.span>{t('builder_apps_menu_settings')}</text.span>
            </Box>
          </MenuItem>
          <MenuItem
            onClick={openRenameDialog}
            data-eid={generateClickEID('apps.app.rename')}
          >
            <Box orientation="horizontal" gap="sm">
              <EditIcon />
              <text.span>{t('builder_common_rename')}</text.span>
            </Box>
          </MenuItem>
          {isTransferEnabled && !hasActiveTransfer && transferMenuItem}
          <MenuSeparator />
          <MenuItem
            onClick={() => showDeleteAlert(site.id, site.name || t('builder_apps_alert_delete_untitled'))}
            data-eid={generateClickEID('apps.app.delete')}
            data-testid="app-card-delete-button"
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

  const publishedTag = hasBeenPublished(site) && (
    <Tag emphasis="highlight">{t('builder_status_published')}</Tag>
  )

  const errorTag = (site.status === 'error' || site.status === 'failed') && (
    <Tag emphasis="critical">{t('builder_status_error')}</Tag>
  )

  const statusTags = (publishedTag || errorTag) && (
    <Box data-partial="componentAiro" orientation="horizontal" gap="sm" wrap>
      {publishedTag}
      {errorTag}
    </Box>
  )
  const title = (
    <div className={clsx("flex flex-col gap-1 w-full", !statusTags && "md:pt-3.5")}>
      {statusTags}
      <div className="flex flex-col w-full">
        <span className="line-clamp-1">{site.name || t('builder_apps_alert_delete_untitled')}</span>
        {createdDate}
      </div>
    </div>
  )

  const description = (
    <div className="line-clamp-2 sm:line-clamp-3 wrap-anywhere">
      {site.initial_prompt}
    </div>
  )

  const media = (
    <div className="w-full sm:w-1/2 h-[144px] sm:h-[192px] rounded-lg overflow-hidden shrink-0">
      <AppThumbnail
        siteId={site.id}
        siteName={site.name || t('builder_apps_alert_delete_untitled')}
      />
    </div>
  )

  if (isTransferEnabled && hasActiveTransfer) {
    return (
      <>
        <Card className="relative">
          <Box orientation="vertical" gap="sm" className="items-center justify-center py-2">
            <Tag emphasis="info">{t('builder_transfer_status_pending', undefined, 'TRANSFER PENDING')}</Tag>
            <text.p size={2} className="font-bold text-center">
              {site.name || t('builder_apps_alert_delete_untitled')}
            </text.p>
            {activeTransfer.expiresAt && (
              <text.p size={0} emphasis="passive">
                {t('builder_transfer_outgoing_expires', { date: formatDate(activeTransfer.expiresAt) }, 'Expires {date}')}
              </text.p>
            )}
            <div className="flex gap-2 pt-2 w-full px-4">
              <Button
                onClick={showCancelTransferAlert}
                design="secondary"
                size="sm"
                text={t('builder_transfer_cancel_menu_item', undefined, 'Cancel Transfer')}
                data-testid="app-card-cancel-transfer-button"
                data-eid={generateClickEID('apps.app.cancel_transfer')}
                className="flex-1 justify-center"
              />
              <Button
                onClick={handleCopyToken}
                design="primary"
                size="sm"
                data-testid="app-card-copy-code-button"
                data-eid={generateClickEID('apps.app.copy_transfer_code')}
                className="flex-1 justify-center"
              >
                <span className="flex items-center gap-1">
                  <CopyIcon className="size-2" />
                  {copied ? t('builder_transfer_token_copied', undefined, 'Copied!') : copyFailed ? t('builder_common_error', undefined, 'Error') : t('builder_transfer_copy_code', undefined, 'Copy Code')}
                </span>
              </Button>
            </div>
          </Box>
          {/* Cancel Transfer Inline Alert */}
          {alertState.siteId === site.id && alertState.type === 'cancel-transfer' && (
            <InlineAlert
              message={alertState.message}
              onConfirm={handleCancelTransfer}
              onCancel={clearAlert}
              confirmLabel={actionLoading === 'cancel-transfer' ? t('builder_transfer_cancelling', undefined, 'Cancelling...') : t('builder_transfer_cancel_confirm_button', undefined, 'Cancel Transfer')}
              isLoading={actionLoading === 'cancel-transfer'}
            />
          )}
          {cancelTransferError && (
            <div className="px-3 pb-2">
              <text.span size={-1} emphasis="critical">{cancelTransferError}</text.span>
            </div>
          )}
        </Card>
      </>
    )
  }

  return (
    <>
      <MediaCard
        as="button"
        onClick={() => {
          if (menuClosedRef.current) return;
          router.push(`/develop/${site.id}?siteId=${site.id}`);
        }}
        data-eid={generateClickEID('apps.app.edit')}
        data-testid="app-card-edit-button"
        aria-label={t('builder_common_edit') + ' ' + site.name || t('builder_apps_alert_delete_untitled')}
        className="sm:!flex-row touch-manipulation"
        cornerActions={cornerActions}
        title={title}
        description={description}
        media={media}
        mediaBleed={false}
        mediaStart={true}
      >
        {/* Delete Inline Alert */}
        {alertState.siteId === site.id && alertState.type === 'delete' && (
          <InlineAlert
            message={alertState.message}
            onConfirm={() => handleDeleteSite(site.id)}
            onCancel={clearAlert}
            confirmLabel={actionLoading === site.id ? t('builder_common_deleting') : t('builder_common_delete')}
            isLoading={actionLoading === site.id}
          />
        )}
        {cancelTransferError && (
          <div className="px-3 pb-2">
            <text.span size={-1} emphasis="critical">{cancelTransferError}</text.span>
          </div>
        )}
      </MediaCard>

      {/* Transfer Dialog */}
      {isTransferEnabled && isTransferDialogOpen && (
        <TransferInitiateDialog
          appId={site.id}
          appName={site.name || t('builder_apps_alert_delete_untitled')}
          onClose={() => setIsTransferDialogOpen(false)}
          onTransferCreated={(transferToken, expiresAt) => {
            setActiveTransfer({ transferToken, status: 'initiated', expiresAt })
          }}
        />
      )}

      {/* Rename Modal */}
      {isRenameDialogOpen && (
        <Modal
          title={t('builder_apps_rename_title')}
          onClose={closeRenameDialog}
          centered
          focusLock={false}
        >
          <Box orientation="vertical" gap="md" className="max-w-md">
            <text.p size={0} emphasis="passive">
              {t('builder_apps_rename_description')}
            </text.p>

            <Box orientation="vertical" gap="sm">
              <TextInput
                id="app-name"
                label={t('builder_apps_rename_label')}
                value={newName}
                onChange={(value) => {
                  setNewName(value)
                  setRenameError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isRenamePending) {
                    handleRename()
                  }
                }}
                errorMessage={renameError || undefined}
                disabled={isRenamePending}
                visualSize="sm"
                placeholder={t('builder_apps_rename_placeholder')}
                multiline={false}
                data-eid={generateClickEID('apps.app.rename_dialog_input')}
              />
            </Box>

            <Box orientation="horizontal" gap="sm" className="pt-4 justify-end">
              <Button
                onClick={closeRenameDialog}
                disabled={isRenamePending}
                design="secondary"
                size="sm"
                text={t('builder_common_cancel')}
                data-eid={generateClickEID('apps.app.rename_dialog_cancel')}
              />
              <Button
                onClick={handleRename}
                disabled={isRenamePending}
                design="primary"
                size="sm"
                text={isRenamePending ? t('builder_apps_rename_saving') : t('builder_common_rename')}
                data-eid={generateClickEID('apps.app.rename_dialog_save')}
              />
            </Box>
          </Box>
        </Modal>
      )}

      {isUnpublishModalOpen && (
        <UnpublishConfirmationModal
          appName={site.name || t('builder_apps_alert_delete_untitled')}
          publishedUrl={publishedUrl}
          onClose={() => setIsUnpublishModalOpen(false)}
          onConfirm={handleUnpublish}
          isLoading={unpublishMutation.isPending}
          error={unpublishMutation.error}
          onRetry={unpublishMutation.error?.retryable ? () => handleUnpublish(false) : undefined}
        />
      )}
    </>
  )
}

export const AppCardEmptyState = ({ onAcceptTransfer, isTransferEnabled }: { onAcceptTransfer?: () => void, isTransferEnabled?: boolean }) => {
  const t = useTranslations();
  const router = useRouter()

  return (
    <Card className="items-center justify-center relative">
      {isTransferEnabled && onAcceptTransfer && (
        <div className="absolute top-2 right-2 z-10">
          <Menu id="empty-card-menu" size="sm" closeOnSelect>
            <MenuButton
              aria-label={t('builder_apps_menu_actions', undefined, 'Actions')}
              data-testid="empty-card-menu-button"
              design="inline"
              size="sm"
              icon={<MenuIcon />}
            />
            <MenuList stretch>
              <MenuItem
                onClick={() => {
                  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                  onAcceptTransfer()
                }}
                data-testid="empty-state-accept-transfer"
              >
                <Box orientation="horizontal" gap="sm">
                  <ShareIcon />
                  <text.span>{t('builder_transfer_accept_button', undefined, 'Accept Transfer')}</text.span>
                </Box>
              </MenuItem>
            </MenuList>
          </Menu>
        </div>
      )}
      <button
        data-testid="create-app-card"
        onClick={() => router.push(`/`)}
        className="w-full h-full flex flex-col gap-1 items-center justify-center cursor-pointer"
      >
        <PlusIcon className="size-3 text-ai" />
        <text.p>{t('builder_apps_empty_create')}</text.p>
      </button>
    </Card>
  )
}
