import { describe, it, expect, beforeEach, vi } from 'vitest'

// Helper to create execution options with context
const createExecutionOptions = (appId?: string) => ({
  experimental_context: {
    metadata: appId ? { appId } : {}
  }
})

// Mock FileEditTool
const mockEditFile = vi.fn()
vi.mock('../../file-edit.js', () => ({
  FileEditTool: vi.fn(() => ({
    editFile: mockEditFile
  }))
}))

// Mock database connection
vi.mock('../../../database/connection.js', () => ({
  db: {
    prepare: vi.fn(),
    exec: vi.fn(),
    transaction: vi.fn()
  }
}))

// Mock Logger
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

// Mock AppRepository
const mockFindById = vi.fn()
const mockUpdate = vi.fn()
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(() => ({
    findById: mockFindById,
    update: mockUpdate
  }))
}))

// Mock the KV memory store
const mockMemoryGet = vi.fn()
const mockMemorySet = vi.fn()
const mockGetKvMemoryStore = vi.fn(() => ({
  get: mockMemoryGet,
  set: mockMemorySet,
}))
vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => mockGetKvMemoryStore(),
}))

// Import after mocks are set up
import { setProjectNameAITool } from '../set-project-name.js'

describe('set-project-name', function setProjectNameTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
    // Default: memory get returns empty, set succeeds
    mockMemoryGet.mockResolvedValue({ success: true, exists: false, value: null })
    mockMemorySet.mockResolvedValue({ success: true })
  })

  describe('index.html title update', function titleUpdateTests() {
    it('should update index.html title when it has default value', async function updateDefaultTitle() {
      const appId = 'test-app-1'
      const newName = 'My Awesome App'
      const appPath = '/tmp/apps/test-app-1/app'

      mockFindById.mockReturnValue({
        id: appId,
        name: 'Old Name',
        path: appPath
      })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      mockEditFile.mockResolvedValue({ success: true, path: 'index.html', mode: 'edit' })

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      expect(result).toContain('Project Name Set')
      expect(result).toContain(newName)
      expect(mockEditFile).toHaveBeenCalledWith(
        appPath,
        {
          path: 'index.html',
          mode: 'edit',
          edits: [{ old: '<title>App Template</title>', new: `<title>${newName}</title>` }],
          autoCommit: true,
          commitMessage: `Set page title to "${newName}"`
        },
        { appId }
      )
    })

    it('should not update index.html title when already customized', async function skipCustomizedTitle() {
      const appId = 'test-app-2'
      const newName = 'My New App'
      const appPath = '/tmp/apps/test-app-2/app'

      mockFindById.mockReturnValue({
        id: appId,
        name: 'Old Name',
        path: appPath
      })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      // FileEditTool returns error when search string not found
      mockEditFile.mockResolvedValue({
        success: false,
        path: 'index.html',
        mode: 'edit',
        error: 'Search text not found in file'
      })

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      expect(result).toContain('Project Name Set')
      expect(mockEditFile).toHaveBeenCalled()
    })

    it('should continue successfully if FileEditTool fails', async function handleEditError() {
      const appId = 'test-app-3'
      const newName = 'My App'
      const appPath = '/tmp/apps/test-app-3/app'

      mockFindById.mockReturnValue({
        id: appId,
        name: 'Old Name',
        path: appPath
      })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      mockEditFile.mockRejectedValue(new Error('File not found'))

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      // Tool should still succeed even if title update fails
      expect(result).toContain('Project Name Set')
      expect(result).toContain(newName)
    })

    it('should skip title update if app has no path', async function skipNoPath() {
      const appId = 'test-app-4'
      const newName = 'My App'

      mockFindById.mockReturnValue({
        id: appId,
        name: 'Old Name',
        path: undefined
      })
      mockUpdate.mockReturnValue({ id: appId, name: newName })

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      expect(result).toContain('Project Name Set')
      expect(mockEditFile).not.toHaveBeenCalled()
    })

    it('should escape HTML special characters in project name to prevent XSS', async function escapeHtmlChars() {
      const appId = 'test-app-5'
      const maliciousName = '</title><script>alert("xss")</script><title>'
      const escapedName = '&lt;/title&gt;&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&lt;title&gt;'
      const appPath = '/tmp/apps/test-app-5/app'

      mockFindById.mockReturnValue({
        id: appId,
        name: 'Old Name',
        path: appPath
      })
      mockUpdate.mockReturnValue({ id: appId, name: maliciousName })
      mockEditFile.mockResolvedValue({ success: true, path: 'index.html', mode: 'edit' })

      await setProjectNameAITool.execute(
        { name: maliciousName },
        createExecutionOptions(appId)
      )

      // Verify HTML special characters are escaped in the edit
      expect(mockEditFile).toHaveBeenCalledWith(
        appPath,
        {
          path: 'index.html',
          mode: 'edit',
          edits: [{ old: '<title>App Template</title>', new: `<title>${escapedName}</title>` }],
          autoCommit: true,
          commitMessage: `Set page title to "${maliciousName}"`
        },
        { appId }
      )
    })
  })

  describe('brand.identity memory write', function memoryWriteTests() {
    it('should store brandName in brand.identity memory', async function writeBrandName() {
      const appId = 'test-app-mem-1'
      const newName = 'My Brand'

      mockFindById.mockReturnValue({ id: appId, name: 'Old', path: undefined })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      mockMemoryGet.mockResolvedValue({ success: true, exists: false, value: null })
      mockMemorySet.mockResolvedValue({ success: true })

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      expect(result).toContain('Project Name Set')
      expect(mockMemorySet).toHaveBeenCalledWith({ kind: 'local', appId }, 'brand.identity', { brandName: newName })
    })

    it('should merge brandName into existing brand.identity data', async function mergeBrandName() {
      const appId = 'test-app-mem-2'
      const newName = 'Updated Brand'

      mockFindById.mockReturnValue({ id: appId, name: 'Old', path: undefined })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      mockMemoryGet.mockResolvedValue({
        success: true,
        exists: true,
        value: { tagline: 'Existing tagline', brandName: 'Old Brand' },
      })
      mockMemorySet.mockResolvedValue({ success: true })

      await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      expect(mockMemorySet).toHaveBeenCalledWith({ kind: 'local', appId }, 'brand.identity', {
        tagline: 'Existing tagline',
        brandName: newName,
      })
    })

    it('should log warning when memory write fails', async function memoryWriteFail() {
      const appId = 'test-app-mem-3'
      const newName = 'My Brand'

      mockFindById.mockReturnValue({ id: appId, name: 'Old', path: undefined })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      mockMemoryGet.mockResolvedValue({ success: true, exists: false, value: null })
      mockMemorySet.mockResolvedValue({ success: false, error: 'DB write error' })

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      // Tool should still succeed but signal the sync failure to the LLM
      expect(result).toContain('Project Name Set')
      expect(result).toContain('Brand identity memory sync failed')
    })

    it('should skip memory write when memory read fails to avoid destroying existing data', async function memoryReadFail() {
      const appId = 'test-app-mem-5'
      const newName = 'My Brand'

      mockFindById.mockReturnValue({ id: appId, name: 'Old', path: undefined })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      mockMemoryGet.mockResolvedValue({ success: false, exists: false, value: null, error: 'DB read error' })

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      // Tool should still succeed but signal the sync failure to the LLM
      expect(result).toContain('Project Name Set')
      expect(result).toContain('Brand identity memory sync failed')
      // Should NOT write — writing without a known-good base would destroy existing fields
      expect(mockMemorySet).not.toHaveBeenCalled()
    })

    it('should handle non-object existing brand.identity gracefully', async function nonObjectIdentity() {
      const appId = 'test-app-mem-4'
      const newName = 'My Brand'

      mockFindById.mockReturnValue({ id: appId, name: 'Old', path: undefined })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      // Existing value is a string (not an object) — should not spread
      mockMemoryGet.mockResolvedValue({ success: true, exists: true, value: 'some-string' })
      mockMemorySet.mockResolvedValue({ success: true })

      await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      // Should create a fresh object rather than spreading a string
      expect(mockMemorySet).toHaveBeenCalledWith({ kind: 'local', appId }, 'brand.identity', { brandName: newName })
    })

    it('should return partial success when KV memory store initialization throws', async function constructorThrow() {
      const appId = 'test-app-mem-6'
      const newName = 'My Brand'

      mockFindById.mockReturnValue({ id: appId, name: 'Old', path: undefined })
      mockUpdate.mockReturnValue({ id: appId, name: newName })
      // Simulate the store initialization throwing (e.g. locked DB on first access)
      mockGetKvMemoryStore.mockImplementationOnce(() => { throw new Error('DB locked') })

      const result = await setProjectNameAITool.execute(
        { name: newName },
        createExecutionOptions(appId)
      )

      // Primary operation (appRepo.update) succeeded — should not report full failure
      expect(result).toContain('Project Name Set')
      expect(result).toContain('Brand identity memory sync failed')
      expect(result).not.toContain('Error Setting Project Name')
    })
  })

  describe('error handling', function errorHandlingTests() {
    it('should return error when no appId in context', async function noAppId() {
      const result = await setProjectNameAITool.execute(
        { name: 'Test' },
        createExecutionOptions()
      )

      expect(result).toContain('Error Setting Project Name')
      expect(result).toContain('No app ID available')
    })

    it('should return error when app not found', async function appNotFound() {
      mockFindById.mockReturnValue(null)

      const result = await setProjectNameAITool.execute(
        { name: 'Test' },
        createExecutionOptions('nonexistent-app')
      )

      expect(result).toContain('Error Setting Project Name')
      expect(result).toContain('App not found')
    })
  })
})
