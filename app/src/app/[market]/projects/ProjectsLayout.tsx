'use client'

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import ArrowRightIcon from '@ux/icon/arrow-right'
import PlusIcon from '@ux/icon/plus'
import text from '@ux/text'

import AcceptTransferDialog from '@/app/[market]/apps/components/AcceptTransferDialog'
import TransferInitiateDialog from '@/app/[market]/apps/components/TransferInitiateDialog'
import ProjectsListSection from '@/app/[market]/projects/components/ProjectsListSection'
import { useProjectsView } from '@/app/[market]/projects/lib/useProjectsView'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useTranslations } from '@/hooks/useTranslations'
import { SiteInfo } from '@/lib/control-plane/types'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { usePaywallStore } from '@/stores/usePaywallStore'
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
  const [isSelectionActive, setIsSelectionActive] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const isMobile = useIsMobile()
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)
  const shouldShowTransferMenu = showTransfer || transferAllowed
  const transferNeedsUpgrade = showTransfer && !transferAllowed

  const handleTransfer = (site: SiteInfo): void => {
    if (!transferAllowed) {
      openUpgradeModal('transfer.upgrade', PAYWALL_ITC.UPGRADE)
    } else {
      setTransferTarget(site)
    }
  }

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const hideMobileStickyFooter =
    isAcceptOpen ||
    isSelectionActive ||
    (shouldShowTransferMenu && transferTarget !== null)

  const showMobileStickyFooter = isMobile && !hideMobileStickyFooter

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
        {!isMobile && (
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
            <Button
              design="secondary"
              size="sm"
              icon={<ArrowRightIcon className="rtl:scale-x-[-1]" />}
              onClick={() => setIsAcceptOpen(true)}
              data-testid="transfer-app-card"
              data-eid={generateClickEID('projects.header.accept_transfer')}
              text={t('builder_transfer_accept_button')}
            />
          </div>
        )}
      </div>

      {showMobileStickyFooter && isMounted && createPortal(
        <div className="fixed inset-x-0 bottom-0 flex flex-col gap-2 border-t border-intents-ux-borderColor bg-intents-ux-box-backgroundColor p-2">
          <Button
            design="secondary"
            size="sm"
            icon={<ArrowRightIcon className="rtl:scale-x-[-1]" />}
            onClick={() => setIsAcceptOpen(true)}
            data-testid="transfer-app-card"
            data-eid={generateClickEID('projects.header.accept_transfer')}
            text={t('builder_transfer_accept_button')}
            className="w-full"
          />
          <div data-partial="componentAiro">
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
        transferNeedsUpgrade={transferNeedsUpgrade}
        onTransfer={handleTransfer}
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

      {isAcceptOpen && <AcceptTransferDialog onClose={() => setIsAcceptOpen(false)} />}
    </main>
  )
}
