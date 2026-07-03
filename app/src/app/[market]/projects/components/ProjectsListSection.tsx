'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@ux/button'
import Growl from '@ux/growl'
import TrashIcon from '@ux/icon/trash'
import Pagination from '@ux/pagination'
import text from '@ux/text'

import BulkDeleteConfirmationModal from '@/app/[market]/projects/components/BulkDeleteConfirmationModal'
import ProjectCard from '@/app/[market]/projects/components/ProjectCard'
import ProjectsStickyToolbar from '@/app/[market]/projects/components/ProjectsStickyToolbar'
import ProjectsTabs from '@/app/[market]/projects/components/ProjectsTabs'
import ProjectsToolbar from '@/app/[market]/projects/components/ProjectsToolbar'
import { PROJECTS_GRID_PAGE_SIZE } from '@/app/[market]/projects/constants'
import type { ProjectsViewState } from '@/app/[market]/projects/lib/useProjectsView'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useTranslations } from '@/hooks/useTranslations'
import { SiteInfo } from '@/lib/control-plane/types'
import { useSitesStore } from '@/stores/useSitesStore'
import { generateClickEID } from '@/utils/instrumentation'

interface ProjectsListSectionProps {
  viewState: ProjectsViewState
  gridClassName: string
  showTabs?: boolean
  showTransfer?: boolean
  onTransfer?: (site: SiteInfo) => void
  onSelectionActiveChange?: (active: boolean) => void
}

export default function ProjectsListSection({
  viewState,
  gridClassName,
  showTabs = true,
  showTransfer = false,
  onTransfer,
  onSelectionActiveChange,
}: ProjectsListSectionProps) {
  const t = useTranslations()
  const isMobile = useIsMobile()
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)
  const deleteSite = useSitesStore((state) => state.deleteSite)

  const {
    tab,
    setTab,
    tabCounts,
    search,
    setSearch,
    sort,
    setSort,
    view,
    setView,
    filteredSites,
  } = viewState

  const total = filteredSites.length
  const totalPages = Math.max(1, Math.ceil(total / PROJECTS_GRID_PAGE_SIZE))

  const syncSelectionActive = useCallback(
    (ids: Set<string>) => {
      onSelectionActiveChange?.(ids.size > 0)
    },
    [onSelectionActiveChange]
  )

  // Reset to first page and clear selection whenever the active filter set changes.
  useEffect(() => {
    setPage(1)
    setSelectedIds(new Set())
    syncSelectionActive(new Set())
  }, [tab, search, sort, syncSelectionActive])

  const toggleSelect = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        syncSelectionActive(next)
        return next
      })
    },
    [syncSelectionActive]
  )

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    syncSelectionActive(new Set())
  }, [syncSelectionActive])

  const selectionActive = selectedIds.size > 0

  const untitled = t('builder_apps_alert_delete_untitled', undefined, 'Untitled')
  const selectedNames = useMemo(
    () =>
      filteredSites
        .filter((site) => selectedIds.has(site.id))
        .map((site) => site.name || untitled),
    [filteredSites, selectedIds, untitled]
  )

  const handleBulkDelete = useCallback(async () => {
    setIsBulkDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      const results: boolean[] = []
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10)
        results.push(...await Promise.all(batch.map((id) => deleteSite(id))))
      }
      const failedIds = new Set(ids.filter((_, i) => !results[i]))
      setIsBulkDeleteOpen(false)
      if (failedIds.size === 0) {
        setSelectedIds(new Set())
        syncSelectionActive(new Set())
        Growl.addGrowlMessage({
          id: 'projects-bulk-delete-success',
          title: t('builder_projects_delete_success'),
          emphasis: 'success',
          lifetime: 4000,
        })
      } else {
        setSelectedIds(failedIds)
        syncSelectionActive(failedIds)
        Growl.addGrowlMessage({
          id: 'projects-bulk-delete-error',
          title: t('builder_projects_bulk_delete_error'),
          emphasis: 'critical',
          lifetime: 4000,
        })
      }
    } finally {
      setIsBulkDeleting(false)
    }
  }, [selectedIds, deleteSite, syncSelectionActive, t])

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])

  const paginated = useMemo(
    () => filteredSites.slice((page - 1) * PROJECTS_GRID_PAGE_SIZE, page * PROJECTS_GRID_PAGE_SIZE),
    [filteredSites, page]
  )

  return (
    <div className="flex flex-col gap-4">
      {showTabs && <ProjectsTabs active={tab} counts={tabCounts} onChange={setTab} />}

      {!isMobile ? (
        <ProjectsStickyToolbar>
          <ProjectsToolbar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
          />
        </ProjectsStickyToolbar>
      ) : (
        <div className="flex flex-col gap-[12px]">
          <ProjectsStickyToolbar>
            <ProjectsToolbar
              search={search}
              onSearchChange={setSearch}
              sort={sort}
              onSortChange={setSort}
              view={view}
              onViewChange={setView}
              section="search"
            />
          </ProjectsStickyToolbar>
          <ProjectsToolbar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
            section="controls"
          />
        </div>
      )}

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-intents-ux-boxLowContrast-backgroundColor py-16">
          <text.p size={0} emphasis="passive">
            {search
              ? t('builder_projects_empty_search')
              : t('builder_apps_empty_state')}
          </text.p>
        </div>
      ) : view === 'list' ? (
        <div className="flex flex-col gap-[16px] md:gap-2">
          <div className="hidden md:grid grid-cols-[128px_1fr_180px_96px] items-center gap-[12px] border-b border-intents-ux-borderColor pb-2">
            <div />
            <text.span size={-2} emphasis="passive" className="font-medium">
              {t('builder_projects_col_name')}
            </text.span>
            <text.span size={-2} emphasis="passive" className="font-medium">
              {t('builder_projects_col_updated')}
            </text.span>
            <div />
          </div>
          {paginated.map((site) => (
            <ProjectCard
              key={site.id}
              site={site}
              view="list"
              showTransfer={showTransfer}
              onTransfer={onTransfer}
              selected={selectedIds.has(site.id)}
              selectionActive={selectionActive}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      ) : (
        <div className={clsx('grid gap-3 md:gap-6', gridClassName)}>
          {paginated.map((site) => (
            <ProjectCard
              key={site.id}
              site={site}
              view="grid"
              showTransfer={showTransfer}
              onTransfer={onTransfer}
              selected={selectedIds.has(site.id)}
              selectionActive={selectionActive}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {total > PROJECTS_GRID_PAGE_SIZE && (
        <div className="flex justify-center pt-2">
          <Pagination
            limit={PROJECTS_GRID_PAGE_SIZE}
            offset={(page - 1) * PROJECTS_GRID_PAGE_SIZE}
            total={total}
            onChange={(offset: number) =>
              setPage(Math.max(1, Math.min(Math.floor(offset / PROJECTS_GRID_PAGE_SIZE) + 1, totalPages)))
            }
            atStart={page === 1}
            atEnd={page === totalPages}
          />
        </div>
      )}

      {selectionActive && (
        <div
          className="fixed inset-x-0 bottom-4 z-0 flex px-[16px] md:bottom-6 md:justify-center md:px-4"
          data-partial="componentAiro"
        >
          <div className="flex w-full items-center justify-between gap-4 rounded-[16px] border border-intents-ux-borderColor bg-intents-ux-box-backgroundColor p-[12px] shadow-lg md:w-auto md:justify-start">
            <text.span size={-1} className="shrink-0 font-medium">
              {t('builder_projects_selected_count', { count: selectedIds.size })}
            </text.span>
            <div className="flex shrink-0 items-center gap-2 [&_.ux-button]:!p-[8px]">
              <Button
                design="critical"
                size="sm"
                icon={<TrashIcon />}
                onClick={() => setIsBulkDeleteOpen(true)}
                disabled={isBulkDeleting}
                data-testid="projects-bulk-delete"
                data-eid={generateClickEID('projects.selection.delete')}
                text={t('builder_common_delete')}
              />
              <Button
                design="secondary"
                size="sm"
                onClick={clearSelection}
                disabled={isBulkDeleting}
                data-testid="projects-bulk-cancel"
                data-eid={generateClickEID('projects.selection.cancel')}
                text={t('builder_common_cancel')}
              />
            </div>
          </div>
        </div>
      )}

      {isBulkDeleteOpen && (
        <BulkDeleteConfirmationModal
          projectNames={selectedNames}
          onClose={() => setIsBulkDeleteOpen(false)}
          onConfirm={handleBulkDelete}
          isLoading={isBulkDeleting}
        />
      )}

      <Growl />
    </div>
  )
}
