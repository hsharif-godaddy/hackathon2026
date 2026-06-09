import type { FormatOverrideTarget, FormatOverrideUpdateData, FormatOverrideUpdateResult } from '@/services/AppService'

type FormatOverrideReplyMessage =
  | { type: 'FORMAT_OVERRIDE_EDIT_SUCCEEDED'; commitId: string | undefined }
  | { type: 'FORMAT_OVERRIDE_EDIT_FAILED'; commitId: string | undefined; error: string }

const SUPPORTED_FORMAT_OVERRIDE_MARKS = new Set(['bold', 'italic', 'color'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isSourceKind(value: unknown): value is FormatOverrideTarget['sourceKind'] {
  return value === 'bound-expression' || value === 'content-key' || value === 'content-key-template'
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readFormatOverrideTarget(value: unknown): FormatOverrideTarget | null {
  if (!isRecord(value)) return null
  const { file, tagName, sourceKind } = value
  if (typeof file !== 'string' || typeof tagName !== 'string' || !isSourceKind(sourceKind)) return null

  const contentKey = optionalString(value.contentKey)
  const contentKeyTemplate = optionalString(value.contentKeyTemplate)
  const expressionHash = optionalString(value.expressionHash)

  if (sourceKind === 'bound-expression' && !expressionHash) return null
  if (sourceKind === 'content-key' && !contentKey) return null
  if (sourceKind === 'content-key-template' && !contentKeyTemplate) return null

  return {
    file,
    tagName,
    sourceKind,
    contentKey,
    contentKeyTemplate,
    expressionHash,
  }
}

function readFormatOverrideMarks(value: unknown): FormatOverrideUpdateData['marks'] | null {
  if (!isRecord(value)) return null
  if (Object.keys(value).some(key => !SUPPORTED_FORMAT_OVERRIDE_MARKS.has(key))) return null

  const { bold, italic, color } = value
  if (bold !== undefined && typeof bold !== 'boolean') return null
  if (italic !== undefined && typeof italic !== 'boolean') return null
  if (color !== undefined && color !== null && typeof color !== 'string') return null

  const boldMark = typeof bold === 'boolean' ? bold : undefined
  const italicMark = typeof italic === 'boolean' ? italic : undefined
  const colorMark: string | null | undefined = typeof color === 'string' ? color : color === null ? null : undefined
  const marks: FormatOverrideUpdateData['marks'] = {}
  if (boldMark !== undefined) marks.bold = boldMark
  if (italicMark !== undefined) marks.italic = italicMark
  if (colorMark !== undefined) marks.color = colorMark

  return marks
}

export function readFormatOverrideCommitId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return typeof value.commitId === 'string' ? value.commitId : undefined
}

export function parseFormatOverrideUpdateData(value: unknown): FormatOverrideUpdateData | null {
  if (!isRecord(value)) return null
  const { devId } = value
  const commitId = readFormatOverrideCommitId(value)
  if (value.commitId !== undefined && commitId === undefined) return null
  if (typeof devId !== 'string') return null

  const target = readFormatOverrideTarget(value.target)
  const marks = readFormatOverrideMarks(value.marks)
  if (!target || !marks) return null

  return {
    ...(commitId !== undefined ? { commitId } : {}),
    devId,
    target,
    marks,
  }
}

export function buildFormatOverrideReplyMessage(
  commitId: string | undefined,
  result: FormatOverrideUpdateResult,
): FormatOverrideReplyMessage {
  if (result.success === true) {
    return { type: 'FORMAT_OVERRIDE_EDIT_SUCCEEDED', commitId }
  }

  return {
    type: 'FORMAT_OVERRIDE_EDIT_FAILED',
    commitId,
    error: result.error,
  }
}
