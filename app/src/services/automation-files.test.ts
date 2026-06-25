import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
}))

vi.mock('@/services/AppService', () => ({
  AppService: {
    getInstance: () => ({
      readFile: mockReadFile,
      writeFile: mockWriteFile,
    }),
  },
}))

import { create, list, remove, update } from './automation-files'

const APP_ID = 'app-123'
const INDEX_PATH = '.airo/jobs/index.json'
const AGENT_ID = 'test-uuid-1234'
const FILE_PATH = `.airo/jobs/${AGENT_ID}/${AGENT_ID}.md`

const AUTOMATION_DATA = {
  name: 'Check Links',
  description: 'Scans for broken links',
  prompt: 'Please scan all links and report broken ones.',
}

function makeFileContent(name: string, description: string, prompt: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${prompt}\n`
}

describe('automation-files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue({ success: true })
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(AGENT_ID as `${string}-${string}-${string}-${string}-${string}`)
  })

  describe('#list', () => {
    it('returns automations from index', async () => {
      mockReadFile
        .mockResolvedValueOnce({ content: JSON.stringify([AGENT_ID]) })
        .mockResolvedValueOnce({ content: makeFileContent(AUTOMATION_DATA.name, AUTOMATION_DATA.description, AUTOMATION_DATA.prompt) })

      const result = await list(APP_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: AGENT_ID, ...AUTOMATION_DATA })
    })

    it('returns empty array when index is missing (404)', async () => {
      const err = Object.assign(new Error('not found'), { status: 404 })
      mockReadFile.mockRejectedValue(err)

      expect(await list(APP_ID)).toEqual([])
    })

    it('retries and propagates 503 index read errors', async () => {
      vi.useFakeTimers()
      try {
        const err = Object.assign(new Error('service unavailable'), { status: 503 })
        mockReadFile.mockRejectedValue(err)

        const assertion = expect(list(APP_ID)).rejects.toThrow('service unavailable')
        await vi.runAllTimersAsync()
        await assertion
        expect(mockReadFile).toHaveBeenCalledTimes(6)
      } finally {
        vi.useRealTimers()
      }
    })

    it('retries and propagates network-level errors (no status)', async () => {
      vi.useFakeTimers()
      try {
        mockReadFile.mockRejectedValue(new TypeError('Failed to fetch'))

        const assertion = expect(list(APP_ID)).rejects.toThrow('Failed to fetch')
        await vi.runAllTimersAsync()
        await assertion
        expect(mockReadFile).toHaveBeenCalledTimes(6)
      } finally {
        vi.useRealTimers()
      }
    })

    it('propagates non-retryable index read errors immediately', async () => {
      const err = Object.assign(new Error('unauthorized'), { status: 401 })
      mockReadFile.mockRejectedValue(err)

      await expect(list(APP_ID)).rejects.toThrow('unauthorized')
      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })

    it('returns empty array when index is empty', async () => {
      mockReadFile.mockResolvedValue({ content: '' })

      expect(await list(APP_ID)).toEqual([])
    })

    it('returns empty array when index JSON is not an array', async () => {
      mockReadFile.mockResolvedValue({ content: '{"invalid": true}' })

      expect(await list(APP_ID)).toEqual([])
    })

    it('skips unreadable automation files without throwing', async () => {
      mockReadFile
        .mockResolvedValueOnce({ content: JSON.stringify([AGENT_ID, 'other-id']) })
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce({ content: makeFileContent('Other', 'desc', 'prompt') })

      const result = await list(APP_ID)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Other')
    })

    it('skips files with missing name field', async () => {
      mockReadFile
        .mockResolvedValueOnce({ content: JSON.stringify([AGENT_ID]) })
        .mockResolvedValueOnce({ content: '---\ndescription: No name\n---\n\nPrompt' })

      expect(await list(APP_ID)).toEqual([])
    })

    it('round-trips names containing special YAML characters via gray-matter', async () => {
      const name = 'Fix: broken & "special" chars'
      const description = 'Uses dashes and colons: really'
      const prompt = 'Do the fix'

      // Use gray-matter directly to serialize (mirrors what create() uses)
      const matter = (await import('gray-matter')).default
      const serialized = matter.stringify(prompt, { name, description })

      mockReadFile
        .mockResolvedValueOnce({ content: JSON.stringify([AGENT_ID]) })
        .mockResolvedValueOnce({ content: serialized })

      const result = await list(APP_ID)
      expect(result[0].name).toBe(name)
      expect(result[0].description).toBe(description)
      expect(result[0].prompt).toBe(prompt)
    })
  })

  describe('#create', () => {
    it('writes the automation file and updates the index', async () => {
      mockReadFile
        .mockResolvedValueOnce({ content: '[]' })
        .mockResolvedValueOnce({ content: JSON.stringify([AGENT_ID]) })

      const result = await create(APP_ID, AUTOMATION_DATA)

      expect(result).toMatchObject({ id: AGENT_ID, ...AUTOMATION_DATA })
      expect(mockWriteFile).toHaveBeenCalledWith(APP_ID, FILE_PATH, expect.stringContaining(AUTOMATION_DATA.name))
      expect(mockWriteFile).toHaveBeenCalledWith(APP_ID, INDEX_PATH, expect.stringContaining(AGENT_ID))
    })

    it('appends to existing index', async () => {
      mockReadFile
        .mockResolvedValueOnce({ content: JSON.stringify(['existing-id']) })
        .mockResolvedValueOnce({ content: JSON.stringify(['existing-id', AGENT_ID]) })

      await create(APP_ID, AUTOMATION_DATA)

      const indexWrite = mockWriteFile.mock.calls.find(([, path]) => path === INDEX_PATH)
      const written = JSON.parse(indexWrite![2] as string)
      expect(written).toEqual(['existing-id', AGENT_ID])
    })

    it('propagates write errors', async () => {
      mockReadFile.mockResolvedValue({ content: '[]' })
      mockWriteFile.mockRejectedValue(new Error('disk full'))

      await expect(create(APP_ID, AUTOMATION_DATA)).rejects.toThrow('disk full')
    })

    it('tombstones the file and re-throws when the index update fails', async () => {
      mockReadFile.mockResolvedValue({ content: '[]' })
      mockWriteFile
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('index write failed'))

      await expect(create(APP_ID, AUTOMATION_DATA)).rejects.toThrow('index write failed')
      expect(mockWriteFile).toHaveBeenCalledWith(APP_ID, FILE_PATH, '')
    })

    it('silences a failing tombstone write and still re-throws the original index error', async () => {
      mockReadFile.mockResolvedValue({ content: '[]' })
      mockWriteFile
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('index write failed'))
        .mockRejectedValueOnce(new Error('tombstone write failed'))

      await expect(create(APP_ID, AUTOMATION_DATA)).rejects.toThrow('index write failed')
      expect(mockWriteFile).toHaveBeenCalledWith(APP_ID, FILE_PATH, '')
    })
  })

  describe('#update', () => {
    it('overwrites the file content and returns updated automation', async () => {
      const updated = { name: 'Updated', description: 'New desc', prompt: 'New prompt' }

      const result = await update(APP_ID, AGENT_ID, updated)

      expect(result).toMatchObject({ id: AGENT_ID, ...updated })
      expect(mockWriteFile).toHaveBeenCalledWith(APP_ID, FILE_PATH, expect.stringContaining('Updated'))
    })

    it('propagates write errors', async () => {
      mockWriteFile.mockRejectedValue(new Error('network error'))

      await expect(update(APP_ID, AGENT_ID, AUTOMATION_DATA)).rejects.toThrow('network error')
    })
  })

  describe('#remove', () => {
    it('clears the file and removes id from index', async () => {
      mockReadFile.mockResolvedValue({ content: JSON.stringify([AGENT_ID, 'other-id']) })

      await remove(APP_ID, AGENT_ID)

      expect(mockWriteFile).toHaveBeenCalledWith(APP_ID, FILE_PATH, '')
      const indexWrite = mockWriteFile.mock.calls.find(([, path]) => path === INDEX_PATH)
      const written = JSON.parse(indexWrite![2] as string)
      expect(written).toEqual(['other-id'])
    })

    it('propagates write errors', async () => {
      mockWriteFile.mockRejectedValue(new Error('permission denied'))

      await expect(remove(APP_ID, AGENT_ID)).rejects.toThrow('permission denied')
    })
  })
})
