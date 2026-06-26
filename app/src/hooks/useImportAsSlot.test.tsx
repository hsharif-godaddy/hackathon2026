/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { useImportAsSlot } from './useImportAsSlot'

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'token-123' }),
}))

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}))

describe('useImportAsSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('imports an upload as a media slot', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ slotPath: 'uploads/photo' }),
    })

    const { result } = renderHook(() => useImportAsSlot('app-123'))
    const slotPath: string = await result.current({ filename: 'photo.png' })

    expect(slotPath).toBe('uploads/photo')
    expect(regenerateToken).toHaveBeenCalledWith({ siteId: 'app-123', force: true })
    expect(dynamicApiConfigService.getConfigForSite).toHaveBeenCalledWith('app-123')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://agent.example.com/media/app-123/slots/import-upload',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify({ filename: 'photo.png' }),
      }),
    )
  })

  it('imports a Getty URL as a media slot', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ slotPath: 'getty/image' }),
    })

    const { result } = renderHook(() => useImportAsSlot('app-123'))
    const slotPath: string = await result.current({ imageUrl: 'https://images.example.com/a.jpg' })

    expect(slotPath).toBe('getty/image')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://agent.example.com/media/app-123/slots/import',
      expect.objectContaining({
        body: JSON.stringify({ imageUrl: 'https://images.example.com/a.jpg' }),
      }),
    )
  })

  it('throws instead of silently no-oping when slotPath is missing', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ slotPath: null }),
    })

    const { result } = renderHook(() => useImportAsSlot('app-123'))
    await expect(result.current({ filename: 'bad.png' })).rejects.toThrow('Import response missing slotPath')
  })

  it('throws before fetching when no import input is provided', async () => {
    const { result } = renderHook(() => useImportAsSlot('app-123'))

    await expect(result.current({})).rejects.toThrow('filename or imageUrl is required')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throws the response error body when import fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Import denied' }),
    })

    const { result } = renderHook(() => useImportAsSlot('app-123'))
    await expect(result.current({ filename: 'bad.png' })).rejects.toThrow('Import denied')
  })
})
