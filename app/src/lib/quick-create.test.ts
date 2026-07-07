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
import { buildDevelopUrl, extractApiError, fetchQuickCreate, getStorageItem, getStoredDesignKitSlug, getStoredStartProfile, getStoredUploadedFiles, migrateStartProfileToAppId, setQuickCreateSessionFlags } from './quick-create'

const mockAppFetch = appFetch as Mock
const mockGetItcOverride = getItcOverride as Mock

describe('getStorageItem', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('returns sessionStorage value when present', () => {
    sessionStorage.setItem('test-key', 'session-val')
    expect(getStorageItem('test-key')).toBe('session-val')
  })

  it('falls back to localStorage when sessionStorage has no value', () => {
    localStorage.setItem('test-key', 'local-val')
    expect(getStorageItem('test-key')).toBe('local-val')
  })

  it('prefers sessionStorage over localStorage when both have the key', () => {
    sessionStorage.setItem('test-key', 'session-val')
    localStorage.setItem('test-key', 'local-val')
    expect(getStorageItem('test-key')).toBe('session-val')
  })

  it('returns null when neither storage has the key', () => {
    expect(getStorageItem('missing-key')).toBeNull()
  })
})

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
      { handle401: { level: 3 } },
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

  it('enables level-3 reactive auth recovery by default', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test')

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/sites/quick-create',
      expect.any(Object),
      { handle401: { level: 3 } },
    )
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

  it('includes source when provided', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test', undefined, { source: 'homepage' })

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body.source).toBe('homepage')
  })

  it('omits source when not provided', async () => {
    mockGetItcOverride.mockReturnValue(null)

    await fetchQuickCreate('test')

    const body = JSON.parse(mockAppFetch.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('source')
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

  it('defaults intent-category to new_build', () => {
    setQuickCreateSessionFlags('site-1', 'test')

    expect(sessionStorage.getItem('intent-category-site-1')).toBe('new_build')
  })

  it('accepts a custom intentCategory', () => {
    setQuickCreateSessionFlags('site-1', 'test', undefined, { intentCategory: 'edit' })

    expect(sessionStorage.getItem('intent-category-site-1')).toBe('edit')
  })

  it('stores pre-resolved entry point in session', () => {
    setQuickCreateSessionFlags('site-1', 'test', undefined, { entryPoint: 'venture' })

    expect(sessionStorage.getItem('entry-point-site-1')).toBe('venture')
  })

  it('does not store entry point when omitted', () => {
    setQuickCreateSessionFlags('site-1', 'test')

    expect(sessionStorage.getItem('entry-point-site-1')).toBeNull()
  })
})

describe('setQuickCreateSessionFlags (multi-file)', () => {
  beforeEach(() => sessionStorage.clear())

  it('stores file array under plural key excluding zipRaw', () => {
    const files = [
      { name: 'a.txt', content: 'hi', isDesignMd: false, zipRaw: new ArrayBuffer(10) },
      { name: 'b.png', content: '', isDesignMd: false, isImage: true, zipRaw: new ArrayBuffer(20) },
    ]
    setQuickCreateSessionFlags('site-1', 'build me a site', undefined, { uploadedFiles: files })
    const stored = JSON.parse(sessionStorage.getItem('initial-upload-files-site-1')!)
    expect(stored).toHaveLength(2)
    expect(stored[0]).toEqual({ name: 'a.txt', content: 'hi', isDesignMd: false })
    expect(stored[1]).toEqual({ name: 'b.png', content: '', isDesignMd: false, isImage: true })
    expect(stored[0].zipRaw).toBeUndefined()
  })

  it('does not write key when files array is empty', () => {
    setQuickCreateSessionFlags('site-1', 'prompt', undefined, { uploadedFiles: [] })
    expect(sessionStorage.getItem('initial-upload-files-site-1')).toBeNull()
  })
})

describe('getStoredUploadedFiles', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

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

  it('falls back to localStorage when sessionStorage plural key is absent (cross-origin receive bridge)', () => {
    // The /api/receive iframe bridge writes to localStorage because sessionStorage is
    // not shared across origins. getStoredUploadedFiles must read it when sessionStorage
    // has no value for the same key.
    localStorage.setItem('initial-upload-files-job-1', JSON.stringify([
      { name: 'bridge.png', content: '', isDesignMd: false, isImage: true },
    ]))
    const result = getStoredUploadedFiles('job-1', 'app-1')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('bridge.png')
  })

  it('prefers sessionStorage over localStorage when both have the plural key', () => {
    sessionStorage.setItem('initial-upload-files-job-1', JSON.stringify([
      { name: 'session.txt', content: '', isDesignMd: false },
    ]))
    localStorage.setItem('initial-upload-files-job-1', JSON.stringify([
      { name: 'local.txt', content: '', isDesignMd: false },
    ]))
    const result = getStoredUploadedFiles('job-1', 'app-1')
    expect(result[0].name).toBe('session.txt')
  })

  it('falls back to appId localStorage key when initialJobId has nothing in either storage', () => {
    localStorage.setItem('initial-upload-files-app-1', JSON.stringify([
      { name: 'appid.png', content: '', isDesignMd: false },
    ]))
    const result = getStoredUploadedFiles('job-x', 'app-1')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('appid.png')
  })

  it('returns empty array when localStorage plural key contains malformed JSON', () => {
    localStorage.setItem('initial-upload-files-job-1', 'not valid json{{{')
    const result = getStoredUploadedFiles('job-1', 'app-1')
    expect(result).toEqual([])
  })

  it('returns empty array when appId plural key contains malformed JSON', () => {
    localStorage.setItem('initial-upload-files-app-1', 'not valid json{{{')
    const result = getStoredUploadedFiles('job-x', 'app-1')
    expect(result).toEqual([])
  })

  it('returns empty array when singular key contains malformed JSON', () => {
    localStorage.setItem('initial-upload-file-job-1', 'not valid json{{{')
    const result = getStoredUploadedFiles('job-1', 'app-1')
    expect(result).toEqual([])
  })

  it('falls back to localStorage for singular key (cross-origin receive bridge)', () => {
    localStorage.setItem('initial-upload-file-job-1', JSON.stringify(
      { name: 'bridge-single.txt', content: 'data', isDesignMd: false },
    ))
    const result = getStoredUploadedFiles('job-1', 'app-1')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('bridge-single.txt')
  })

  it('prefers sessionStorage over localStorage for singular key', () => {
    sessionStorage.setItem('initial-upload-file-job-1', JSON.stringify(
      { name: 'session-single.txt', content: '', isDesignMd: false },
    ))
    localStorage.setItem('initial-upload-file-job-1', JSON.stringify(
      { name: 'local-single.txt', content: '', isDesignMd: false },
    ))
    const result = getStoredUploadedFiles('job-1', 'app-1')
    expect(result[0].name).toBe('session-single.txt')
  })
})

describe('setQuickCreateSessionFlags designKitSlug', () => {
  beforeEach(() => sessionStorage.clear())

  it('stores the slug when provided', () => {
    setQuickCreateSessionFlags('site1', 'build me a site', undefined, { designKitSlug: 'golden-hour' })
    expect(sessionStorage.getItem('initial-design-kit-site1')).toBe('golden-hour')
  })
  it('stores nothing when slug omitted', () => {
    setQuickCreateSessionFlags('site2', 'build me a site')
    expect(sessionStorage.getItem('initial-design-kit-site2')).toBeNull()
  })
})

describe('migrateStartProfileToAppId', () => {
  beforeEach(() => sessionStorage.clear())

  it('copies the job-id profile onto the app id so the app-id-keyed mint resolves it', () => {
    // Profile is stored under the job id at create; the agent-token mint after the
    // job→app flip reads getStoredStartProfile(appId), which would otherwise miss it.
    sessionStorage.setItem('initial-profile-job-1', 'initial-agent-v3')
    migrateStartProfileToAppId('job-1', 'app-1')
    expect(getStoredStartProfile('app-1')).toBe('initial-agent-v3')
  })

  it('does not overwrite an existing app-id profile', () => {
    sessionStorage.setItem('initial-profile-job-1', 'initial-agent-v3')
    sessionStorage.setItem('initial-profile-app-1', 'experimental')
    migrateStartProfileToAppId('job-1', 'app-1')
    expect(getStoredStartProfile('app-1')).toBe('experimental')
  })

  it('is a no-op when there is no job-id profile', () => {
    migrateStartProfileToAppId('job-1', 'app-1')
    expect(getStoredStartProfile('app-1')).toBeNull()
  })

  it('is a no-op when jobId equals appId', () => {
    sessionStorage.setItem('initial-profile-app-1', 'initial-agent-v3')
    migrateStartProfileToAppId('app-1', 'app-1')
    expect(getStoredStartProfile('app-1')).toBe('initial-agent-v3')
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

describe('getStoredDesignKitSlug', () => {
  beforeEach(() => sessionStorage.clear())

  it('returns slug for initialJobId key', () => {
    sessionStorage.setItem('initial-design-kit-job-1', 'golden-hour')
    const result = getStoredDesignKitSlug('job-1', 'app-1')
    expect(result).toBe('golden-hour')
  })

  it('falls back to appId key when initialJobId has no value', () => {
    sessionStorage.setItem('initial-design-kit-app-1', 'swiss-noir')
    const result = getStoredDesignKitSlug('job-x', 'app-1')
    expect(result).toBe('swiss-noir')
  })

  it('returns null when absent', () => {
    const result = getStoredDesignKitSlug('nope', 'nada')
    expect(result).toBeNull()
  })
})
