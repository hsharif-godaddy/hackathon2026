import { useCallback, useMemo } from 'react'
import { FullStory } from '@fullstory/browser'

const IDLE_THRESHOLD_MS = 30_000
const ACTIVITY_THROTTLE_MS = 1_000
const SCROLL_THROTTLE_MS = 200
const SLOW_RESPONSE_THRESHOLD_MS = 15_000
const STALE_PROMPT_THRESHOLD_MS = 5 * 60_000

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  'mousedown',
  'keydown',
  'touchstart',
  'mousemove',
]

interface PromptEntry {
  startedAt: number
  promptLength: number
  page: string
}

function track(name: string, properties: Record<string, unknown>): void {
  try {
    const instance = JourneyTracker.current()
    const context: Record<string, unknown> = {}
    if (instance?.getCustomerId()) context.customerId = instance.getCustomerId()
    if (instance?.getAppId()) context.appId = instance.getAppId()
    FullStory('trackEvent', { name, properties: { ...context, ...properties } })
  } catch {
    // FullStory may not be initialized (e.g. localhost)
  }
}

export class JourneyTracker {
  private static instance: JourneyTracker | null = null

  private customerId?: string
  private appId?: string
  private sessionStartedAt: number

  private activeTimeMs = 0
  private idleTimeMs = 0
  private isActive = true
  private lastTickAt: number
  private lastActivityAt = 0

  private currentPage = ''
  private pageActiveTimeMs = 0
  private pageIdleTimeMs = 0
  private scrollDepthPercent = 0
  private interactionCount = 0

  private prompts = new Map<string, PromptEntry>()
  private firstPromptRecorded = false
  private firstResponseRecorded = false

  private lastMilestoneAt: number
  private timers = new Map<string, number>()

  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private lastScrollAt = 0
  private destroyed = false

  private boundHandleActivity: () => void
  private boundHandleVisibility: () => void
  private boundHandlePageHide: () => void
  private boundHandleScroll: () => void

  private constructor(config: { customerId?: string; appId?: string }) {
    this.customerId = config.customerId
    this.appId = config.appId
    this.sessionStartedAt = performance.now()
    this.lastTickAt = this.sessionStartedAt
    this.lastMilestoneAt = this.sessionStartedAt

    this.boundHandleActivity = this.handleActivity.bind(this)
    this.boundHandleVisibility = this.handleVisibility.bind(this)
    this.boundHandlePageHide = this.handlePageHide.bind(this)
    this.boundHandleScroll = this.handleScroll.bind(this)

    this.attach()
    this.scheduleIdle()
  }

  // -- Static API --

  static start(config: { customerId?: string; appId?: string } = {}): JourneyTracker {
    if (JourneyTracker.instance) {
      JourneyTracker.instance.destroy()
    }
    JourneyTracker.instance = new JourneyTracker(config)
    return JourneyTracker.instance
  }

  static stop(): void {
    JourneyTracker.instance?.destroy()
    JourneyTracker.instance = null
  }

  static current(): JourneyTracker | null {
    return JourneyTracker.instance
  }

  static setCustomerId(id: string): void {
    if (JourneyTracker.instance) {
      JourneyTracker.instance.customerId = id
    }
  }

  static setAppId(id: string): void {
    if (JourneyTracker.instance) {
      JourneyTracker.instance.appId = id
    }
  }

  getCustomerId(): string | undefined {
    return this.customerId
  }

  getAppId(): string | undefined {
    return this.appId
  }

  // -- Page tracking --

  setPage(page: string): void {
    if (page === this.currentPage) return
    this.flushPageEngagement()
    this.currentPage = page
    this.pageActiveTimeMs = 0
    this.pageIdleTimeMs = 0
    this.scrollDepthPercent = 0
    this.interactionCount = 0
  }

  // -- Prompt tracking --

  trackPromptStarted(promptId: string, promptText?: string): void {
    this.pruneStalePrompts()
    this.prompts.set(promptId, {
      startedAt: performance.now(),
      promptLength: promptText?.length ?? 0,
      page: this.currentPage,
    })

    track('Prompt Started', {
      promptId,
      promptLength: promptText?.length ?? 0,
      page: this.currentPage,
    })

    if (!this.firstPromptRecorded) {
      this.firstPromptRecorded = true
      track('First Prompt Submitted', {
        timeToFirstPromptMs: Math.round(performance.now() - this.sessionStartedAt),
        promptLength: promptText?.length ?? 0,
        page: this.currentPage,
      })
    }
  }

  trackPromptCompleted(promptId: string, meta?: {
    success?: boolean
    responseTokens?: number
    errorType?: string
  }): void {
    const entry = this.prompts.get(promptId)
    if (!entry) return
    this.prompts.delete(promptId)

    const waitTimeMs = Math.round(performance.now() - entry.startedAt)

    track('Agent Response Received', {
      promptId,
      waitTimeMs,
      success: meta?.success ?? true,
      page: entry.page,
      ...(meta?.responseTokens !== undefined ? { responseTokens: meta.responseTokens } : {}),
      ...(meta?.errorType ? { errorType: meta.errorType } : {}),
    })

    if (!this.firstResponseRecorded && (meta?.success ?? true)) {
      this.firstResponseRecorded = true
      track('First Agent Response Received', {
        timeToFirstResponseMs: Math.round(performance.now() - this.sessionStartedAt),
        waitTimeMs,
        page: entry.page,
      })
    }

    if (waitTimeMs > SLOW_RESPONSE_THRESHOLD_MS) {
      track('Slow Agent Response', {
        promptId,
        waitTimeMs,
        page: entry.page,
      })
    }
  }

  /**
   * Complete the most recently started prompt.
   * Used by handlers that don't have the original promptId.
   */
  completeActivePrompt(meta?: {
    success?: boolean
    responseTokens?: number
    errorType?: string
  }): void {
    let lastId: string | undefined
    for (const id of this.prompts.keys()) {
      lastId = id
    }
    if (lastId) {
      this.trackPromptCompleted(lastId, meta)
    }
  }

  // -- Milestone tracking --

  trackMilestone(name: string, metadata?: Record<string, unknown>): void {
    const now = performance.now()
    track('Journey Milestone', {
      milestone: name,
      timeFromSessionStartMs: Math.round(now - this.sessionStartedAt),
      timeFromLastMilestoneMs: Math.round(now - this.lastMilestoneAt),
      ...(metadata ?? {}),
    })
    this.lastMilestoneAt = now
  }

  // -- Custom timers --

  startTimer(name: string): void {
    this.timers.set(name, performance.now())
  }

  endTimer(name: string, eventName: string, metadata?: Record<string, unknown>): void {
    const startedAt = this.timers.get(name)
    if (startedAt === undefined) return
    this.timers.delete(name)

    track(eventName, {
      durationMs: Math.round(performance.now() - startedAt),
      ...(metadata ?? {}),
    })
  }

  // -- Private --

  private pruneStalePrompts(): void {
    const now = performance.now()
    for (const [id, entry] of this.prompts) {
      if (now - entry.startedAt > STALE_PROMPT_THRESHOLD_MS) {
        this.prompts.delete(id)
      }
    }
  }

  private tick(): void {
    const now = performance.now()
    const elapsed = now - this.lastTickAt
    this.lastTickAt = now

    if (this.isActive) {
      this.activeTimeMs += elapsed
      this.pageActiveTimeMs += elapsed
    } else {
      this.idleTimeMs += elapsed
      this.pageIdleTimeMs += elapsed
    }
  }

  private flushPageEngagement(): void {
    this.tick()
    if (!this.currentPage) return
    if (this.pageActiveTimeMs === 0 && this.pageIdleTimeMs === 0) return

    track('Page Engagement', {
      page: this.currentPage,
      activeTimeMs: Math.round(this.pageActiveTimeMs),
      idleTimeMs: Math.round(this.pageIdleTimeMs),
      scrollDepthPercent: this.scrollDepthPercent,
      interactionCount: this.interactionCount,
    })
  }

  private handleActivity(): void {
    const now = performance.now()
    if (now - this.lastActivityAt < ACTIVITY_THROTTLE_MS) return
    this.lastActivityAt = now
    this.interactionCount++

    if (!this.isActive) {
      this.tick()
      this.isActive = true
    }
    this.scheduleIdle()
  }

  // Tracks document-root scroll only. Pages that scroll inside a nested
  // container (e.g. /develop/* chat pane) will report 0% depth here.
  private handleScroll(): void {
    const now = performance.now()
    if (now - this.lastScrollAt < SCROLL_THROTTLE_MS) return
    this.lastScrollAt = now

    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop
    const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight
    if (scrollHeight > 0) {
      const depth = Math.round((scrollTop / scrollHeight) * 100)
      if (depth > this.scrollDepthPercent) {
        this.scrollDepthPercent = depth
      }
    }

    if (!this.isActive) {
      this.tick()
      this.isActive = true
    }
    this.scheduleIdle()
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.tick()
      this.isActive = false
    }, IDLE_THRESHOLD_MS)
  }

  private handleVisibility(): void {
    if (document.visibilityState === 'hidden') {
      this.tick()
      this.isActive = false
      if (this.idleTimer) clearTimeout(this.idleTimer)
    } else {
      this.tick()
      this.isActive = true
      this.scheduleIdle()
    }
  }

  private handlePageHide(): void {
    this.flushPageEngagement()
  }

  private attach(): void {
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, this.boundHandleActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', this.boundHandleVisibility)
    window.addEventListener('pagehide', this.boundHandlePageHide)
    window.addEventListener('scroll', this.boundHandleScroll, { passive: true })
  }

  private detach(): void {
    for (const evt of ACTIVITY_EVENTS) {
      document.removeEventListener(evt, this.boundHandleActivity)
    }
    document.removeEventListener('visibilitychange', this.boundHandleVisibility)
    window.removeEventListener('pagehide', this.boundHandlePageHide)
    window.removeEventListener('scroll', this.boundHandleScroll)
  }

  private destroy(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.detach()
    if (!this.destroyed) {
      this.flushPageEngagement()
    }
    this.destroyed = true
  }
}

// -- Hooks --

export function useAgentTracking() {
  return useMemo(() => ({
    trackPromptStart(promptId: string, promptText?: string) {
      JourneyTracker.current()?.trackPromptStarted(promptId, promptText)
    },
    trackPromptComplete(promptId: string, meta?: {
      success?: boolean
      responseTokens?: number
      errorType?: string
    }) {
      JourneyTracker.current()?.trackPromptCompleted(promptId, meta)
    },
  }), [])
}

export function useTimedOperation() {
  return useMemo(() => ({
    start(name: string) {
      JourneyTracker.current()?.startTimer(name)
    },
    end(name: string, eventName: string, metadata?: Record<string, unknown>) {
      JourneyTracker.current()?.endTimer(name, eventName, metadata)
    },
  }), [])
}

export function useMilestoneTracking() {
  return useCallback(function trackMilestone(name: string, metadata?: Record<string, unknown>) {
    JourneyTracker.current()?.trackMilestone(name, metadata)
  }, [])
}
