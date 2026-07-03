'use client'

import clsx from 'clsx'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Growl from '@ux/growl'
import EditIcon from '@ux/icon/edit'
import LinkIcon from '@ux/icon/link'
import ShareIcon from '@ux/icon/share'
import TrashIcon from '@ux/icon/trash'
import UnlinkIcon from '@ux/icon/unlink'
import WebsiteIcon from '@ux/icon/website'
import { Menu, MenuButton, MenuItem, MenuList, MenuSeparator } from '@ux/menu'
import Tag from '@ux/tag'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import AppThumbnail from '@/app/[market]/apps/AppThumbnail'
import DeleteProjectConfirmationModal from '@/app/[market]/apps/components/DeleteProjectConfirmationModal'
import ShareLinkModal from '@/app/[market]/develop/components/layout/ShareLinkModal'
import { KebabIcon } from '@/app/[market]/projects/components/icons'
import ProjectCardActionsSheet, {
  type ProjectCardAction,
} from '@/app/[market]/projects/components/ProjectCardActionsSheet'
import ProjectsActionModal, {
  ProjectsActionModalFooter,
} from '@/app/[market]/projects/components/ProjectsActionModal'
import { TransferMenuLabel } from '@/app/[market]/projects/components/transfer-menu-label'
import type { ViewMode } from '@/app/[market]/projects/constants'
import { getProjectType } from '@/app/[market]/projects/lib/projectType'
import { useLongPress } from '@/app/[market]/projects/lib/useLongPress'
import UnpublishConfirmationModal from '@/components/layout/UnpublishConfirmationModal'
import { useAppRename } from '@/hooks/useAppRename'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'
import { useUnpublishApp } from '@/hooks/useUnpublishApp'
import { SiteInfo, SiteStatus } from '@/lib/control-plane/types'
import { isPublishedApp } from '@/lib/publish-limit'
import { useSitesStore } from '@/stores/useSitesStore'
import { formatDate } from '@/utils/common'
import { generateClickEID } from '@/utils/instrumentation'
import { getAppScreenshotUrl, hasBeenPublished } from '@/utils/site'

interface SelectionCheckboxProps {
  checked: boolean
  onChange: () => void
  label: string
  className?: string
}

function SelectionCheckbox({ checked, onChange, label, className }: SelectionCheckboxProps) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <div className={className} onClick={stop} onPointerDown={stop} onPointerUp={stop}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="size-[16px] cursor-pointer accent-ai"
        data-testid="project-card-select"
      />
    </div>
  )
}

interface ProjectCardProps {
  site: SiteInfo
  view?: ViewMode
  showTransfer?: boolean
  onTransfer?: (site: SiteInfo) => void
  /** Whether this card is currently selected (multi-select mode). */
  selected?: boolean
  /** When any card is selected, keep checkboxes visible across all cards. */
  selectionActive?: boolean
  /** Toggle this card's selection. When provided, the hover checkbox renders. */
  onToggleSelect?: (id: string) => void
}

export default function ProjectCard({
  site,
  view = 'grid',
  showTransfer = false,
  onTransfer,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: ProjectCardProps) {
  const router = useRouter()
  const t = useTranslations()

  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isUnpublishOpen, setIsUnpublishOpen] = useState(false)
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isActionsSheetOpen, setIsActionsSheetOpen] = useState(false)
  const [newName, setNewName] = useState(site.name || '')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const menuClosedRef = useRef(false)
  const { isMdBreakpoint } = useBreakpoints()
  const mobileSelectionEnabled = !isMdBreakpoint && !!onToggleSelect

  const deleteSite = useSitesStore((state) => state.deleteSite)
  const fetchAllSites = useSitesStore((state) => state.fetchAllSites)
  const { mutate: renameApp, isPending: isRenamePending } = useAppRename()
  const unpublishMutation = useUnpublishApp()

  const transferLabel = t('builder_transfer_menu_item')

  const type = getProjectType(site)
  const isLogo = type === 'logo'
  const editHref = `/develop/${site.id}?siteId=${site.id}`
  const untitled = t('builder_apps_alert_delete_untitled', undefined, 'Untitled')
  const displayName = site.name || untitled
  const screenshotUrl = getAppScreenshotUrl(site)
  const thumbnailProps = {
    siteName: displayName,
    screenshotUrl,
    projectType: type,
  }

  const publishedUrl = useMemo(() => {
    if (site.published_url && hasBeenPublished(site)) return site.published_url
    return null
  }, [site])

  const isPublished = isPublishedApp(site)

  const statusTag = useMemo(() => {
    if (site.status === SiteStatus.Error || site.status === SiteStatus.Failed) {
      return <Tag emphasis="critical">{t('builder_status_error', undefined, 'Error')}</Tag>
    }
    if (hasBeenPublished(site)) {
      return <Tag emphasis="success">{t('builder_status_published', undefined, 'Published')}</Tag>
    }
    return null
  }, [site, t])

  const handleLongPressSelect = useCallback(() => {
    onToggleSelect?.(site.id)
  }, [onToggleSelect, site.id])

  const { handlers: longPressHandlers, consumeTriggered } = useLongPress(handleLongPressSelect, {
    delay: 500,
    enabled: mobileSelectionEnabled,
  })

  const selectionCheckbox = onToggleSelect ? (
    <SelectionCheckbox
      checked={selected}
      onChange={() => onToggleSelect(site.id)}
      label={t('builder_projects_select_card')}
      className={clsx(
        'absolute right-2 top-2 transition-opacity',
        selected || selectionActive ? 'opacity-100' : 'opacity-0 md:group-hover:opacity-100'
      )}
    />
  ) : null

  const navigateToEdit = () => router.push(editHref)

  const handleCardClick = () => {
    if (menuClosedRef.current || consumeTriggered()) return
    if (selectionActive && onToggleSelect) {
      onToggleSelect(site.id)
      return
    }
    navigateToEdit()
  }

  const markMenuClosed = () => {
    menuClosedRef.current = true
    setTimeout(() => {
      menuClosedRef.current = false
    }, 300)
  }

  const closeActionsSheet = () => {
    markMenuClosed()
    setIsActionsSheetOpen(false)
  }

  const runSheetAction = (action: () => void) => {
    closeActionsSheet()
    action()
  }

  const openRename = () => {
    setNewName(site.name || '')
    setRenameError(null)
    setIsRenameOpen(true)
  }

  const closeRename = () => {
    setIsRenameOpen(false)
    setNewName(site.name || '')
    setRenameError(null)
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
      closeRename()
      return
    }
    renameApp(
      { appId: site.id, newName: trimmed },
      {
        onSuccess: () => {
          closeRename()
          Growl.addGrowlMessage({
            id: `projects-rename-success-${site.id}`,
            title: t('builder_apps_rename_success'),
            emphasis: 'success',
            lifetime: 4000,
          })
        },
        onError: (error) =>
          setRenameError(error.message || t('builder_apps_rename_error_failed')),
      }
    )
  }

  const handleUnpublish = (disconnectDomain: boolean) => {
    unpublishMutation.mutate(
      { appId: site.id, disconnectDomain },
      {
        onSuccess: async () => {
          setIsUnpublishOpen(false)
          await fetchAllSites()
          Growl.addGrowlMessage({
            id: `projects-unpublish-success-${site.id}`,
            title: t('builder_apps_unpublish_success'),
            emphasis: 'success',
            lifetime: 4000,
          })
        },
      }
    )
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const ok = await deleteSite(site.id)
      if (ok) {
        setIsDeleteOpen(false)
        Growl.addGrowlMessage({
          id: `projects-delete-success-${site.id}`,
          title: t('builder_projects_delete_success'),
          emphasis: 'success',
          lifetime: 4000,
        })
      } else {
        Growl.addGrowlMessage({
          id: `projects-delete-error-${site.id}`,
          title: t('builder_projects_delete_error'),
          emphasis: 'critical',
          lifetime: 4000,
        })
      }
    } finally {
      setDeleting(false)
    }
  }

  const handleTransferClick = () => {
    onTransfer?.(site)
  }

  const cardActions: ProjectCardAction[] = [
    {
      id: 'edit',
      label: t('builder_common_edit'),
      icon: <EditIcon />,
      onClick: () => runSheetAction(navigateToEdit),
    },
    ...(!isLogo
      ? [
          {
            id: 'visit',
            label: t('builder_apps_menu_visit'),
            icon: <WebsiteIcon />,
            onClick: () =>
              runSheetAction(() => window.open(publishedUrl || editHref, '_blank', 'noopener,noreferrer')),
          } satisfies ProjectCardAction,
        ]
      : []),
    ...(!isLogo
      ? [
          {
            id: 'share',
            label: t('builder_social_share'),
            icon: <ShareIcon />,
            onClick: () => runSheetAction(() => setIsShareOpen(true)),
          } satisfies ProjectCardAction,
        ]
      : []),
    {
      id: 'rename',
      label: t('builder_common_rename'),
      icon: <EditIcon />,
      onClick: () => runSheetAction(openRename),
    },
    ...(showTransfer
      ? [
          {
            id: 'transfer',
            label: transferLabel,
            icon: <LinkIcon />,
            onClick: () => runSheetAction(handleTransferClick),
          } satisfies ProjectCardAction,
        ]
      : []),
    ...(!isLogo && isPublished
      ? [
          {
            id: 'unpublish',
            label: t('builder_apps_menu_unpublish'),
            icon: <UnlinkIcon />,
            onClick: () => runSheetAction(() => setIsUnpublishOpen(true)),
          } satisfies ProjectCardAction,
        ]
      : []),
    {
      id: 'delete',
      label: t('builder_apps_menu_delete'),
      icon: <TrashIcon />,
      emphasis: 'critical',
      showSeparatorBefore: true,
      onClick: () => runSheetAction(() => setIsDeleteOpen(true)),
    },
  ]

  const stopActionPropagation = (e: React.SyntheticEvent) => e.stopPropagation()

  const actionsSheet = (
    <ProjectCardActionsSheet
      open={isActionsSheetOpen}
      onOpenChange={(open) => {
        if (!open) closeActionsSheet()
        else setIsActionsSheetOpen(true)
      }}
      title={displayName}
      actions={cardActions}
    />
  )

  const desktopActions = (
    <div
      className="flex items-center gap-1"
      onClick={stopActionPropagation}
      onPointerDown={stopActionPropagation}
      onPointerUp={stopActionPropagation}
    >
      <Button
        design="control"
        size="sm"
        icon={<EditIcon />}
        onClick={navigateToEdit}
        aria-label={t('builder_common_edit')}
        data-eid={generateClickEID('projects.card.edit')}
        data-testid="project-card-edit-button"
        data-app-id={site.id}
      />
      <Menu id={`project-card-menu-${site.id}`} size="sm" closeOnSelect onSelect={markMenuClosed}>
        <MenuButton
          design="control"
          size="sm"
          icon={<KebabIcon className="size-4" />}
          aria-label={t('builder_apps_menu_actions')}
          data-testid="project-card-menu-button"
        />
        <MenuList stretch placement="bottom-end" flip>
          <MenuItem href={editHref} isLink data-eid={generateClickEID('projects.card.menu_edit')}>
            <Box orientation="horizontal" gap="sm">
              <EditIcon />
              <text.span>{t('builder_common_edit')}</text.span>
            </Box>
          </MenuItem>
          {!isLogo && (
            <MenuItem
              onClick={() => window.open(publishedUrl || editHref, '_blank', 'noopener,noreferrer')}
              data-eid={generateClickEID('projects.card.visit')}
              data-testid="project-card-view-button"
            >
              <Box orientation="horizontal" gap="sm">
                <WebsiteIcon />
                <text.span>{t('builder_apps_menu_visit')}</text.span>
              </Box>
            </MenuItem>
          )}
          {!isLogo && (
            <MenuItem onClick={() => setIsShareOpen(true)} data-eid={generateClickEID('projects.card.share')}>
              <Box orientation="horizontal" gap="sm">
                <ShareIcon />
                <text.span>{t('builder_social_share')}</text.span>
              </Box>
            </MenuItem>
          )}
          <MenuItem onClick={openRename} data-eid={generateClickEID('projects.card.rename')}>
            <Box orientation="horizontal" gap="sm">
              <EditIcon />
              <text.span>{t('builder_common_rename')}</text.span>
            </Box>
          </MenuItem>
          {showTransfer && (
            <MenuItem
              onClick={handleTransferClick}
              data-eid={generateClickEID('projects.card.transfer')}
            >
              <TransferMenuLabel label={transferLabel} />
            </MenuItem>
          )}
          {!isLogo && isPublished && (
            <MenuItem
              onClick={() => setIsUnpublishOpen(true)}
              data-eid={generateClickEID('projects.card.unpublish')}
            >
              <Box orientation="horizontal" gap="sm">
                <UnlinkIcon />
                <text.span>{t('builder_apps_menu_unpublish')}</text.span>
              </Box>
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem onClick={() => setIsDeleteOpen(true)} data-eid={generateClickEID('projects.card.delete')} data-testid="project-card-delete-button">
            <Box orientation="horizontal" gap="sm">
              <text.span emphasis="critical">
                <TrashIcon />
              </text.span>
              <text.span emphasis="critical">{t('builder_apps_menu_delete')}</text.span>
            </Box>
          </MenuItem>
        </MenuList>
      </Menu>
    </div>
  )

  const mobileActions = (
    <div
      className="flex items-center gap-1"
      onClick={stopActionPropagation}
      onPointerDown={stopActionPropagation}
      onPointerUp={stopActionPropagation}
    >
      <Button
        design="control"
        size="sm"
        icon={<KebabIcon className="size-4" />}
        aria-label={t('builder_apps_menu_actions')}
        data-testid="project-card-menu-button"
        onClick={() => {
          markMenuClosed()
          setIsActionsSheetOpen(true)
        }}
      />
      {actionsSheet}
    </div>
  )

  const cardFooterActions = isMdBreakpoint ? desktopActions : mobileActions

  const modals = (
    <>
      {isRenameOpen && (
        <ProjectsActionModal
          title={t('builder_apps_rename_title')}
          onClose={closeRename}
          testId="project-rename-modal"
          footer={
            <ProjectsActionModalFooter
              onCancel={closeRename}
              cancelText={t('builder_common_cancel')}
              onConfirm={handleRename}
              confirmText={
                isRenamePending
                  ? t('builder_apps_rename_saving')
                  : t('builder_common_rename')
              }
              isLoading={isRenamePending}
              confirmEid={generateClickEID('projects.card.rename_confirm')}
            />
          }
        >
          <TextInput
            id={`project-rename-${site.id}`}
            label={t('builder_apps_rename_label', undefined, 'Project name')}
            value={newName}
            onChange={(value: string) => {
              setNewName(value)
              setRenameError(null)
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' && !isRenamePending) handleRename()
            }}
            errorMessage={renameError || undefined}
            disabled={isRenamePending}
            visualSize="sm"
            multiline={false}
          />
        </ProjectsActionModal>
      )}

      {isShareOpen && (
        <ShareLinkModal site={site} onClose={() => setIsShareOpen(false)} />
      )}

      {isUnpublishOpen && (
        <UnpublishConfirmationModal
          appName={displayName}
          publishedUrl={publishedUrl}
          onClose={() => setIsUnpublishOpen(false)}
          onConfirm={handleUnpublish}
          isLoading={unpublishMutation.isPending}
          error={unpublishMutation.error}
        />
      )}

      {isDeleteOpen && (
        <DeleteProjectConfirmationModal
          projectName={displayName}
          onClose={() => setIsDeleteOpen(false)}
          onConfirm={handleDelete}
          isLoading={deleting}
        />
      )}
    </>
  )

  const updatedLabel = t('builder_projects_updated', { date: formatDate(site.updated_at, true) })
  const formattedUpdatedAt = formatDate(site.updated_at, true)

  const listSelectionCheckbox = onToggleSelect ? (
    <SelectionCheckbox
      checked={selected}
      onChange={() => onToggleSelect(site.id)}
      label={t('builder_projects_select_card')}
      className="shrink-0"
    />
  ) : null

  const listThumbnailSelectionCheckbox = onToggleSelect ? (
    <SelectionCheckbox
      checked={selected}
      onChange={() => onToggleSelect(site.id)}
      label={t('builder_projects_select_card')}
      className={clsx(
        'absolute left-1 top-1 transition-opacity',
        selected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      )}
    />
  ) : null

  const mobileListActions = (
    <div
      className="flex shrink-0 items-center"
      onClick={stopActionPropagation}
      onPointerDown={stopActionPropagation}
      onPointerUp={stopActionPropagation}
    >
      {(selectionActive || selected) && listSelectionCheckbox ? (
        listSelectionCheckbox
      ) : (
        mobileActions
      )}
    </div>
  )

  const listRowProps = {
    role: 'button' as const,
    tabIndex: 0,
    onClick: handleCardClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCardClick()
    },
    'data-testid': 'project-row',
    ...longPressHandlers,
  }

  const listRowClassName = clsx(
    'group relative cursor-pointer transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor',
    selected && 'bg-intents-ux-boxLowContrast-backgroundColor'
  )

  if (view === 'list') {
    return (
      <>
        <div {...listRowProps} className={listRowClassName}>
          {isMdBreakpoint ? (
            <div className="grid grid-cols-[128px_1fr_180px_96px] items-center gap-[12px] rounded-lg">
              <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md">
                <AppThumbnail key={screenshotUrl} {...thumbnailProps} />
                {listThumbnailSelectionCheckbox}
              </div>
              <div className="flex min-w-0 items-center gap-[8px]">
                <span className="truncate font-medium">{displayName}</span>
                {statusTag}
              </div>
              <text.span size={-1} emphasis="passive" className="truncate">
                {formattedUpdatedAt}
              </text.span>
              <div className="flex justify-end">{desktopActions}</div>
            </div>
          ) : (
            <div className="flex items-center gap-[16px] border-b border-intents-ux-borderColor last:border-b-0">
              <AppThumbnail
                key={screenshotUrl}
                {...thumbnailProps}
                size="sm"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {statusTag && <span className="shrink-0 self-start">{statusTag}</span>}
                <div className="truncate font-medium">{displayName}</div>
                <text.span size={-2} emphasis="passive" className="truncate">
                  {formattedUpdatedAt}
                </text.span>
              </div>
              {mobileListActions}
            </div>
          )}
        </div>
        {modals}
      </>
    )
  }

  return (
    <>
      <div className="group flex flex-col gap-2">
        <div
          role="button"
          tabIndex={0}
          onClick={handleCardClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCardClick()
          }}
          data-testid="project-card"
          className={clsx(
            'relative aspect-[5/3] w-full overflow-hidden rounded-xl border bg-intents-ux-boxLowContrast-backgroundColor cursor-pointer transition-all hover:border-ai/50 hover:shadow-sm',
            selected ? 'border-ai' : 'border-intents-ux-borderColor'
          )}
          {...longPressHandlers}
        >
          <AppThumbnail key={screenshotUrl} {...thumbnailProps} />
          {statusTag && (
            <div className="absolute top-2 left-2" data-partial="componentAiro">
              {statusTag}
            </div>
          )}
          {selectionCheckbox}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium">{displayName}</div>
            <text.span size={-2} emphasis="passive">
              {updatedLabel}
            </text.span>
          </div>
          {cardFooterActions}
        </div>
      </div>
      {modals}
    </>
  )
}
