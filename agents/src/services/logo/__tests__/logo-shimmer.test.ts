import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  ensureShimmerAsset,
  ensureShimmerAssets,
  isShimmerUrl,
  LOGO_SHIMMER_SLOT_URLS,
} from '../logo-shimmer.js'

describe('ensureShimmerAsset', () => {
  let workspace: { stat: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  beforeEach(() => { workspace = { stat: vi.fn(), write: vi.fn() } })

  it('writes the shimmer file when absent and returns its slot URL', async () => {
    workspace.stat.mockResolvedValueOnce({ entries: [{ path: 'p', error: 'not_found' }] })
    workspace.write.mockResolvedValueOnce(undefined)
    const url = await ensureShimmerAsset(workspace as never, 'app-1', 'square')
    expect(url).toBe(LOGO_SHIMMER_SLOT_URLS.square)
    expect(workspace.write).toHaveBeenCalledTimes(1)
    const written = workspace.write.mock.calls[0][0]
    expect(written.path).toBe('public/assets/uploads/airo-logo-shimmer-square.svg')
    expect(written.content).toContain('<svg')
  })

  it('does not rewrite when the file already exists', async () => {
    workspace.stat.mockResolvedValueOnce({ entries: [{ path: 'p', kind: 'file', size: 10, modifiedAt: 'now' }] })
    const url = await ensureShimmerAsset(workspace as never, 'app-1', 'horizontal')
    expect(url).toBe(LOGO_SHIMMER_SLOT_URLS.horizontal)
    expect(workspace.write).not.toHaveBeenCalled()
  })

  it('writes distinct files per orientation', async () => {
    workspace.stat.mockResolvedValue({ entries: [{ path: 'p', error: 'not_found' }] })
    workspace.write.mockResolvedValue(undefined)
    const map = await ensureShimmerAssets(workspace as never, 'app-1', ['square', 'horizontal', 'vertical'])
    expect(map).toEqual(LOGO_SHIMMER_SLOT_URLS)
    expect(workspace.write).toHaveBeenCalledTimes(3)
    const paths = workspace.write.mock.calls.map((c) => c[0].path)
    expect(new Set(paths).size).toBe(3)
  })
})

describe('isShimmerUrl', () => {
  it('recognises every orientation URL plus the legacy single-file URL', () => {
    expect(isShimmerUrl(LOGO_SHIMMER_SLOT_URLS.square)).toBe(true)
    expect(isShimmerUrl(LOGO_SHIMMER_SLOT_URLS.horizontal)).toBe(true)
    expect(isShimmerUrl(LOGO_SHIMMER_SLOT_URLS.vertical)).toBe(true)
    expect(isShimmerUrl('/airo-assets/uploads/airo-logo-shimmer.svg')).toBe(true)
  })

  it('rejects real logo URLs and empty values', () => {
    expect(isShimmerUrl('/airo-assets/images/logo/primary')).toBe(false)
    expect(isShimmerUrl(undefined)).toBe(false)
    expect(isShimmerUrl(null)).toBe(false)
    expect(isShimmerUrl('')).toBe(false)
  })
})
