import clsx from 'clsx';
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Box from '@ux/box'
import Button from '@ux/button'
import Card, { MediaCard } from '@ux/card'
import ArrowRightIcon from '@ux/icon/arrow-right'
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
import WindowNewIcon from '@ux/icon/window-new'
import { Menu, MenuButton, MenuItem, MenuList, MenuSeparator } from '@ux/menu'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import AppThumbnail from '@/app/[market]/apps/AppThumbnail'
import DeleteProjectConfirmationModal from '@/app/[market]/apps/components/DeleteProjectConfirmationModal'
import { transferEventProps } from '@/app/[market]/apps/components/transfer-constants'
import TransferInitiateDialog from '@/app/[market]/apps/components/TransferInitiateDialog'
import UnpublishConfirmationModal from '@/components/layout/UnpublishConfirmationModal'
import { SWITCHBOARD_APPBUILDER_APP_DELETE_MODAL } from '@/config/switchboard-flags'
import { useAppRename } from '@/hooks/useAppRename'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useUnpublishApp } from '@/hooks/useUnpublishApp'
import { SiteInfo, SiteStatus } from '@/lib/control-plane/types'
import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { isPublishedApp } from '@/lib/publish-limit'
import { logger } from '@/lib/request-context'
import { shouldShowAppNonCompliantOrAccountComplianceTag } from '@/lib/subscription'
import { useSitesStore } from '@/stores/useSitesStore'
import { formatDate } from '@/utils/common'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'
import { withPreviewParam } from '@/utils/previewUrl'
import { getAppScreenshotUrl, hasBeenPublished, isPreviewHibernated } from '@/utils/site'

// On-demand preview-token fetch (replacing the old per-app injection on the
// /api/sites list response). The list endpoint now returns the control-plane
// payload as-is; the share token is fetched only when a preview is opened.
const PREVIEW_TOKEN_TIMEOUT_MS = 5000

// Discriminated result of resolving a preview share token. `url` is the
// token-injected preview_url (or null on any failure); the rest carry failure
// detail for the click-path log (the prefetch ignores them).
type TokenResult = { url: string | null; reason?: string; status?: number; message?: string }

// Minimal self-contained loading page written into the synchronously-opened
// preview tab so the user sees a spinner instead of a blank page while the
// share token resolves. Replaced the moment we navigate the tab to the preview
// URL. Inline-only (no external assets) since about:blank has no origin; adapts
// to the OS color scheme to avoid a white flash in dark mode.
const PREVIEW_LOADING_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Loading preview…</title><style>
html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;background:#ffffff;font-family:system-ui,-apple-system,sans-serif}
@media(prefers-color-scheme:dark){body{background:#1d1d1f}}
.airo-preview-spinner{width:40px;height:40px;border:4px solid rgba(128,128,128,.3);border-top-color:rgba(128,128,128,.9);border-radius:50%;animation:airo-preview-spin .8s linear infinite}
@keyframes airo-preview-spin{to{transform:rotate(360deg)}}
</style></head><body><div class="airo-preview-spinner" role="status" aria-label="Loading preview"></div></body></html>`

// Fill a freshly window.open()'d tab with the loading page. Best-effort: some
// environments restrict document.write on about:blank — skip silently if so.
function renderPreviewLoadingTab(win: Window): void {
  try {
    win.document.write(PREVIEW_LOADING_HTML)
    win.document.close()
  } catch {
    // No-op: the tab simply stays blank until navigation, as before.
  }
}

// Navigate a tab that was opened synchronously on click (to preserve the
// user-activation gesture). If the original synchronous open was blocked
// (win === null), the user clicked Preview and saw nothing happen — log it so
// it's diagnosable, then attempt a fresh open as a best effort (the retry has
// lost the gesture and will usually be blocked too).
function navigatePreviewWindow(win: Window | null, url: string, appId: string): void {
  if (win) {
    win.location.href = url
    return
  }
  logger.warn('apps.preview.popupBlocked', { appId })
  window.open(url, '_blank', 'noopener,noreferrer')
}

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

export default function AppCard({ site, transferAllowed = false }: { site: SiteInfo; transferAllowed?: boolean }) {
  const router = useRouter();
  const t = useTranslations();

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>({ siteId: null, type: null, message: '' })
  const [optimisticUnpublished, setOptimisticUnpublished] = useState(false)
  const publishedUrl = useMemo(function derivePublishedUrl() {
    if (optimisticUnpublished) return null
    if (site.published_url && hasBeenPublished(site)) {
      return site.published_url
    }
    return null
  }, [site, optimisticUnpublished])
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false)
  const [cancelTransferError, setCancelTransferError] = useState<string | null>(null)
  const [activeTransfer, setActiveTransfer] = useState<ActiveTransfer | null>(null)
  const [copied, setCopied] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isUnpublishModalOpen, setIsUnpublishModalOpen] = useState(false)
  const [transferValidating, setTransferValidating] = useState(false)
  const [transferBlockedReason, setTransferBlockedReason] = useState<string | null>(null)
  const [newName, setNewName] = useState(site.name || '')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isOpeningPreview, setIsOpeningPreview] = useState(false)

  const menuClosedRef = useRef(false)
  const openingPreviewRef = useRef(false)
  // Token-injected preview_url warmed on hover/focus of a preview control so
  // the click can navigate the tab immediately instead of waiting on the
  // round-trip. AppCard is keyed by site.id in the list, so this ref is
  // per-app and needs no invalidation.
  const prefetchedPreviewUrlRef = useRef<string | null>(null)
  const previewTokenPromiseRef = useRef<Promise<TokenResult> | null>(null)
  const deleteSite = useSitesStore((state) => state.deleteSite)
  const fetchAllSites = useSitesStore((state) => state.fetchAllSites)
  const refreshSites = useSitesStore((state) => state.refreshSites)
  const { mutate: renameApp, isPending: isRenamePending } = useAppRename()
  const isDeleteModalEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_APP_DELETE_MODAL) === true
  const isUnpublishEnabled = useSwitchboard('appbuilder-unpublish')
  const isPreviewHeaderEnabled = useSwitchboard('appbuilder-preview-header') === true
  const { data: subscription } = useSubscription()
  const suspendedComplianceBannerEnabled = useSwitchboard('appbuilder-suspended-compliance-banner')
  const unpublishMutation = useUnpublishApp()

  // Resolve the token-injected preview_url for THIS app. Single source of truth
  // for both the hover/focus/pointer-down prefetch and the click path, so a
  // click that lands during an in-flight prefetch reuses that one request
  // instead of firing a second ?site_id= fetch. Never throws and never logs —
  // callers decide what to do with the discriminated result.
  const fetchPreviewToken = useCallback((): Promise<TokenResult> => {
    if (prefetchedPreviewUrlRef.current) {
      return Promise.resolve({ url: prefetchedPreviewUrlRef.current })
    }
    if (previewTokenPromiseRef.current) {
      return previewTokenPromiseRef.current
    }
    const promise = (async (): Promise<TokenResult> => {
      try {
        const res = await appFetch(
          `/api/sites?site_id=${encodeURIComponent(site.id)}`,
          { signal: AbortSignal.timeout(PREVIEW_TOKEN_TIMEOUT_MS) },
        )
        if (!res.ok) return { url: null, reason: 'http', status: res.status }
        const data = (await res.json()) as { preview_url?: unknown }
        if (typeof data.preview_url === 'string') {
          prefetchedPreviewUrlRef.current = data.preview_url
          return { url: data.preview_url }
        }
        return { url: null, reason: 'no-preview-url' }
      } catch (error) {
        return {
          url: null,
          reason: error instanceof Error ? error.name : 'unknown',
          message: error instanceof Error ? error.message : String(error),
        }
      } finally {
        // Clear the in-flight handle on success and failure. The resolved URL
        // is cached in prefetchedPreviewUrlRef only on success, so a failed
        // attempt leaves no poison — the next call refetches.
        previewTokenPromiseRef.current = null
      }
    })()
    // Assign synchronously (before returning) so same-tick callers —
    // pointerenter + pointerdown + focus — dedupe onto this one request.
    previewTokenPromiseRef.current = promise
    return promise
  }, [site.id])

  // Warm the preview token on hover/focus/pointer-down of a preview control so
  // the click can navigate immediately. Best-effort and silent; the click path
  // logs failures.
  const prefetchPreviewUrl = useCallback(() => {
    if (!site.preview_url) return
    void fetchPreviewToken()
  }, [site.preview_url, fetchPreviewToken])

  // Open the live preview in a new tab, using the hover/focus-prefetched
  // token-injected URL when it's ready, otherwise fetching on demand for this
  // one app. The token is no longer injected on the /api/sites list response
  // (that made the un-paginated list O(N) agent round-trips and stalled on
  // hibernated/unreachable agents); we resolve it via the single-site
  // ?site_id= path only when a preview is opened.
  const openPreview = useCallback(() => {
    const previewUrl = site.preview_url
    if (!previewUrl || openingPreviewRef.current) return

    // Open synchronously so the browser keeps the user-activation gesture —
    // window.open() after an await is blocked by popup blockers (notably
    // Safari). The tab shows blank, then navigates once the token resolves.
    const win = window.open('about:blank', '_blank')
    if (win) {
      win.opener = null
      // Show a spinner in the opened tab so it isn't blank while the token
      // resolves. Prefetch makes the warm case instant; this covers the cold/
      // slow case where the fetch hasn't landed by click time.
      renderPreviewLoadingTab(win)
    }

    openingPreviewRef.current = true
    setIsOpeningPreview(true)

    // Bare URL (matching today's withPreviewParam behavior) used as the
    // fallback if the token fetch fails, times out, or returns nothing.
    const fallbackUrl = isPreviewHeaderEnabled ? withPreviewParam(previewUrl) : previewUrl

    void (async () => {
      try {
        // Reuses the in-flight hover/focus/pointer-down prefetch if there is
        // one, or the cached result, else fetches now. Never throws.
        const r = await fetchPreviewToken()
        if (!r.url) {
          // Best-effort token: any non-OK (incl. a 401 from an expired SSO
          // session), timeout, network, parse, or missing-preview_url failure
          // falls back to the bare URL rather than forcing a re-auth
          // interruption on a low-stakes preview click. Keep the reason/status
          // discriminators so failures aren't invisible in Loki.
          logger.warn('apps.preview.tokenFetch.failed', {
            appId: site.id,
            reason: r.reason ?? 'unknown',
            ...(r.status !== undefined ? { status: r.status } : {}),
            ...(r.message ? { error: r.message } : {}),
          })
          navigatePreviewWindow(win, fallbackUrl, site.id)
          return
        }
        // Apply withPreviewParam here at the current render's flag value — never
        // inside the cached resolver (avoids a stale-flag closure).
        navigatePreviewWindow(win, isPreviewHeaderEnabled ? withPreviewParam(r.url) : r.url, site.id)
      } finally {
        openingPreviewRef.current = false
        setIsOpeningPreview(false)
      }
    })()
  }, [site.id, site.preview_url, isPreviewHeaderEnabled, fetchPreviewToken])

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

  useEffect(function loadTransferStatus() {
    if (!transferAllowed) return
    const controller = new AbortController()
    fetchTransferStatus(controller.signal)
    return () => controller.abort()
  }, [site.id, fetchTransferStatus, transferAllowed])

  const handleDeleteSite = async (siteId: string) => {
    setActionLoading(siteId)
    try {
      const success = await deleteSite(siteId)
      if (success) {
        setIsDeleteModalOpen(false)
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
      const response = await appFetch(`/api/apps/${site.id}/transfer/cancel`, { method: 'POST' }, { authLevel: 3 })
      if (response.ok) {
        logClickEvent('apps.transfer.cancel_success', transferEventProps(site.id))()
        setActiveTransfer(null)
        setAlertState({ siteId: null, type: null, message: '' })
        refreshSites()
      } else {
        const data = await response.json()
        logClickEvent('apps.transfer.cancel_error', transferEventProps(site.id))()
        logger.error('transfer.cancel.ui.failed', { appId: site.id, error: data })
        setAlertState({ siteId: null, type: null, message: '' })
        setCancelTransferError(data.error || t('builder_transfer_error_cancel_failed', undefined, 'Failed to cancel transfer. Please try again.'))
      }
    } catch (error) {
      if (error instanceof AuthDismissedError) return
      logClickEvent('apps.transfer.cancel_error', transferEventProps(site.id))()
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

  const handleTransferClick = async () => {
    setTransferValidating(true)
    setTransferBlockedReason(null)
    try {
      const response = await appFetch(`/api/apps/${site.id}/transfer/validate`)
      if (!response.ok) {
        logger.error('transfer.validate.ui.httpError', {
          appId: site.id,
          status: response.status,
        })
        setTransferBlockedReason(t('builder_common_error_generic', undefined, 'Unable to verify transfer eligibility. Please try again.'))
        return
      }
      const data = await response.json()
      if (!data.canTransfer) {
        setTransferBlockedReason(t('builder_transfer_blocked_commerce', undefined, 'Transfer is unavailable for apps with GoDaddy Commerce integration.'))
        return
      }
      logClickEvent('apps.app.transfer', transferEventProps(site.id))()
      setIsTransferDialogOpen(true)
    } catch (error) {
      logger.error('transfer.validate.ui.error', {
        appId: site.id,
        error: error instanceof Error ? error.message : String(error)
      })
      setTransferBlockedReason(t('builder_common_error_generic', undefined, 'Unable to verify transfer eligibility. Please try again.'))
    } finally {
      setTransferValidating(false)
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

  const handleDeleteClick = () => {
    if (isDeleteModalEnabled) {
      setIsDeleteModalOpen(true)
    } else {
      showDeleteAlert(site.id, site.name || t('builder_apps_alert_delete_untitled'))
    }
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
          setOptimisticUnpublished(true)
          try {
            await fetchAllSites()
          } finally {
            setOptimisticUnpublished(false)
          }
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

  const InlineAlert = ({ message, onConfirm, onCancel, confirmLabel, isLoading: loading, confirmEid = 'apps.app.confirm', cancelEid = 'apps.app.cancel' }: {
    message: string | React.ReactNode
    onConfirm: () => void
    onCancel: () => void
    confirmLabel?: string
    isLoading?: boolean
    confirmEid?: string
    cancelEid?: string
  }) => (
    <div data-testid="inline-confirmation" onClick={(e) => e.stopPropagation()} className="absolute inset-0 bg-intents-ux-box-backgroundColor rounded-lg flex flex-col items-center justify-center p-2">
      <p className="mb-2 text-center">{message}</p>
      <Box orientation="horizontal" gap="sm">
        <Button
          data-testid="confirm-button"
          onClick={onConfirm}
          disabled={loading}
          data-eid={generateClickEID(confirmEid)}
          className="text-white px-2 py-1 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          text={confirmLabel || t('builder_common_confirm')}
          design="critical"
          size="sm"
        />
        <Button
          data-eid={generateClickEID(cancelEid)}
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
        handleTransferClick()
      }}
      data-testid="app-card-transfer-button"
      data-eid={generateClickEID('apps.app.transfer')}
      disabled={transferValidating}
    >
      <Box orientation="horizontal" gap="sm">
        <ShareIcon />
        <text.span>{transferValidating ? t('builder_transfer_validating', undefined, 'Validating...') : t('builder_transfer_menu_item', undefined, 'Transfer')}</text.span>
      </Box>
    </MenuItem>
  )

  const cornerActions = (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="flex gap-1 items-center"
    >
      {site.status === SiteStatus.Running && site.preview_url && !isPreviewHibernated(site) && (
        <Button
          design="secondary"
          size="sm"
          icon={isOpeningPreview ? <Spinner size="sm" /> : <WindowNewIcon />}
          onClick={openPreview}
          onPointerEnter={prefetchPreviewUrl}
          onPointerDown={prefetchPreviewUrl}
          onFocus={prefetchPreviewUrl}
          disabled={isOpeningPreview}
          data-eid={generateClickEID('apps.app.preview_corner')}
          data-testid="app-card-preview-button"
          aria-label={t('builder_apps_menu_preview')}
        />
      )}
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
          design="secondary"
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
          {isUnpublishEnabled && isPublishedApp(site) && (
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
          {site.status === SiteStatus.Running && site.preview_url && !isPreviewHibernated(site) && (
            <MenuItem
              onClick={openPreview}
              onPointerEnter={prefetchPreviewUrl}
              onPointerDown={prefetchPreviewUrl}
              onFocus={prefetchPreviewUrl}
              data-eid={generateClickEID('apps.app.view')}
              data-testid="app-card-view-button"
            >
              <Box orientation="horizontal" gap="sm">
                <WindowNewIcon />
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
          {transferAllowed && !hasActiveTransfer && transferMenuItem}
          <MenuSeparator />
          <MenuItem
            onClick={handleDeleteClick}
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

  const suspendedTag =
    shouldShowAppNonCompliantOrAccountComplianceTag(
      site,
      subscription,
      suspendedComplianceBannerEnabled
    ) && (
      <Tag emphasis="critical">{t('builder_status_suspended')}</Tag>
    )

  const publishedTag = hasBeenPublished(site) && (
    <Tag emphasis="highlight">{t('builder_status_published')}</Tag>
  )

  const errorTag = (site.status === SiteStatus.Error || site.status === SiteStatus.Failed) && (
    <Tag emphasis="critical">{t('builder_status_error')}</Tag>
  )

  const sharedTag = site.sharedWithMe && (
    <Tag emphasis="info">{t('builder_apps_shared_with_you', undefined, 'Shared with you')}</Tag>
  )

  const statusTags = (sharedTag || suspendedTag || publishedTag || errorTag) && (
    <Box data-partial="componentAiro" orientation="horizontal" gap="sm" wrap>
      {sharedTag}
      {suspendedTag}
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
        key={getAppScreenshotUrl(site)}
        siteName={site.name || t('builder_apps_alert_delete_untitled')}
        screenshotUrl={getAppScreenshotUrl(site)}
      />
    </div>
  )

  if (transferAllowed && hasActiveTransfer) {
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
                icon={<CopyIcon className="size-2" />}
                text={copied ? t('builder_transfer_token_copied', undefined, 'Copied!') : copyFailed ? t('builder_common_error', undefined, 'Error') : t('builder_transfer_copy_code', undefined, 'Copy Code')}
              />
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
              confirmEid="apps.transfer.cancel_confirm"
              cancelEid="apps.transfer.cancel_dismiss"
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
      <div>
        <MediaCard
          as="button"
          onClick={(e) => {
            if (menuClosedRef.current) return;
            router.push(`/develop/${site.id}?siteId=${site.id}`);
          }}
          data-eid={generateClickEID('apps.app.edit')}
          data-testid="app-card-edit-button"
          aria-label={t('builder_common_edit') + ' ' + site.name || t('builder_apps_alert_delete_untitled')}
          className={clsx("sm:!flex-row", transferBlockedReason && "!rounded-b-none")}
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
          {/* Cancel Transfer Inline Alert */}
          {alertState.siteId === site.id && alertState.type === 'cancel-transfer' && (
            <InlineAlert
              message={alertState.message}
              onConfirm={handleCancelTransfer}
              onCancel={clearAlert}
              confirmLabel={actionLoading === 'cancel-transfer' ? t('builder_transfer_cancelling', undefined, 'Cancelling...') : t('builder_transfer_cancel_confirm_button', undefined, 'Cancel Transfer')}
              isLoading={actionLoading === 'cancel-transfer'}
              confirmEid="apps.transfer.cancel_confirm"
              cancelEid="apps.transfer.cancel_dismiss"
            />
          )}
          {cancelTransferError && (
            <div className="px-3 pb-2">
              <text.span size={-1} emphasis="critical">{cancelTransferError}</text.span>
            </div>
          )}
        </MediaCard>
        {transferBlockedReason && (
          <div className="border border-t-0 border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor rounded-b-xl px-4 py-2.5" data-testid="transfer-blocked-reason">
            <text.span size={-1} emphasis="critical">{transferBlockedReason}</text.span>
          </div>
        )}
      </div>

      {/* Transfer Dialog */}
      {transferAllowed && isTransferDialogOpen && (
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
          portalElem={document.body}
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

      {isDeleteModalEnabled && isDeleteModalOpen && (
        <DeleteProjectConfirmationModal
          projectName={site.name || t('builder_apps_alert_delete_untitled')}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={() => handleDeleteSite(site.id)}
          isLoading={actionLoading === site.id}
        />
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

