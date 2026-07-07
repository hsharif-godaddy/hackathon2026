// Wrapped IDs stay stable across pause/resume so customer code's clearInterval
// keeps working — we replace only the underlying real timer, not the visible id.

const CAROUSEL_DELAY_MIN_MS = 1000
const CAROUSEL_DELAY_MAX_MS = 10_000

type TimerKind = "interval" | "timeout"

type TimerEntry = {
  kind: TimerKind
  handler: TimerHandler
  delay: number
  args: unknown[]
  realId: number | null
}

type GlobalScope = typeof globalThis & {
  __airoTimerPauseInstalled?: boolean
}

const scope: GlobalScope = globalThis as GlobalScope

let nextWrappedId: number = 0x70000000
const allTimers: Map<number, TimerEntry> = new Map()
let carouselTimersPaused: boolean = false

let realSetInterval: typeof window.setInterval
let realClearInterval: typeof window.clearInterval
let realSetTimeout: typeof window.setTimeout
let realClearTimeout: typeof window.clearTimeout

function isCarouselDelay(delay: number): boolean {
  return delay >= CAROUSEL_DELAY_MIN_MS && delay <= CAROUSEL_DELAY_MAX_MS
}

function startReal(entry: TimerEntry, wrappedId: number): void {
  const handler: TimerHandler = entry.handler
  if (entry.kind === "interval") {
    entry.realId = realSetInterval(handler, entry.delay, ...entry.args) as unknown as number
    return
  }
  entry.realId = realSetTimeout((...rest: unknown[]) => {
    allTimers.delete(wrappedId)
    if (typeof handler === "function") (handler as (...a: unknown[]) => void)(...rest)
    else new Function(handler as string)()
  }, entry.delay, ...entry.args) as unknown as number
}

function stopReal(entry: TimerEntry): void {
  if (entry.realId === null) return
  if (entry.kind === "interval") {
    realClearInterval(entry.realId as unknown as ReturnType<typeof setInterval>)
  } else {
    realClearTimeout(entry.realId as unknown as ReturnType<typeof setTimeout>)
  }
  entry.realId = null
}

function schedule(kind: TimerKind, handler: TimerHandler, delay: number, args: unknown[]): number {
  const wrappedId: number = nextWrappedId++
  const entry: TimerEntry = { kind, handler, delay, args, realId: null }
  allTimers.set(wrappedId, entry)
  if (!(carouselTimersPaused && isCarouselDelay(delay))) {
    startReal(entry, wrappedId)
  }
  return wrappedId
}

function cancel(kind: TimerKind, wrappedId: number | undefined): void {
  if (wrappedId === undefined) return
  const entry: TimerEntry | undefined = allTimers.get(wrappedId)
  if (entry && entry.kind === kind) {
    stopReal(entry)
    allTimers.delete(wrappedId)
    return
  }
  // Not in our registry — likely a real browser ID from code that scheduled before
  // our patch installed (e.g. react-dom internals). Forward to the real clear so
  // it actually stops instead of silently leaking the timer.
  if (kind === "interval") {
    realClearInterval(wrappedId as unknown as ReturnType<typeof setInterval>)
  } else {
    realClearTimeout(wrappedId as unknown as ReturnType<typeof setTimeout>)
  }
}

function install(): void {
  if (scope.__airoTimerPauseInstalled) return
  scope.__airoTimerPauseInstalled = true

  realSetInterval = window.setInterval.bind(window)
  realClearInterval = window.clearInterval.bind(window)
  realSetTimeout = window.setTimeout.bind(window)
  realClearTimeout = window.clearTimeout.bind(window)

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]): number =>
    schedule("interval", handler, timeout ?? 0, args)) as typeof window.setInterval

  window.clearInterval = ((id?: number): void => cancel("interval", id)) as typeof window.clearInterval

  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]): number =>
    schedule("timeout", handler, timeout ?? 0, args)) as typeof window.setTimeout

  window.clearTimeout = ((id?: number): void => cancel("timeout", id)) as typeof window.clearTimeout
}

install()

export function pauseEditModeTimers(): void {
  carouselTimersPaused = true
  for (const entry of allTimers.values()) {
    if (isCarouselDelay(entry.delay) && entry.realId !== null) stopReal(entry)
  }
}

export function resumeEditModeTimers(): void {
  carouselTimersPaused = false
  for (const [wrappedId, entry] of allTimers) {
    if (isCarouselDelay(entry.delay) && entry.realId === null) startReal(entry, wrappedId)
  }
}

// Step paused hand-rolled rotators forward (template Carousel handles itself via autoplay.stop()).
export function advancePausedCarouselTimers(): void {
  // Snapshot to avoid iterating handler-side reschedules — recursive setTimeout would otherwise be an infinite loop.
  const toFire: Array<[number, TimerEntry]> = []
  for (const [wrappedId, entry] of allTimers) {
    if (!isCarouselDelay(entry.delay) || entry.realId !== null) continue
    toFire.push([wrappedId, entry])
  }
  for (const [wrappedId, entry] of toFire) {
    // Drop timeout stubs before firing — handler reschedules itself; leaving the old stub would drift the count and double-restart on resume. Intervals re-fire via the browser, keep them for resume.
    if (entry.kind === "timeout") allTimers.delete(wrappedId)
    const handler: TimerHandler = entry.handler
    if (typeof handler !== "function") continue
    try {
      ;(handler as (...a: unknown[]) => void)(...entry.args)
    } catch {
      // Swallow — one carousel's handler shouldn't break the whole step.
    }
  }
}

export function getPausedCarouselTimerCount(): number {
  let count: number = 0
  for (const entry of allTimers.values()) {
    if (isCarouselDelay(entry.delay) && entry.realId === null) count++
  }
  return count
}

// True if any carousel-shape timer is registered (running or paused). Used as a heuristic to detect hand-rolled rotators that don't carry aria-roledescription="carousel".
export function hasActiveCarouselTimers(): boolean {
  for (const entry of allTimers.values()) {
    if (isCarouselDelay(entry.delay)) return true
  }
  return false
}
