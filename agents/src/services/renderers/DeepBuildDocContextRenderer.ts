import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { logger } from '../../logging/index.js'
import { sanitizeUploadFileNameForDisplay } from '../upload-handling-guidance.js'
import { createForWorkspace } from '../../workspace/index.js'

const appRepo = new AppRepository()

type DocStage = 'interview' | 'business-details'

interface DocSlot {
  path: string
  stage: DocStage
}

// v1 scope: brief + business-details only. design.md is intentionally excluded
// (reusing it also requires regenerating globals.css/brand-data/preview).
const SLOTS: Record<'brief' | 'business-details', DocSlot> = {
  brief: { path: 'docs/brief.md', stage: 'interview' },
  'business-details': { path: 'docs/business-details.md', stage: 'business-details' },
}

/**
 * Flexible filename match: stems are matched against known slot bases.
 * A base matches when the stem equals it exactly or is followed by a separator
 * character (hyphen `-`, underscore `_`, or space). This means `brief-yoga`
 * matches `brief`, but `briefing` does not.
 */
function matchSlot(fileName: string): { key: keyof typeof SLOTS; slot: DocSlot } | null {
  const stem: string = fileName.replace(/\.[^.]+$/, '').toLowerCase().trim()
  const matches = (base: string): boolean =>
    stem === base || stem.startsWith(`${base}-`) || stem.startsWith(`${base}_`) || stem.startsWith(`${base} `)

  if (matches('brief')) return { key: 'brief', slot: SLOTS.brief }
  if (matches('business-details') || matches('business')) {
    return { key: 'business-details', slot: SLOTS['business-details'] }
  }
  return null
}

/**
 * Routes prior-session documents uploaded in Deep Build mode to their canonical
 * paths (e.g. `brief-yoga.md` → `docs/brief.md`) so the orchestrator can reuse
 * them and skip the stage that would have produced each. Deterministic — no LLM
 * classification — which is what makes Deep Build evals repeatable.
 *
 * Files are already on disk at `docs/<originalName>` courtesy of the agents
 * `/upload` route (persistUploadsToDocs in `files.ts`); this renderer copies
 * each into its canonical slot and emits a note telling the orchestrator which
 * stages are already complete.
 */
export class DeepBuildDocContextRenderer implements ContextAttachmentRenderer {
  canHandle(type: string): boolean {
    return type === 'deep_build_doc'
  }

  async render(
    attachment: ContextAttachment,
    _userPrompt: string,
    context?: {
      appId?: string
      appPath?: string
      conversationId?: string
    }
  ): Promise<RenderedContext | null> {
    const rawData = attachment.data as { files?: Array<{ name: string }> } | undefined
    const files = rawData?.files?.filter((f): f is { name: string } => Boolean(f?.name)) ?? []
    if (files.length === 0) return null

    const appId: string | undefined = context?.appId
    const app = appId ? appRepo.findById(appId) : null
    const appPath: string | undefined = app?.path || context?.appPath
    if (!appId || !appPath) {
      logger.warn('context.renderer.deep_build_doc.no_app_path', { appId })
      return {
        content: 'Deep Build doc reuse was attempted but the workspace could not be resolved. The orchestrator should proceed with a fresh interview.',
        role: 'user',
        insertionOrder: 'after_history',
      }
    }

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      logger.warn('context.renderer.deep_build_doc.workspace_unavailable', { appId })
      return {
        content: files.map(f => `Document "${sanitizeUploadFileNameForDisplay(f.name)}" was uploaded but the workspace is unavailable.`).join('\n'),
        role: 'user',
        insertionOrder: 'after_history',
      }
    }

    const seeded: Array<{ slot: DocSlot; from: string }> = []
    const seedFailed: Array<{ from: string; reason: string }> = []
    const unmatched: string[] = []

    for (const file of files) {
      const match = matchSlot(file.name)
      if (!match) {
        unmatched.push(file.name)
        continue
      }
      try {
        const content: string = await workspace.files.readText({ path: `docs/${file.name}` })
        await workspace.files.write({ path: match.slot.path, content })
        seeded.push({ slot: match.slot, from: file.name })
        logger.info('context.renderer.deep_build_doc.seeded', {
          appId, from: file.name, to: match.slot.path, stage: match.slot.stage,
        })
      } catch (err) {
        const reason: string = err instanceof Error ? err.message : String(err)
        logger.warn('context.renderer.deep_build_doc.seed_failed', {
          appId, fileName: file.name, error: reason,
        })
        seedFailed.push({ from: file.name, reason })
      }
    }

    return {
      content: this.buildNote(seeded, seedFailed, unmatched),
      role: 'user',
      insertionOrder: 'after_history',
    }
  }

  private buildNote(
    seeded: Array<{ slot: DocSlot; from: string }>,
    seedFailed: Array<{ from: string; reason: string }>,
    unmatched: string[],
  ): string {
    const lines: string[] = ['# Deep Build — Reused Documents', '']

    if (seeded.length > 0) {
      lines.push('Prior-session documents were uploaded and seeded into this project:')
      for (const { slot, from } of seeded) {
        const safeName: string = sanitizeUploadFileNameForDisplay(from)
        lines.push(`- \`${slot.path}\` (from \`${safeName}\`) — the **${slot.stage}** stage is already complete.`)
      }
      lines.push('')
      lines.push('Do NOT re-run these completed stages. Read the existing documents and proceed per your decision loop.')
    } else {
      lines.push('No uploaded documents matched a known Deep Build slot (brief, business-details).')
    }

    if (seedFailed.length > 0) {
      lines.push('')
      lines.push('Failed to seed (matched a slot but could not read/write):')
      for (const { from, reason } of seedFailed) {
        const safeName: string = sanitizeUploadFileNameForDisplay(from)
        lines.push(`- \`${safeName}\`: ${reason}`)
      }
      lines.push('')
      lines.push('These stages should be treated as incomplete — run them normally.')
    }

    if (unmatched.length > 0) {
      lines.push('')
      lines.push(`Unmatched (ignored): ${unmatched.map(n => `\`${sanitizeUploadFileNameForDisplay(n)}\``).join(', ')}`)
    }

    return lines.join('\n')
  }
}
