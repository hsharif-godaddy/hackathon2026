/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  FILE_NAME_DISPLAY_MAX_LENGTH,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  truncateFileName,
  validate,
  validateForStaging,
} from '@/utils/file-upload-validation'

const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key

describe('#truncateFileName', function truncateFileNameTests() {
  it('returns short names unchanged', function shortName() {
    expect(truncateFileName('photo.jpg')).toBe('photo.jpg')
  })

  it('truncates long names with middle ellipsis', function longName() {
    const long = 'Screenshot 2026-06-01 at 3.45.32 PM Screenshot 2026-06-01 at 3.45.32 PM.png'
    const result = truncateFileName(long)
    expect(result.length).toBe(FILE_NAME_DISPLAY_MAX_LENGTH)
    expect(result).toContain('…')
    expect(result.startsWith('Screenshot')).toBe(true)
    expect(result.endsWith('.png')).toBe(true)
  })
})

describe('validateForStaging', () => {
  it('allows more than MAX_FILES_PER_UPLOAD when each file is within size limit', () => {
    const files = Array.from({ length: 8 }, (_, i) =>
      new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' })
    )
    expect(validateForStaging(files, t)).toBeNull()
  })

  it('rejects oversized files', () => {
    const big = new File([new ArrayBuffer(MAX_FILE_SIZE + 1)], 'huge.jpg', { type: 'image/jpeg' })
    expect(validateForStaging([big], t)).toContain('builder_chatfiles_error_file_too_large')
  })

  it('truncates long filenames in size-limit error message', function longFilename() {
    const longName =
      'Screenshot 2026-06-01 at 3.45.32 PM Screenshot 2026-06-01 at 3.45.32 PM.png'
    const big = new File([new ArrayBuffer(MAX_FILE_SIZE + 1)], longName, { type: 'image/png' })
    const message = validateForStaging([big], t)
    expect(message).toContain('builder_chatfiles_error_file_too_large')
    expect(message).toContain(truncateFileName(longName))
    expect(message).not.toContain(longName)
  })
})

describe('validate', () => {
  it('rejects more than MAX_FILES_PER_UPLOAD files in one batch', () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, i) =>
      new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' })
    )
    expect(validate(files, t)).toContain('builder_chatfiles_error_max_files')
  })
})
