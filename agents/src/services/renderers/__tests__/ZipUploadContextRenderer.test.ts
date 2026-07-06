import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return { findById: vi.fn().mockReturnValue(null) }
  }),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { ZipUploadContextRenderer } from '../ZipUploadContextRenderer.js'
import type { ContextAttachment } from '@airo/shared/context-attachment'

describe('ZipUploadContextRenderer', () => {
  let appPath: string

  beforeEach(() => {
    appPath = mkdtempSync(join(tmpdir(), 'zip-upload-'))
  })

  afterEach(() => {
    rmSync(appPath, { recursive: true, force: true })
  })

  it('renders an explicit failure message when the attachment is flagged failed, without scanning disk', () => {
    // Write a file so a disk scan WOULD otherwise report success — the failed
    // flag must short-circuit before the scan (the app is scaffolded from a
    // base template, so src/ is never empty on a real failed import).
    mkdirSync(join(appPath, 'src'), { recursive: true })
    writeFileSync(join(appPath, 'src', 'main.tsx'), 'export {}')

    const renderer = new ZipUploadContextRenderer()
    const attachment = { type: 'app_import_upload', data: { failed: true } } as unknown as ContextAttachment

    const result = renderer.render(attachment, '', { appPath })

    expect(result).not.toBeNull()
    expect(result!.role).toBe('user')
    expect(result!.content).toContain('could not be imported')
    expect(result!.content).toContain('re-uploading the same file will not help')
    expect(result!.content).toContain('home/create screen')
    expect(result!.content).not.toContain('src/main.tsx')
  })

  it('lists imported files on the success path', () => {
    mkdirSync(join(appPath, 'src', 'pages'), { recursive: true })
    writeFileSync(join(appPath, 'src', 'pages', 'Home.tsx'), 'export {}')

    const renderer = new ZipUploadContextRenderer()
    const attachment = { type: 'app_import_upload', data: { failed: false } } as unknown as ContextAttachment

    const result = renderer.render(attachment, '', { appPath })

    expect(result).not.toBeNull()
    expect(result!.content).toContain('imported from a previously exported app')
    expect(result!.content).toContain('src/pages/Home.tsx')
  })

  it('reports a probable failure when no files were written to disk', () => {
    const renderer = new ZipUploadContextRenderer()
    const attachment = { type: 'app_import_upload', data: {} } as unknown as ContextAttachment

    const result = renderer.render(attachment, '', { appPath })

    expect(result).not.toBeNull()
    expect(result!.content).toContain('no files were found on disk')
  })
})
