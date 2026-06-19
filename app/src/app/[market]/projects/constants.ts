/**
 * Projects page constants.
 */

/** Grid page size for the Projects grid. */
export const PROJECTS_GRID_PAGE_SIZE = 12

/** Project-type tabs shown above the grid. */
export type ProjectTab = 'all' | 'website' | 'logo'

/** Sort options surfaced in the "Last edited" dropdown. */
export type SortKey = 'updated' | 'created' | 'name'

export type ViewMode = 'grid' | 'list'

export const SORT_OPTIONS: { id: SortKey; labelKey: string; fallback: string }[] = [
  { id: 'updated', labelKey: 'builder_projects_sort_updated', fallback: 'Last edited' },
  { id: 'created', labelKey: 'builder_projects_sort_created', fallback: 'Date created' },
  { id: 'name', labelKey: 'builder_projects_sort_name', fallback: 'Name (A–Z)' },
]
