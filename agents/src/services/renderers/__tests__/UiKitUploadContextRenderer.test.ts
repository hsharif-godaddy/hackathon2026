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

import { UiKitUploadContextRenderer } from '../UiKitUploadContextRenderer.js'
import type { ContextAttachment } from '@airo/shared/context-attachment'
import { UI_KIT_COPY_GUARDRAIL } from '../../../prompts/ui-kit-guardrail.js'

describe('UiKitUploadContextRenderer', () => {
  let appPath: string

  beforeEach(() => {
    appPath = mkdtempSync(join(tmpdir(), 'uikit-upload-'))
    const primitives = join(appPath, 'docs', 'ui-kit', 'primitives')
    mkdirSync(primitives, { recursive: true })
    writeFileSync(join(primitives, 'buttons.md'), '# Buttons\nPrimary, secondary.')
  })

  afterEach(() => {
    rmSync(appPath, { recursive: true, force: true })
  })

  it('injects the copy-reuse guardrail in the uploaded-kit context', () => {
    const renderer = new UiKitUploadContextRenderer()
    const attachment = { type: 'ui_kit_upload' } as unknown as ContextAttachment

    const result = renderer.render(attachment, '', { appPath })

    expect(result).not.toBeNull()
    expect(result!.content).toContain('# UI Kit — Design System Reference')
    expect(result!.content).toContain('## primitives/buttons.md')
    // Copy-reuse guardrail injected verbatim from the single shared source.
    expect(result!.content).toContain(UI_KIT_COPY_GUARDRAIL)
  })
})
