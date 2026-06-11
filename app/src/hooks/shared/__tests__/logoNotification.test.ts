// @vitest-environment jsdom
import { beforeEach,describe, expect, it, vi } from 'vitest'

const mockSetLogoJobResult = vi.fn()
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: { getState: () => ({ setLogoJobResult: (...args: unknown[]) => mockSetLogoJobResult(...args) }) },
}))
const mockPostMessageToIframe = vi.fn()
vi.mock('@/utils/postMessage', () => ({ postMessageToIframe: (...args: unknown[]) => mockPostMessageToIframe(...args) }))
const mockAddGrowl = vi.fn()
vi.mock('@ux/growl', () => ({ default: { addGrowlMessage: (...args: unknown[]) => mockAddGrowl(...args) } })) // DEFAULT import, matches videoNotification
const mockInvalidateQueries = vi.fn()
vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: () => ({ invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args) }),
}))
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } })) // matches videoNotification's logger import

import { handleLogoNotification } from '../logoNotification'

const t = (id: string): string => id
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = '<iframe id="preview-iframe"></iframe>'
})

describe('handleLogoNotification', () => {
  it('records a completed result (carrying the logo) and reloads each slot in the preview', () => {
    const logo = { id: 'logo-1', urls: { horizontal: { color: 'https://cdn/logo.png' } } }
    handleLogoNotification({
      raw: { status: 'completed', appId: 'app-1', jobId: 'job-1', slots: ['logo/horizontal'], logo },
      clientAppId: 'app-1', t, logPrefix: 'logo.websocket',
    })
    expect(mockSetLogoJobResult).toHaveBeenCalledWith('app-1', expect.objectContaining({ status: 'completed', jobId: 'job-1', logo }))
    expect(mockPostMessageToIframe).toHaveBeenCalledWith(expect.anything(), { type: 'RELOAD_MEDIA_SLOT', slotPath: 'logo/horizontal' })
    expect(mockAddGrowl).toHaveBeenCalled()
  })

  it('dispatches a logo-generated window event so the Brand Book previews it live', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const logo = { id: 'logo-1', urls: { horizontal: { transparent: 'https://cdn/logo.png' } } }
    handleLogoNotification({
      raw: { status: 'completed', appId: 'app-1', jobId: 'job-1', slots: ['logo/horizontal'], logo },
      clientAppId: 'app-1', t, logPrefix: 'logo.websocket',
    })
    const logoEvent = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === 'logo-generated')
    expect(logoEvent).toBeTruthy()
    dispatchSpy.mockRestore()
  })

  it('invalidates the media manifest query on a completed event', () => {
    handleLogoNotification({
      raw: { status: 'completed', appId: 'app-1', jobId: 'job-1', slots: ['logo/horizontal'] },
      clientAppId: 'app-1', t, logPrefix: 'logo.websocket',
    })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['mediaManifest', 'app-1'] })
  })

  it('records slotSaveFailed/failedLayouts and shows a WARNING growl on a partial completion', () => {
    handleLogoNotification({
      raw: {
        status: 'completed', appId: 'app-1', jobId: 'job-1', slots: ['logo/horizontal'],
        slotSaveFailed: true, failedLayouts: ['horizontal'],
      },
      clientAppId: 'app-1', t, logPrefix: 'logo.websocket',
    })
    expect(mockSetLogoJobResult).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ status: 'completed', jobId: 'job-1', slotSaveFailed: true, failedLayouts: ['horizontal'] }),
    )
    expect(mockAddGrowl).toHaveBeenCalledWith(expect.objectContaining({ emphasis: 'warning' }))
    // Still invalidates the manifest so successfully-saved slots swap in.
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['mediaManifest', 'app-1'] })
  })

  it('records a failed result with the error', () => {
    handleLogoNotification({
      raw: { status: 'failed', appId: 'app-1', jobId: 'job-1', slots: ['logo/horizontal'], error: 'boom' },
      clientAppId: 'app-1', t, logPrefix: 'logo.websocket',
    })
    expect(mockSetLogoJobResult).toHaveBeenCalledWith('app-1', expect.objectContaining({ status: 'failed', error: 'boom' }))
  })

  it('ignores an event for a different app', () => {
    handleLogoNotification({ raw: { status: 'completed', appId: 'other', jobId: 'j' }, clientAppId: 'app-1', t, logPrefix: 'x' })
    expect(mockSetLogoJobResult).not.toHaveBeenCalled()
  })
})
