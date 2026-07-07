/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type TimerPauseModule = typeof import('../edit-mode-timer-pause')
type SlotEditModule = typeof import('../carousel-slot-edit')

type InstalledFlag = typeof globalThis & { __airoTimerPauseInstalled?: boolean }

async function loadFreshModules(): Promise<{ timerPause: TimerPauseModule; slotEdit: SlotEditModule }> {
  vi.resetModules()
  delete (globalThis as InstalledFlag).__airoTimerPauseInstalled
  const timerPause: TimerPauseModule = await import('../edit-mode-timer-pause')
  const slotEdit: SlotEditModule = await import('../carousel-slot-edit')
  return { timerPause, slotEdit }
}

describe('carousel-slot-edit — root detachment self-heal', () => {
  let timerPause: TimerPauseModule
  let slotEdit: SlotEditModule

  beforeEach(async () => {
    delete window.__airoCarouselSlotEditActive
    delete window.__airoCarouselSlotEditRoot
    ;({ timerPause, slotEdit } = await loadFreshModules())
  })

  afterEach(() => {
    slotEdit.setCarouselSlotEdit(false)
    delete window.__airoCarouselSlotEditActive
    delete window.__airoCarouselSlotEditRoot
  })

  it('auto-clears slot-edit when the target carousel detaches from the DOM', async () => {
    const root: HTMLElement = document.createElement('div')
    document.body.appendChild(root)

    slotEdit.setCarouselSlotEdit(true, root)
    expect(slotEdit.isCarouselSlotEditActive()).toBe(true)

    root.remove()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(slotEdit.isCarouselSlotEditActive()).toBe(false)
  })

  it('resumes paused carousel timers when the target detaches', async () => {
    const handler = vi.fn()
    setInterval(handler, 3000)
    expect(timerPause.getPausedCarouselTimerCount()).toBe(0)

    const root: HTMLElement = document.createElement('div')
    document.body.appendChild(root)
    slotEdit.setCarouselSlotEdit(true, root)
    expect(timerPause.getPausedCarouselTimerCount()).toBe(1)

    root.remove()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(timerPause.getPausedCarouselTimerCount()).toBe(0)
  })

  it('does not auto-clear when a null root is used (hand-rolled fallback path)', async () => {
    slotEdit.setCarouselSlotEdit(true, null)
    expect(slotEdit.isCarouselSlotEditActive()).toBe(true)

    // Simulate arbitrary DOM churn — no root to observe means no auto-clear.
    const noise: HTMLElement = document.createElement('div')
    document.body.appendChild(noise)
    noise.remove()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(slotEdit.isCarouselSlotEditActive()).toBe(true)
  })

  it('disconnects the detachment observer on explicit exit', async () => {
    const root: HTMLElement = document.createElement('div')
    document.body.appendChild(root)
    slotEdit.setCarouselSlotEdit(true, root)
    slotEdit.setCarouselSlotEdit(false)

    // After explicit exit, removing the root should NOT re-fire setCarouselSlotEdit(false).
    // Verify by re-activating with a null root and confirming state stays active despite root churn.
    slotEdit.setCarouselSlotEdit(true, null)
    root.remove()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(slotEdit.isCarouselSlotEditActive()).toBe(true)
  })
})
