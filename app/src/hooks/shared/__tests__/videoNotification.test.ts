import { beforeEach,describe, expect, it, vi } from 'vitest'

import { handleVideoNotification } from '../videoNotification'

const addGrowlMessage = vi.fn()
const setLaunchVideoResult = vi.fn()

vi.mock('@ux/growl', () => ({
  default: { addGrowlMessage: (...args: unknown[]) => addGrowlMessage(...args) },
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: () => ({ setLaunchVideoResult: (...args: unknown[]) => setLaunchVideoResult(...args) }),
  },
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const t = (id: string) => id

describe('handleVideoNotification', () => {
  beforeEach(() => {
    addGrowlMessage.mockClear()
    setLaunchVideoResult.mockClear()
  })

  it('on completed: updates store with the url and shows a success toast', () => {
    handleVideoNotification({
      raw: { status: 'completed', appId: 'app1', jobId: 'job1', videoUrl: 'https://v/1.mp4' },
      clientAppId: 'app1',
      t,
      logPrefix: 'sse.video',
    })

    expect(setLaunchVideoResult).toHaveBeenCalledWith('app1', { type: 'success', url: 'https://v/1.mp4' })
    expect(addGrowlMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'video-success-job1', emphasis: 'success' }),
    )
  })

  it('on failed: updates store with an error and shows a critical toast', () => {
    handleVideoNotification({
      raw: { status: 'failed', appId: 'app1', jobId: 'job1', error: 'boom' },
      clientAppId: 'app1',
      t,
      logPrefix: 'sse.video',
    })

    expect(setLaunchVideoResult).toHaveBeenCalledWith('app1', { type: 'error', message: 'Video generation failed' })
    expect(addGrowlMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'video-failure-job1', emphasis: 'critical' }),
    )
  })

  it('ignores events whose appId does not match the client app', () => {
    handleVideoNotification({
      raw: { status: 'completed', appId: 'other', videoUrl: 'https://v/1.mp4' },
      clientAppId: 'app1',
      t,
      logPrefix: 'sse.video',
    })
    expect(setLaunchVideoResult).not.toHaveBeenCalled()
    expect(addGrowlMessage).not.toHaveBeenCalled()
  })

  it('falls back to the payload appId when the client has no current app', () => {
    handleVideoNotification({
      raw: { status: 'completed', appId: 'app2', videoUrl: 'https://v/2.mp4' },
      clientAppId: null,
      t,
      logPrefix: 'sse.video',
    })
    expect(setLaunchVideoResult).toHaveBeenCalledWith('app2', { type: 'success', url: 'https://v/2.mp4' })
  })

  it('ignores malformed payloads without throwing', () => {
    expect(() =>
      handleVideoNotification({ raw: { nope: true }, clientAppId: 'app1', t, logPrefix: 'sse.video' }),
    ).not.toThrow()
    expect(setLaunchVideoResult).not.toHaveBeenCalled()
  })
})
