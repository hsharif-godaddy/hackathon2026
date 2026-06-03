/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { FileReadError, FileTooLargeError, processDesignFile, processDesignFiles } from './design-file-processing'
import type { UploadedDesignFile } from './types'

// jsdom's File/Blob don't implement arrayBuffer() — polyfill via FileReader for these tests
beforeAll(() => {
  if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

vi.mock('@/lib/zip-extract', () => ({
  detectUiKit: vi.fn().mockResolvedValue(false),
  detectAppBuilderApp: vi.fn().mockResolvedValue(false),
}))

function createFile(name: string, content: string, size?: number): File {
  const blob = new Blob([content], { type: 'text/plain' })
  const file = new File([blob], name)
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size })
  }
  return file
}

function createImageFile(name: string, sizeBytes: number): File {
  const buffer = new ArrayBuffer(sizeBytes)
  const blob = new Blob([buffer], { type: 'image/png' })
  const file = new File([blob], name)
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

// Size-override only (no real buffer): produces a file whose size exceeds a
// limit while staying tiny in memory, so the limit check short-circuits before
// arrayBuffer() and we never trigger a multi-MB jsdom FileReader read.
function createOversizedImage(name: string): File {
  const file = new File([new ArrayBuffer(1)], name)
  Object.defineProperty(file, 'size', { value: 21 * 1024 * 1024 })
  return file
}

// Stub translate fn mirroring the en-US defaults so message assertions hold
// without depending on the i18n package.
const t = (key: string, values?: Record<string, string | number>): string => {
  const messages: Record<string, string> = {
    builder_design_file_upload_error_exceeds_limit: `File "${values?.name}" exceeds the ${values?.limit} limit`,
    builder_design_file_upload_error_read_failed: `Failed to read file "${values?.name}"`,
    builder_design_file_upload_error_max_files: `Maximum ${values?.max} files allowed`,
    builder_design_file_upload_error_total_size: `Total file size cannot exceed ${values?.limit}`,
    builder_design_file_upload_error_process_failed: `Failed to process "${values?.name}"`,
  }
  return messages[key] ?? key
}

describe('processDesignFile', () => {
  it('processes a plain text file', async () => {
    const file = createFile('readme.txt', 'hello world')
    const result = await processDesignFile(file)
    expect(result.name).toBe('readme.txt')
    expect(result.content).toBe('hello world')
    expect(result.isDesignMd).toBe(false)
    expect(result.isImage).toBeUndefined()
    expect(result.isZip).toBeUndefined()
  })

  it('detects design.md frontmatter', async () => {
    const content = '---\ncolors:\n  primary: "#000"\n---\n# My Design'
    const file = createFile('design.md', content)
    const result = await processDesignFile(file)
    expect(result.isDesignMd).toBe(true)
    expect(result.content).toBe(content)
  })

  it('detects image files by extension', async () => {
    const file = createImageFile('photo.png', 1024)
    const result = await processDesignFile(file)
    expect(result.isImage).toBe(true)
    expect(result.content).toBe('')
    expect(result.zipRaw).toBeDefined()
  })

  it('throws FileTooLargeError for oversized text files', async () => {
    const file = createFile('big.txt', 'x', 2 * 1024 * 1024)
    await expect(processDesignFile(file)).rejects.toThrow(FileTooLargeError)
  })

  it('throws FileTooLargeError for oversized images', async () => {
    const file = createOversizedImage('huge.png')
    await expect(processDesignFile(file)).rejects.toThrow(FileTooLargeError)
  })

  it('detects zip files and calls zip-extract utilities', async () => {
    const buffer = new ArrayBuffer(100)
    const blob = new Blob([buffer], { type: 'application/zip' })
    const file = new File([blob], 'project.zip')
    Object.defineProperty(file, 'size', { value: 100 })

    const result = await processDesignFile(file)
    expect(result.isZip).toBe(true)
    expect(result.content).toBe('')
    expect(result.zipRaw).toBeDefined()
  })

  it('throws FileTooLargeError for oversized zip files', async () => {
    const zipFile = new File([new ArrayBuffer(1)], 'huge.zip')
    Object.defineProperty(zipFile, 'size', { value: 11 * 1024 * 1024 })
    await expect(processDesignFile(zipFile)).rejects.toThrow(FileTooLargeError)
  })
})

describe('processDesignFiles', () => {
  it('processes multiple files sequentially', async () => {
    const files = [
      createFile('a.txt', 'aaa'),
      createFile('b.txt', 'bbb'),
    ]
    const result = await processDesignFiles(files, [], 5, 20 * 1024 * 1024, t)
    expect(result.processed).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
  })

  it('enforces maxFiles including current files', async () => {
    const current: UploadedDesignFile[] = Array.from({ length: 4 }, (_, i) => ({
      name: `existing-${i}.txt`, content: '', isDesignMd: false,
    }))
    const files = [createFile('a.txt', 'a'), createFile('b.txt', 'b')]
    const result = await processDesignFiles(files, current, 5, 20 * 1024 * 1024, t)
    expect(result.processed).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Maximum')
  })

  it('enforces maxTotalBytes via file.size pre-check', async () => {
    const largeFile = createImageFile('big.png', 15 * 1024 * 1024)
    const current: UploadedDesignFile[] = [{
      name: 'existing.png', content: '', isDesignMd: false, isImage: true,
      zipRaw: new ArrayBuffer(10 * 1024 * 1024),
    }]
    const result = await processDesignFiles([largeFile], current, 5, 20 * 1024 * 1024, t)
    expect(result.processed).toHaveLength(0)
    expect(result.errors[0]).toContain('size')
  })

  it('collects errors from individually failing files without stopping', async () => {
    const good = createFile('ok.txt', 'fine')
    const tooBig = createFile('bad.txt', 'x', 2 * 1024 * 1024)
    const result = await processDesignFiles([tooBig, good], [], 5, 20 * 1024 * 1024, t)
    expect(result.processed).toHaveLength(1)
    expect(result.processed[0].name).toBe('ok.txt')
    expect(result.errors).toHaveLength(1)
  })
})
