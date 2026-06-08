/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadChatFiles } from '@/app/[market]/develop/components/chat/uploadChatFiles'

vi.mock('@/lib/file-agent', () => ({
  getFileUploadAgent: vi.fn().mockResolvedValue({
    token: 't',
    uploadUrl: 'http://localhost/files/upload',
  }),
}))

vi.mock('@/utils/image-compression', () => ({
  compressImageFiles: vi.fn(async function (files: File[]) { return files; }),
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const t = (key: string) => key

describe('uploadChatFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('returns files from successful response', async () => {
    const uploaded = [
      {
        id: '1',
        originalName: 'a.jpg',
        filename: 'a-hash.jpg',
        size: 10,
        mimeType: 'image/jpeg',
        uploadedAt: new Date().toISOString(),
      },
    ]
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ files: uploaded, uploadId: 'u1' }),
    } as Response)

    const result = await uploadChatFiles(
      'app-1',
      [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
      t
    )

    expect(result.files).toEqual(uploaded)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('returns batchLevelError on validation failure without calling fetch', async () => {
    const big = new File([new ArrayBuffer(26 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' })
    const result = await uploadChatFiles('app-1', [big], t)
    expect(result.files).toEqual([])
    expect(result.batchLevelError).toBeTruthy()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('uploads in chunks of MAX_FILES_PER_UPLOAD and merges results', async () => {
    const files = Array.from({ length: 7 }, (_, i) =>
      new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' })
    )
    let batchIndex = 0
    vi.mocked(global.fetch).mockImplementation(async function () {
      batchIndex += 1
      const isFirst = batchIndex === 1
      const uploaded = (isFirst ? files.slice(0, 5) : files.slice(5)).map((f, j) => ({
        id: `${batchIndex}-${j}`,
        originalName: f.name,
        filename: `${f.name}.hash`,
        size: 1,
        mimeType: 'image/jpeg',
        uploadedAt: new Date().toISOString(),
      }))
      return {
        ok: true,
        json: async () => ({ files: uploaded, uploadId: `u${batchIndex}` }),
      } as Response
    })

    const result = await uploadChatFiles('app-1', files, t)

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(result.files).toHaveLength(7)
    expect(result.files.map((f) => f.originalName)).toEqual([
      'f0.jpg', 'f1.jpg', 'f2.jpg', 'f3.jpg', 'f4.jpg', 'f5.jpg', 'f6.jpg',
    ])
  })

  it('returns partial files and batchLevelError when a later batch fails', async () => {
    const files = Array.from({ length: 7 }, (_, i) =>
      new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' })
    )
    let batchIndex = 0
    vi.mocked(global.fetch).mockImplementation(async function () {
      batchIndex += 1
      if (batchIndex === 1) {
        const uploaded = files.slice(0, 5).map((f, j) => ({
          id: `1-${j}`,
          originalName: f.name,
          filename: `${f.name}.hash`,
          size: 1,
          mimeType: 'image/jpeg',
          uploadedAt: new Date().toISOString(),
        }))
        return {
          ok: true,
          json: async () => ({ files: uploaded, uploadId: 'u1' }),
        } as Response
      }
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'unavailable' }),
      } as Response
    })

    const result = await uploadChatFiles('app-1', files, t)

    expect(result.files).toHaveLength(5)
    // uploadChatFilesBatch prefers JSON `error` over the generic Upload failed (status) message
    expect(result.batchLevelError).toBe('unavailable')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
