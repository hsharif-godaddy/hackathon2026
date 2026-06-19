'use client'

import { useMemo, useState } from 'react'

import type {
  ProjectTab,
  SortKey,
  ViewMode,
} from '@/app/[market]/projects/constants'
import { getProjectType } from '@/app/[market]/projects/lib/projectType'
import { SiteInfo } from '@/lib/control-plane/types'

interface UseProjectsViewArgs {
  sites: SiteInfo[]
  defaultView?: ViewMode
}

export interface ProjectsViewState {
  tab: ProjectTab
  setTab: (tab: ProjectTab) => void
  search: string
  setSearch: (value: string) => void
  sort: SortKey
  setSort: (sort: SortKey) => void
  view: ViewMode
  setView: (view: ViewMode) => void
  /** Sites after tab + search filters and sorting. */
  filteredSites: SiteInfo[]
  /** Count per tab (respects search, ignores tab itself). */
  tabCounts: Record<ProjectTab, number>
}

function sortSites(sites: SiteInfo[], sort: SortKey): SiteInfo[] {
  const next = [...sites]
  switch (sort) {
    case 'created':
      return next.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    case 'name':
      return next.sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      )
    case 'updated':
    default:
      return next.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
  }
}

function matchesSearch(site: SiteInfo, query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  return (site.name ?? '').toLowerCase().includes(trimmed.toLowerCase())
}

function matchesTab(site: SiteInfo, tab: ProjectTab): boolean {
  if (tab === 'all') return true
  return getProjectType(site) === tab
}

export function useProjectsView({
  sites,
  defaultView = 'grid',
}: UseProjectsViewArgs): ProjectsViewState {
  const [tab, setTab] = useState<ProjectTab>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<ViewMode>(defaultView)

  const base = useMemo(
    () => sites.filter((site) => matchesSearch(site, search)),
    [sites, search]
  )

  const tabCounts = useMemo<Record<ProjectTab, number>>(
    () => ({
      all: base.length,
      website: base.filter((s) => getProjectType(s) === 'website').length,
      logo: base.filter((s) => getProjectType(s) === 'logo').length,
    }),
    [base]
  )

  const filteredSites = useMemo(
    () => sortSites(base.filter((site) => matchesTab(site, tab)), sort),
    [base, tab, sort]
  )

  return {
    tab,
    setTab,
    search,
    setSearch,
    sort,
    setSort,
    view,
    setView,
    filteredSites,
    tabCounts,
  }
}
