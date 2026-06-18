/**
 * @vitest-environment jsdom
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasMaliciousContent } from '@/lib/file/validation'
import { detectAppBuilderApp, detectUiKit } from '@/lib/zip-extract'
import { processDesignFile, processDesignFiles, ProcessFileErrorReason } from './design-file-processing'
import { FileReadError, FileTooLargeError, MaliciousContentError } from './errors'
import type { UploadedDesignFile } from '../types'

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

vi.mock('@/lib/file/validation', () => ({
  hasMaliciousContent: vi.fn().mockReturnValue(false),
}))

function createFile(name: string, content: string, size?: number): File {
  const blob = new Blob([content], { type: 'text/plain' })
  const file = new File([blob], name)
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size })
  }
  return file
}

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

function createImageFile(name: string, sizeBytes: number): File {
  const blob = new Blob([PNG_MAGIC], { type: 'image/png' })
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


describe('processDesignFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('processes a plain text file', async () => {
    const file = createFile('readme.txt', 'hello world')
    const result = await processDesignFile(file)
    expect(result.name).toBe('readme.txt')
    expect(result.content).toBe('hello world')
    expect(result.isDesignMd).  toBe(false)
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

  it('does not detect design.md when frontmatter has no closing delimiter', async () => {
    const content = '---\ncolors:\n  primary: "#000"\n' // starts with --- but never closes
    const file = createFile('design.md', content)
    const result = await processDesignFile(file)
    expect(result.isDesignMd).toBe(false)
  })

  it('throws FileTooLargeError for oversized text files', async () => {
    const file = createFile('big.txt', 'x', 2 * 1024 * 1024)
    await expect(processDesignFile(file)).rejects.toThrow(FileTooLargeError)
  })

  it('throws FileTooLargeError for oversized images', async () => {
    const file = createOversizedImage('huge.png')
    await expect(processDesignFile(file)).rejects.toThrow(FileTooLargeError)
  })

  it('throws MaliciousContentError when hasMaliciousContent detects a threat', async () => {
    vi.mocked(hasMaliciousContent).mockReturnValueOnce(true)
    const file = createFile('evil.svg', '<svg><script>alert(1)</script></svg>')
    await expect(processDesignFile(file)).rejects.toThrow(MaliciousContentError)
  })

  it('throws FileReadError when arrayBuffer() fails', async () => {
    const file = createFile('broken.txt', 'content')
    vi.spyOn(file, 'arrayBuffer').mockRejectedValueOnce(new Error('disk error'))
    await expect(processDesignFile(file)).rejects.toThrow(FileReadError)
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

  it('sets isUiKit when detectUiKit returns true', async () => {
    vi.mocked(detectUiKit).mockResolvedValueOnce(true)
    const file = new File([new ArrayBuffer(100)], 'ui-kit.zip')
    Object.defineProperty(file, 'size', { value: 100 })
    const result = await processDesignFile(file)
    expect(result.isUiKit).toBe(true)
    expect(result.isAppImport).toBe(false)
  })

  it('sets isAppImport when detectAppBuilderApp returns true', async () => {
    vi.mocked(detectAppBuilderApp).mockResolvedValueOnce(true)
    const file = new File([new ArrayBuffer(100)], 'myapp.zip')
    Object.defineProperty(file, 'size', { value: 100 })
    const result = await processDesignFile(file)
    expect(result.isUiKit).toBe(false)
    expect(result.isAppImport).toBe(true)
  })
})

describe('processDesignFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes multiple files sequentially', async () => {
    const files = [createFile('a.txt', 'aaa'), createFile('b.txt', 'bbb')]
    const result = await processDesignFiles(files, [], { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.processed).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
  })

  it('enforces maxFiles including current files', async () => {
    const current: UploadedDesignFile[] = Array.from({ length: 4 }, (_, i) => ({
      name: `existing-${i}.txt`, content: '', isDesignMd: false,
    }))
    const files = [createFile('a.txt', 'a'), createFile('b.txt', 'b')]
    const result = await processDesignFiles(files, current, { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.processed).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.MaxFiles)
    expect(result.errors[0].message.params).toMatchObject({ max: 5 })
  })

  it('enforces maxTotalBytes via file.size pre-check', async () => {
    const largeFile = createImageFile('big.png', 15 * 1024 * 1024)
    const current: UploadedDesignFile[] = [{
      name: 'existing.png', content: '', isDesignMd: false, isImage: true,
      zipRaw: new ArrayBuffer(10 * 1024 * 1024),
    }]
    const result = await processDesignFiles([largeFile], current, { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.processed).toHaveLength(0)
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.TotalSize)
  })

  it('formats TotalSize error with KB unit when maxTotalBytes is less than 1 MB', async () => {
    const file = createImageFile('big.png', 600 * 1024)
    const result = await processDesignFiles([file], [], { maxFiles: 5, maxTotalBytes: 500 * 1024 })
    expect(result.processed).toHaveLength(0)
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.TotalSize)
    expect(result.errors[0].message.params).toMatchObject({ limit: '500KB' })
  })

  it('rejects the 6th file using the internal default of 5', async () => {
    const current: UploadedDesignFile[] = Array.from({ length: 5 }, (_, i) => ({
      name: `existing-${i}.txt`, content: '', isDesignMd: false,
    }))
    const result = await processDesignFiles([createFile('extra.txt', 'x')], current)
    expect(result.processed).toHaveLength(0)
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.MaxFiles)
  })

  it('rejects a file that would exceed the internal 50 MB total default', async () => {
    const current: UploadedDesignFile[] = [{
      name: 'big.png', content: '', isDesignMd: false, isImage: true,
      zipRaw: new ArrayBuffer(40 * 1024 * 1024),
    }]
    const largeFile = createImageFile('another.png', 15 * 1024 * 1024)
    const result = await processDesignFiles([largeFile], current)
    expect(result.processed).toHaveLength(0)
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.TotalSize)
  })

  it('maps FileReadError to ReadFailed and continues', async () => {
    const broken = createFile('broken.txt', 'content')
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValueOnce(new Error('disk error'))
    const good = createFile('ok.txt', 'fine')
    const result = await processDesignFiles([broken, good], [], { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.processed).toHaveLength(1)
    expect(result.processed[0].name).toBe('ok.txt')
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.ReadFailed)
    expect(result.errors[0].fileName).toBe('broken.txt')
  })

  it('maps unknown errors to ProcessFailed and continues', async () => {
    const bad = createFile('bad.txt', 'content')
    const good = createFile('ok.txt', 'fine')
    vi.mocked(hasMaliciousContent).mockImplementationOnce(() => { throw new Error('unexpected crash') })
    const result = await processDesignFiles([bad, good], [], { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.processed).toHaveLength(1)
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.ProcessFailed)
    expect(result.errors[0].fileName).toBe('bad.txt')
  })

  it('collects errors from individually failing files without stopping', async () => {
    const good = createFile('ok.txt', 'fine')
    const tooBig = createFile('bad.txt', 'x', 2 * 1024 * 1024)
    const result = await processDesignFiles([tooBig, good], [], { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.processed).toHaveLength(1)
    expect(result.processed[0].name).toBe('ok.txt')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.TooLarge)
    expect(result.errors[0].fileName).toBe('bad.txt')
  })

  it('collects MaliciousContentError with structured error and stops that file', async () => {
    vi.mocked(hasMaliciousContent).mockReturnValueOnce(true)
    const malicious = createFile('virus.txt', 'bad')
    const clean = createFile('ok.txt', 'fine')
    const result = await processDesignFiles([malicious, clean], [], { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.processed).toHaveLength(1)
    expect(result.processed[0].name).toBe('ok.txt')
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.MaliciousContent)
    expect(result.errors[0].fileName).toBe('virus.txt')
  })

  it('sets malicious_content key when client-side validation blocks a file', async () => {
    vi.mocked(hasMaliciousContent).mockReturnValueOnce(true)
    const malicious = createFile('evil.svg', '<svg><script>alert(1)</script></svg>')
    const clean = createFile('safe.txt', 'ok')
    const result = await processDesignFiles([malicious, clean], [], { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.errors[0].error).toBe(ProcessFileErrorReason.MaliciousContent)
    expect(result.errors[0].fileName).toBe('evil.svg')
    expect(result.processed).toHaveLength(1)
    expect(result.processed[0].name).toBe('safe.txt')
  })

  it('does not produce MaliciousContent error for non-malicious errors', async () => {
    const tooBig = createFile('big.txt', 'x', 2 * 1024 * 1024)
    const result = await processDesignFiles([tooBig], [], { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).not.toBe(ProcessFileErrorReason.MaliciousContent)
  })
})
