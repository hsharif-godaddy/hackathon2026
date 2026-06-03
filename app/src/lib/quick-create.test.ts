/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { appFetch } from './gasket-config'

vi.mock('./gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('./itc', () => ({
  getItcOverride: vi.fn(),
}))

import { getItcOverride } from './itc'
import { buildDevelopUrl, extractApiError, fetchQuickCreate, getStoredUploadedFiles, setQuickCreateSessionFlags } from './quick-create'

const mockAppFetch = appFetch as Mock
const mockGetItcOverride = getItcOverride as Mock

describe('fetchQuickCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  })

  it('sends initialPrompt in request body', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('build me a site')

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/sites/quick-create',
      expect.objectContaining({
        body: expect.any(String),
      }),
      undefined,
    )
    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body.initialPrompt).toBe('build me a site')
  })

  it('includes itc when getItcOverride returns a value', async () => {
    mockGetItcOverride.mockReturnValue('summer_2026')

    await fetchQuickCreate('test')

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body.itc).toBe('summer_2026')
  })

  it('omits itc when getItcOverride returns null', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test')

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('itc')
  })

  it('passes fetchOptions to appFetch', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test', { authLevel: 3 })

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/sites/quick-create',
      expect.any(Object),
      { authLevel: 3 },
    )
  })

  it('includes productId when provided', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test', undefined, { productId: 'aab-v1' })

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body.productId).toBe('aab-v1')
  })

  it('omits productId when not provided', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test')

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('productId')
  })

  it('includes fqdn when provided', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test', undefined, { fqdn: 'somedomain.com' })

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body.fqdn).toBe('somedomain.com')
  })

  it('omits fqdn when not provided', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test')

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('fqdn')
  })
})

describe('extractApiError', () => {
  it('uses message field when present', () => {
    const error = extractApiError({ message: 'Something broke' })
    expect(error.message).toBe('Something broke')
  })

  it('falls back to error field', () => {
    const error = extractApiError({ error: 'Server error' })
    expect(error.message).toBe('Server error')
  })

  it('uses default message when no fields present', () => {
    const error = extractApiError({})
    expect(error.message).toBe('Failed to create site')
  })

  it('attaches details when present', () => {
    const error = extractApiError({ message: 'fail', details: 'extra info' })
    expect((error as any).details).toBe('extra info')
  })

  it('does not attach details when absent', () => {
    const error = extractApiError({ message: 'fail' })
    expect((error as any).details).toBeUndefined()
  })

  it('attaches errorCode when present', () => {
    const error = extractApiError({ message: 'fail', errorCode: 'APP_LIMIT_EXCEEDED' })
    expect((error as any).errorCode).toBe('APP_LIMIT_EXCEEDED')
  })

  it('does not attach errorCode when absent', () => {
    const error = extractApiError({ message: 'fail' })
    expect((error as any).errorCode).toBeUndefined()
  })
})

describe('setQuickCreateSessionFlags', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('sets all required session flags', () => {
    setQuickCreateSessionFlags('site-1', 'my prompt')

    expect(sessionStorage.getItem('name-registration-pending-site-1')).toBe('true')
    expect(sessionStorage.getItem('initial-prompt-pending-site-1')).toBe('true')
    expect(sessionStorage.getItem('in-creation-flow-site-1')).toBe('true')
    expect(sessionStorage.getItem('initial-prompt-text-site-1')).toBe('my prompt')
  })

  it('sets template flag for non-default template', () => {
    setQuickCreateSessionFlags('site-1', 'test', 'template-v8')

    expect(sessionStorage.getItem('initial-template-site-1')).toBe('template-v8')
  })

  it('does not set template flag for default template', () => {
    setQuickCreateSessionFlags('site-1', 'test', 'default')

    expect(sessionStorage.getItem('initial-template-site-1')).toBeNull()
  })

  it('does not set template flag when omitted', () => {
    setQuickCreateSessionFlags('site-1', 'test')

    expect(sessionStorage.getItem('initial-template-site-1')).toBeNull()
  })
})

describe('setQuickCreateSessionFlags (multi-file)', () => {
  beforeEach(() => sessionStorage.clear())

  it('stores file array under plural key excluding zipRaw', () => {
    const files = [
      { name: 'a.txt', content: 'hi', isDesignMd: false, zipRaw: new ArrayBuffer(10) },
      { name: 'b.png', content: '', isDesignMd: false, isImage: true, zipRaw: new ArrayBuffer(20) },
    ]
    setQuickCreateSessionFlags('site-1', 'build me a site', undefined, files)
    const stored = JSON.parse(sessionStorage.getItem('initial-upload-files-site-1')!)
    expect(stored).toHaveLength(2)
    expect(stored[0]).toEqual({ name: 'a.txt', content: 'hi', isDesignMd: false })
    expect(stored[1]).toEqual({ name: 'b.png', content: '', isDesignMd: false, isImage: true })
    expect(stored[0].zipRaw).toBeUndefined()
  })

  it('does not write key when files array is empty', () => {
    setQuickCreateSessionFlags('site-1', 'prompt', undefined, [])
    expect(sessionStorage.getItem('initial-upload-files-site-1')).toBeNull()
  })
})

describe('getStoredUploadedFiles', () => {
  beforeEach(() => sessionStorage.clear())

  it('reads new plural key', () => {
    sessionStorage.setItem('initial-upload-files-job-1', JSON.stringify([
      { name: 'a.txt', content: '', isDesignMd: true },
    ]))
    const result = getStoredUploadedFiles('job-1', 'app-1')
    expect(result).toHaveLength(1)
    expect(result[0].isDesignMd).toBe(true)
  })

  it('falls back to legacy singular key', () => {
    sessionStorage.setItem('initial-upload-file-app-1', JSON.stringify(
      { name: 'old.txt', content: 'legacy', isDesignMd: false },
    ))
    const result = getStoredUploadedFiles('job-x', 'app-1')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('old.txt')
  })

  it('returns empty array when no keys exist', () => {
    const result = getStoredUploadedFiles('nope', 'nada')
    expect(result).toEqual([])
  })
})

describe('buildDevelopUrl', () => {
  it('returns job URL for job type', () => {
    expect(buildDevelopUrl('job-1', 'job')).toBe('/develop/job-1?type=job')
  })

  it('returns site URL for site type', () => {
    expect(buildDevelopUrl('site-1', 'site')).toBe('/develop/site-1')
  })
})
