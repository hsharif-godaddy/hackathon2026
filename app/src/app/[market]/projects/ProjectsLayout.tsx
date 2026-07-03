'use client'

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import LinkIcon from '@ux/icon/link'
import PlusIcon from '@ux/icon/plus'
import { Menu, MenuButton, MenuItem, MenuList } from '@ux/menu'
import text from '@ux/text'

import AcceptTransferDialog from '@/app/[market]/apps/components/AcceptTransferDialog'
import TransferInitiateDialog from '@/app/[market]/apps/components/TransferInitiateDialog'
import { KebabIcon } from '@/app/[market]/projects/components/icons'
import ProjectCardActionsSheet from '@/app/[market]/projects/components/ProjectCardActionsSheet'
import ProjectsListSection from '@/app/[market]/projects/components/ProjectsListSection'
import { useProjectsView } from '@/app/[market]/projects/lib/useProjectsView'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'
import { SiteInfo } from '@/lib/control-plane/types'
import { generateClickEID } from '@/utils/instrumentation'

interface ProjectsLayoutProps {
  sites: SiteInfo[]
  transferAllowed?: boolean
  showTransfer?: boolean
  onCreateProject?: () => void
}

export default function ProjectsLayout({ sites, transferAllowed = false, showTransfer = false, onCreateProject }: ProjectsLayoutProps) {
  const t = useTranslations()
  const viewState = useProjectsView({ sites })
  const [transferTarget, setTransferTarget] = useState<SiteInfo | null>(null)
  const [isAcceptOpen, setIsAcceptOpen] = useState(false)
  const [isHeaderActionsSheetOpen, setIsHeaderActionsSheetOpen] = useState(false)
  const [isSelectionActive, setIsSelectionActive] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const { isMdBreakpoint } = useBreakpoints()
  // `showTransfer` (menu visibility) and `transferAllowed` (initiation eligibility)
  // are always equal today, but every transfer-related gate below derives from
  // this combined flag so a future show-but-not-allowed combo can't leave the
  // "Transfer" menu item visible while the dialog silently refuses to open.
  const shouldShowTransferMenu = showTransfer || transferAllowed

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const hideMobileStickyFooter =
    isAcceptOpen ||
    isSelectionActive ||
    (shouldShowTransferMenu && transferTarget !== null)

  const headerSheetActions = [
    {
      id: 'accept-transfer',
      label: t('builder_transfer_accept_title'),
      icon: <LinkIcon />,
      onClick: () => {
        setIsHeaderActionsSheetOpen(false)
        setIsAcceptOpen(true)
      },
    },
  ]

  const showMobileStickyFooter = !isMdBreakpoint && !hideMobileStickyFooter

  return (
    <main
      className={clsx(
        'mx-auto w-full max-w-[1440px] px-[16px] pt-4 sm:px-6 lg:px-10',
        showMobileStickyFooter ? 'pb-32' : 'pb-24',
        'md:pb-24'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <text.h2 as="title" size={3} data-testid="projects-page-title">
            {t('builder_common_projects')}{' '}
            <span className="font-normal text-[18px] text-intents-ux-text-textSecondaryColor">({sites.length})</span>
          </text.h2>
          <text.p size={-1} emphasis="passive">
            {t('builder_apps_title')}
          </text.p>
        </div>
        {isMdBreakpoint && (
          <div className="flex shrink-0 items-center gap-2">
            <div data-partial="componentAiro">
              <Button
                design="primary"
                size="sm"
                icon={<PlusIcon />}
                onClick={onCreateProject}
                data-testid="create-project-button"
                data-eid={generateClickEID('projects.header.new_project')}
                text={t('builder_apps_create_project')}
              />
            </div>
            <Menu id="projects-header-menu" size="sm" closeOnSelect>
              <MenuButton
                design="control"
                size="sm"
                icon={<KebabIcon className="size-4" />}
                aria-label={t('builder_apps_menu_actions')}
                data-testid="projects-header-menu-button"
              />
              <MenuList stretch placement="bottom-end" flip>
                <MenuItem
                  onClick={() => setIsAcceptOpen(true)}
                  data-eid={generateClickEID('projects.header.accept_transfer')}
                >
                  {t('builder_transfer_accept_title')}
                </MenuItem>
              </MenuList>
            </Menu>
          </div>
        )}
      </div>

      {showMobileStickyFooter && isMounted && createPortal(
        <div className="fixed inset-x-0 bottom-0 flex items-center gap-2 border-t border-intents-ux-borderColor bg-intents-ux-box-backgroundColor p-2">
          <div className="shrink-0">
            <Button
              design="control"
              size="sm"
              icon={<KebabIcon className="size-4" />}
              aria-label={t('builder_apps_menu_actions')}
              data-testid="projects-header-menu-button"
              onClick={() => setIsHeaderActionsSheetOpen(true)}
            />
          </div>
          <div className="min-w-0 flex-1" data-partial="componentAiro">
            <Button
              design="primary"
              size="sm"
              icon={<PlusIcon />}
              onClick={onCreateProject}
              data-testid="create-project-button"
              data-eid={generateClickEID('projects.header.new_project')}
              text={t('builder_apps_create_project')}
              className="w-full"
            />
          </div>
        </div>,
        document.body
      )}

      <ProjectsListSection
        viewState={viewState}
        gridClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        showTabs={false}
        showTransfer={showTransfer}
        onTransfer={setTransferTarget}
        onSelectionActiveChange={setIsSelectionActive}
      />

      {shouldShowTransferMenu && transferTarget && (
        <TransferInitiateDialog
          appId={transferTarget.id}
          appName={transferTarget.name || t('builder_apps_alert_delete_untitled', undefined, 'Untitled')}
          onClose={() => setTransferTarget(null)}
          onTransferCreated={() => setTransferTarget(null)}
        />
      )}

      {!isMdBreakpoint && (
        <ProjectCardActionsSheet
          open={isHeaderActionsSheetOpen}
          onOpenChange={setIsHeaderActionsSheetOpen}
          title={t('builder_apps_menu_actions')}
          actions={headerSheetActions}
        />
      )}

      {isAcceptOpen && <AcceptTransferDialog onClose={() => setIsAcceptOpen(false)} />}
    </main>
  )
}
