import { describe, it, expect, vi, beforeEach } from 'vitest'
import JSZip from 'jszip'

// Spy must be created via vi.hoisted so the vi.mock factory (hoisted above imports)
// can reference it without a temporal-dead-zone error.
const { mergeSpy } = vi.hoisted(() => ({ mergeSpy: vi.fn() }))

vi.mock('../../../database/repositories/AppMetadataRepository.js', () => ({
  AppMetadataRepository: class { merge = mergeSpy },
}))
vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { stampUploadedKitMetadata } from '../ui-kit-metadata.js'
import { logger } from '../../../logging/index.js'

const APP_ID = 'abcde12345'

function zipWith(files: Record<string, string>): JSZip {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip
}

describe('stampUploadedKitMetadata', () => {
  beforeEach(() => {
    mergeSpy.mockReset()
    vi.mocked(logger.warn).mockClear()
  })

  it('uses metadata.name as the displayName (uploaded-kit format)', async () => {
    const meta = JSON.stringify({ createdAt: '2026-05-13', metadata: { name: 'Organic Earthen Kit', tags: ['warm'] } })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'organic-earthen-kit.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'Organic Earthen Kit' } })
  })

  it('prefers a top-level displayName over metadata.name and slug', async () => {
    const meta = JSON.stringify({ displayName: 'Bordeaux', slug: 'bordeaux', metadata: { name: 'Bordeaux Kit' } })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'x.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'Bordeaux' } })
  })

  it('prefers metadata.name over the deprecated slug', async () => {
    const meta = JSON.stringify({ slug: 'organic-earthen', metadata: { name: 'Organic Earthen Kit' } })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'x.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'Organic Earthen Kit' } })
  })

  it('falls back to the deprecated slug when nothing else is present', async () => {
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': '{"slug":"botanical-calligraphy"}' }), '', 'mykit.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'botanical-calligraphy' } })
  })

  it('captures id and kitId from a catalog-derived kit-meta.json', async () => {
    const meta = JSON.stringify({
      displayName: 'Bordeaux',
      id: '98f856d5-5851-4d96-ac29-7e4f65273540',
      kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
    })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'bordeaux.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, {
      designKit: {
        source: 'upload',
        displayName: 'Bordeaux',
        id: '98f856d5-5851-4d96-ac29-7e4f65273540',
        kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
      },
    })
  })

  it('captures id without kitId (slug-style catalog kit has no kitId)', async () => {
    const meta = JSON.stringify({ displayName: 'Modern Bento', id: '3e4848a8-912b-44e9-81ba-1cfaf058d458' })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'x.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, {
      designKit: { source: 'upload', displayName: 'Modern Bento', id: '3e4848a8-912b-44e9-81ba-1cfaf058d458' },
    })
  })

  it('omits id/kitId when they are not strings', async () => {
    const meta = JSON.stringify({ displayName: 'kit', id: 123, kitId: null })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'x.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'kit' } })
  })

  it('falls back to the uploaded filename when kit-meta.json has no name fields', async () => {
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': '{}' }), '', 'Acme Brand Kit.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'Acme Brand Kit' } })
  })

  it('captures id/kitId even when displayName falls back to the filename', async () => {
    const meta = JSON.stringify({
      id: '98f856d5-5851-4d96-ac29-7e4f65273540',
      kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
    })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'fancy-kit.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, {
      designKit: {
        source: 'upload',
        displayName: 'fancy-kit',
        id: '98f856d5-5851-4d96-ac29-7e4f65273540',
        kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
      },
    })
  })

  it('ignores a non-string displayName/slug and uses metadata.name', async () => {
    const meta = JSON.stringify({ displayName: 99, slug: 123, metadata: { name: 'Earthen' } })
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': meta }), '', 'x.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'Earthen' } })
  })

  it('ignores whitespace-only name fields and falls back to the filename', async () => {
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': '{"slug":"   ","displayName":"  "}' }), '', 'fallback-kit.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'fallback-kit' } })
  })

  it('strips the .zip extension case-insensitively in the filename fallback', async () => {
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': '{}' }), '', 'MyKit.ZIP')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'MyKit' } })
  })

  it('falls back to the filename when kit-meta.json is absent', async () => {
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'tokens.css': ':root{}' }), '', 'kit.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'kit' } })
  })

  it('falls back to the filename and logs kit_meta_unreadable on malformed JSON', async () => {
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': '{not valid' }), '', 'kit.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'kit' } })
    expect(logger.warn).toHaveBeenCalledWith(
      'route.file-upload.kit_meta_unreadable',
      expect.objectContaining({ appId: APP_ID, fileName: 'kit.zip' })
    )
  })

  it('resolves kit-meta.json under a common prefix (macOS folder wrap)', async () => {
    await stampUploadedKitMetadata(APP_ID, zipWith({ 'MyKit/kit-meta.json': '{"displayName":"Prefixed"}' }), 'MyKit/', 'x.zip')
    expect(mergeSpy).toHaveBeenCalledWith(APP_ID, { designKit: { source: 'upload', displayName: 'Prefixed' } })
  })

  it('is best-effort: a merge failure does not throw', async () => {
    mergeSpy.mockImplementation(() => { throw new Error('db down') })
    await expect(
      stampUploadedKitMetadata(APP_ID, zipWith({ 'kit-meta.json': '{}' }), '', 'kit.zip')
    ).resolves.toBeUndefined()
  })
})
