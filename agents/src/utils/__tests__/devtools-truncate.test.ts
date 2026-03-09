import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEVTOOLS_DB_MAX_BYTES,
  resetDevToolsCheck,
  truncateDevToolsDb
} from '../model-selection.js'

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  writeFile: vi.fn()
}))

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { stat, writeFile } from 'node:fs/promises'
import { logger } from '../../logging/index.js'

const expectedDbPath = path.join(process.cwd(), '.devtools', 'generations.json')

describe('truncateDevToolsDb', function truncateTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
    resetDevToolsCheck()
  })

  it('should do nothing when file does not exist', async function missingFile() {
    const error = new Error('ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    vi.mocked(stat).mockRejectedValue(error)

    await truncateDevToolsDb()

    expect(stat).toHaveBeenCalledWith(expectedDbPath)
    expect(writeFile).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should do nothing when file is under the size limit', async function underLimit() {
    vi.mocked(stat).mockResolvedValue({ size: DEVTOOLS_DB_MAX_BYTES - 1 } as any)

    await truncateDevToolsDb()

    expect(writeFile).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should reset file when it exceeds the size limit', async function overLimit() {
    vi.mocked(stat).mockResolvedValue({ size: 50 * 1024 * 1024 } as any)
    vi.mocked(writeFile).mockResolvedValue()

    await truncateDevToolsDb()

    expect(writeFile).toHaveBeenCalledWith(
      expectedDbPath,
      JSON.stringify({ runs: [], steps: [] }, null, 2)
    )
    expect(logger.warn).toHaveBeenCalledWith('devtools.db.truncate', expect.objectContaining({
      sizeMB: 50
    }))
    expect(logger.info).toHaveBeenCalledWith('devtools.db.truncated', { previousSizeMB: 50 })
  })

  it('should throw when writeFile fails on an oversized file', async function writeFail() {
    vi.mocked(stat).mockResolvedValue({ size: 50 * 1024 * 1024 } as any)
    vi.mocked(writeFile).mockRejectedValue(new Error('EACCES: permission denied'))

    await expect(truncateDevToolsDb()).rejects.toThrow('EACCES: permission denied')

    expect(logger.error).toHaveBeenCalledWith('devtools.db.truncate.failed', expect.objectContaining({
      error: 'EACCES: permission denied'
    }))
  })

  it('should log warning and continue when stat fails with non-ENOENT error', async function statFail() {
    const error = new Error('EPERM') as NodeJS.ErrnoException
    error.code = 'EPERM'
    vi.mocked(stat).mockRejectedValue(error)

    await truncateDevToolsDb()

    expect(writeFile).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('devtools.db.stat.failed', expect.objectContaining({
      error: 'EPERM'
    }))
  })

  it('should only run the check once across multiple calls', async function onceGuard() {
    vi.mocked(stat).mockResolvedValue({ size: 1024 } as any)

    await truncateDevToolsDb()
    await truncateDevToolsDb()
    await truncateDevToolsDb()

    expect(stat).toHaveBeenCalledTimes(1)
  })

  it('should retry on next call if writeFile failed', async function retryAfterFail() {
    vi.mocked(stat).mockResolvedValue({ size: 50 * 1024 * 1024 } as any)
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('disk full'))

    await expect(truncateDevToolsDb()).rejects.toThrow('disk full')

    vi.mocked(writeFile).mockResolvedValue()

    await truncateDevToolsDb()

    expect(stat).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith('devtools.db.truncated', expect.any(Object))
  })
})
