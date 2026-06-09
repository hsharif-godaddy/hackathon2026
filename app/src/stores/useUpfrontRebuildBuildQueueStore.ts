import { create } from 'zustand'

interface UpfrontRebuildQueueEntry {
  planSlugs: string[]
  slugs: string[]
  sawProcessing: boolean
  developCompletedSlugs: string[]
  currentBuildSlug: string | null
}

interface UpfrontRebuildBuildQueueState {
  queues: Record<string, UpfrontRebuildQueueEntry>
  setPlan: (appId: string, planSlugs: string[], autoBuildSlugs: string[]) => void
  /** Legacy fallback when websiteRebuild returns build slugs without upfrontPlanSlugs; setPlan is the primary path. */
  enqueue: (appId: string, slugs: string[]) => void
  markProcessing: (appId: string) => void
  setCurrentBuild: (appId: string, slug: string | null) => void
  markDevelopComplete: (appId: string, slug: string) => void
  peekNext: (appId: string) => string | undefined
  confirmDispatched: (appId: string, slug: string) => void
  rollbackDispatch: (appId: string) => void
  shiftNext: (appId: string) => string | undefined
  clear: (appId: string) => void
  isPlanInProgress: (appId: string) => boolean
}

function createEntry(
  planSlugs: string[],
  autoBuildSlugs: string[],
): UpfrontRebuildQueueEntry {
  return {
    planSlugs: [...planSlugs],
    slugs: [...autoBuildSlugs],
    sawProcessing: false,
    developCompletedSlugs: [],
    currentBuildSlug: null,
  }
}

export const useUpfrontRebuildBuildQueueStore = create<UpfrontRebuildBuildQueueState>((set, get) => ({
  queues: {},
  setPlan(appId, planSlugs, autoBuildSlugs) {
    if (planSlugs.length === 0) return
    if (get().queues[appId]) return
    set(state => ({
      queues: {
        ...state.queues,
        [appId]: createEntry(planSlugs, autoBuildSlugs),
      },
    }))
  },
  enqueue(appId, slugs) {
    if (slugs.length === 0) return
    const homepageSlug = 'homepage'
    set(state => ({
      queues: {
        ...state.queues,
        [appId]: createEntry([homepageSlug, ...slugs], slugs),
      },
    }))
  },
  markProcessing(appId) {
    const entry = get().queues[appId]
    if (!entry || entry.sawProcessing) return
    set(state => ({
      queues: {
        ...state.queues,
        [appId]: { ...entry, sawProcessing: true },
      },
    }))
  },
  setCurrentBuild(appId, slug) {
    const entry = get().queues[appId]
    if (!entry) return
    set(state => ({
      queues: {
        ...state.queues,
        [appId]: { ...entry, currentBuildSlug: slug },
      },
    }))
  },
  markDevelopComplete(appId, slug) {
    const entry = get().queues[appId]
    if (!entry || entry.developCompletedSlugs.includes(slug)) return
    set(state => ({
      queues: {
        ...state.queues,
        [appId]: {
          ...entry,
          developCompletedSlugs: [...entry.developCompletedSlugs, slug],
          currentBuildSlug: entry.currentBuildSlug === slug ? null : entry.currentBuildSlug,
        },
      },
    }))
  },
  peekNext(appId) {
    const entry = get().queues[appId]
    if (!entry || !entry.sawProcessing) return undefined
    const pending = entry.slugs.filter(slug => !entry.developCompletedSlugs.includes(slug))
    return pending[0]
  },
  confirmDispatched(appId, slug) {
    const entry = get().queues[appId]
    if (!entry) return
    set(state => ({
      queues: {
        ...state.queues,
        [appId]: {
          ...entry,
          slugs: entry.slugs.filter(s => s !== slug),
          currentBuildSlug: slug,
        },
      },
    }))
  },
  rollbackDispatch(appId) {
    const entry = get().queues[appId]
    if (!entry || !entry.currentBuildSlug) return
    set(state => ({
      queues: {
        ...state.queues,
        [appId]: { ...entry, currentBuildSlug: null },
      },
    }))
  },
  shiftNext(appId) {
    const next = get().peekNext(appId)
    if (!next) return undefined
    get().confirmDispatched(appId, next)
    return next
  },
  clear(appId) {
    set(state => {
      if (!(appId in state.queues)) return state
      const { [appId]: _removed, ...remaining } = state.queues
      return { queues: remaining }
    })
  },
  isPlanInProgress(appId) {
    const entry = get().queues[appId]
    if (!entry || entry.planSlugs.length === 0) return false
    return entry.developCompletedSlugs.length < entry.planSlugs.length
  },
}))
