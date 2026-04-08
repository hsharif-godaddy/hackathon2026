/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD, validate, validateForStaging } from '@/utils/file-upload-validation'

const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key

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
})

describe('validate', () => {
  it('rejects more than MAX_FILES_PER_UPLOAD files in one batch', () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, i) =>
      new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' })
    )
    expect(validate(files, t)).toContain('builder_chatfiles_error_max_files')
  })
})
