'use client'

import clsx from 'clsx'

import FilterDropdown from '@/app/[market]/projects/components/FilterDropdown'
import {
  ClearIcon,
  GridViewIcon,
  ListViewIcon,
  SearchIcon,
} from '@/app/[market]/projects/components/icons'
import type {
  SortKey,
  ViewMode,
} from '@/app/[market]/projects/constants'
import { SORT_OPTIONS } from '@/app/[market]/projects/constants'
import { useTranslations } from '@/hooks/useTranslations'

type ProjectsToolbarSection = 'all' | 'search' | 'controls'

interface ProjectsToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  sort: SortKey
  onSortChange: (value: SortKey) => void
  view: ViewMode
  onViewChange: (value: ViewMode) => void
  /** Render only the search row, controls row, or both (default). */
  section?: ProjectsToolbarSection
}

export default function ProjectsToolbar({
  search,
  onSearchChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  section = 'all',
}: ProjectsToolbarProps) {
  const t = useTranslations()

  const sortOptions = SORT_OPTIONS.map((o) => ({ id: o.id, label: t(o.labelKey, undefined, o.fallback) }))

  const searchPlaceholder = t('builder_projects_search_placeholder')
  const showSearch = section === 'all' || section === 'search'
  const showControls = section === 'all' || section === 'controls'

  const searchRow = (
    <div className="flex h-[40px] w-full shrink-0 items-center justify-between gap-2 rounded-[10px] border border-[rgba(118,118,118,0.40)] bg-intents-ux-control-backgroundColor px-[16px] transition-colors hover:border-[rgba(118,118,118,0.70)] hover:bg-intents-ux-boxLowContrast-backgroundColor focus-within:border-[rgba(118,118,118,0.90)] focus-within:bg-intents-ux-control-backgroundColor md:w-[232px]">
      <input
        id="projects-search"
        type="text"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-intents-ux-control-foregroundColor outline-none placeholder:text-intents-ux-controlVoid-foregroundColor"
      />
      {search ? (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          aria-label={t('builder_common_clear', undefined, 'Clear')}
          className="shrink-0 text-intents-ux-control-foregroundColor opacity-60 transition-opacity hover:opacity-100"
        >
          <ClearIcon className="size-[20px]" />
        </button>
      ) : (
        <SearchIcon className="size-[20px] shrink-0 text-intents-ux-control-foregroundColor opacity-60" />
      )}
    </div>
  )

  const filters = (
    <div className="flex items-center gap-2">
      <FilterDropdown
        id="projects-sort"
        value={sort}
        options={sortOptions}
        onChange={onSortChange}
        ariaLabel={t('builder_projects_sort_aria')}
      />
    </div>
  )

  const viewToggle = (
    <div
      className="flex shrink-0 items-center gap-1 rounded-[12px] bg-intents-ux-boxLowContrast-backgroundColor p-[4px]"
      role="group"
      aria-label={t('builder_projects_view_aria')}
    >
      <ViewToggleButton
        active={view === 'grid'}
        onClick={() => onViewChange('grid')}
        label={t('builder_projects_view_grid')}
        icon={<GridViewIcon className="size-[20px]" />}
        testId="projects-view-grid"
      />
      <ViewToggleButton
        active={view === 'list'}
        onClick={() => onViewChange('list')}
        label={t('builder_projects_view_list')}
        icon={<ListViewIcon className="size-[20px]" />}
        testId="projects-view-list"
      />
    </div>
  )

  const controlsRow = (
    <div className="flex items-center justify-between gap-2">
      {filters}
      {viewToggle}
    </div>
  )

  const desktopControlsRow = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
      {filters}
      {viewToggle}
    </div>
  )

  if (section === 'search') {
    return searchRow
  }

  if (section === 'controls') {
    return controlsRow
  }

  return (
    <div className="flex w-full flex-col gap-2 md:h-[40px] md:flex-row md:items-center md:gap-2">
      {showSearch && searchRow}
      {showControls && desktopControlsRow}
    </div>
  )
}

function ViewToggleButton({
  active,
  onClick,
  label,
  icon,
  testId,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={clsx(
        'flex size-[32px] items-center justify-center rounded-[8px] border transition-colors',
        active
          ? 'border-intents-ux-action-borderColor bg-intents-ux-box-backgroundColor text-intents-ux-box-foregroundColor'
          : 'border-transparent text-intents-ux-control-foregroundColor opacity-70 hover:opacity-100'
      )}
    >
      {icon}
    </button>
  )
}
