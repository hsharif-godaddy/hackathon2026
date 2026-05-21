'use client'

import clsx from 'clsx'
import { Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import Tag from '@ux/tag'

import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useTranslations } from '@/hooks/useTranslations'
import { useUserActionDiffQuery } from '@/hooks/useUserActionDiff'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

interface UserActionResultShape {
  action?: string
  commitHash?: string | null
  restoredCommitHash?: string | null
  stashHash?: string | null
  detail?: string
}

function asUserActionResult(result: DefaultToolRendererProps['result']): UserActionResultShape {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as UserActionResultShape
  }
  return {}
}

type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed'

interface FileSection {
  path: string
  oldPath: string | null
  changeType: ChangeType
  /** Raw hunk content (lines starting with @@ / context / + / -). Excludes the
   *  `diff --git`, `index`, `+++`, `---`, and rename headers — the file card's
   *  own header carries the path and change type already. */
  body: string
  added: number
  removed: number
}

const PATH_PREFIX_A = 'a/'
const PATH_PREFIX_B = 'b/'

function stripPathPrefix(value: string): string {
  if (value.startsWith(PATH_PREFIX_A)) return value.slice(PATH_PREFIX_A.length)
  if (value.startsWith(PATH_PREFIX_B)) return value.slice(PATH_PREFIX_B.length)
  return value
}

/**
 * Parse a unified-diff blob into one section per file. Each section knows its
 * change type (so the card can tag it) and carries only the hunk body — the
 * `diff --git` / `index` / `+++` / `---` headers are dropped because the file
 * card's own header reproduces the path and change type more legibly.
 *
 * Tolerant of edge cases: missing trailing newlines, sections without hunks
 * (pure renames), and either header order (`new file mode` before or after
 * the `index` line).
 */
function parseDiffByFile(diff: string): FileSection[] {
  if (!diff) return []
  const lines = diff.split('\n')
  const sections: FileSection[] = []

  let currentHeaders: string[] | null = null
  let currentBody: string[] = []
  let currentDiffLine = ''

  function flush() {
    if (!currentHeaders) return
    sections.push(buildFileSection(currentDiffLine, currentHeaders, currentBody))
    currentHeaders = null
    currentBody = []
    currentDiffLine = ''
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      currentDiffLine = line
      currentHeaders = []
      currentBody = []
      continue
    }
    if (currentHeaders === null) continue
    // Once we hit the first hunk marker every subsequent line belongs to the
    // body until the next file boundary.
    if (currentBody.length > 0 || line.startsWith('@@')) {
      currentBody.push(line)
    } else {
      currentHeaders.push(line)
    }
  }
  flush()
  return sections
}

function buildFileSection(diffLine: string, headers: string[], body: string[]): FileSection {
  let changeType: ChangeType = 'modified'
  let path = ''
  let oldPath: string | null = null

  for (const header of headers) {
    if (header.startsWith('new file ')) changeType = 'added'
    else if (header.startsWith('deleted file ')) changeType = 'deleted'
    else if (header.startsWith('rename from ')) {
      changeType = 'renamed'
      oldPath = header.slice('rename from '.length).trim()
    } else if (header.startsWith('rename to ')) {
      path = header.slice('rename to '.length).trim()
    }
  }

  if (!path) {
    const plus = headers.find(h => h.startsWith('+++ '))
    if (plus && plus !== '+++ /dev/null') {
      path = stripPathPrefix(plus.slice('+++ '.length).trim())
    }
  }
  if (!path) {
    const minus = headers.find(h => h.startsWith('--- '))
    if (minus && minus !== '--- /dev/null') {
      path = stripPathPrefix(minus.slice('--- '.length).trim())
    }
  }
  if (!path) {
    // Last-resort: parse "diff --git a/foo b/bar" — `b/bar` is the post-image.
    const match = diffLine.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (match) path = match[2]
  }

  body = body
    .filter(line => !line.startsWith("@@") && !line.endsWith("@@"))
    .filter(line => !line.startsWith("--- "))
    .filter(line => !line.startsWith("+++ "))
    .filter(line => !line.startsWith("\\ No newline at end of file"))

  let added = 0
  let removed = 0
  for (const line of body) {
    // Skip hunk headers and metadata-style "+++"/"---" that occasionally slip
    // into the body when the diff is malformed.
    if (line.startsWith('@@') || line.startsWith('+++ ') || line.startsWith('--- ')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }

  return {
    path,
    oldPath,
    changeType,
    body: body.join('\n'),
    added,
    removed,
  }
}

interface DiffLine {
  kind: 'add' | 'del' | 'context' | 'hunk'
  content: string
}

function classifyBodyLines(body: string): DiffLine[] {
  return body.split('\n').map<DiffLine>((line) => {
    if (line.startsWith('@@')) return { kind: 'hunk', content: line }
    if (line.startsWith('+')) return { kind: 'add', content: line }
    if (line.startsWith('-')) return { kind: 'del', content: line }
    return { kind: 'context', content: line }
  })
}

const CHANGE_TYPE_TAG: Record<ChangeType, { intent: 'success' | 'critical' | 'warning' | 'info'; labelKey: string; labelFallback: string }> = {
  added: { intent: 'success', labelKey: 'builder_chat_user_action_change_added', labelFallback: 'Created' },
  modified: { intent: 'info', labelKey: 'builder_chat_user_action_change_modified', labelFallback: 'Modified' },
  deleted: { intent: 'critical', labelKey: 'builder_chat_user_action_change_deleted', labelFallback: 'Deleted' },
  renamed: { intent: 'warning', labelKey: 'builder_chat_user_action_change_renamed', labelFallback: 'Renamed' },
}

function FileDiffCard({ file, t }: { file: FileSection; t: ReturnType<typeof useTranslations> }) {
  const lines = useMemo(() => classifyBodyLines(file.body), [file.body])
  const tag = CHANGE_TYPE_TAG[file.changeType]
  const tagLabel = t(tag.labelKey, undefined, tag.labelFallback)

  return (
    <div
      data-testid="user-action-file-card"
      data-change-type={file.changeType}
      className="rounded border border-intents-ux-box-borderColor overflow-hidden"
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor">
        <Tag emphasis={tag.intent} size="sm">{tagLabel}</Tag>
        <span data-testid="user-action-file-path" className="text-xs font-mono truncate">
          {file.changeType === 'renamed' && file.oldPath
            ? `${file.oldPath} → ${file.path}`
            : file.path}
        </span>
        {(file.added > 0 || file.removed > 0) && (
          <span className="ml-auto text-[11px] font-mono text-intents-ux-text-textSecondaryColor whitespace-nowrap">
            +{file.added} / -{file.removed}
          </span>
        )}
      </div>
      {file.body.trim().length > 0 && (
        <pre
          data-testid="user-action-file-diff"
          className="text-xs font-mono whitespace-pre overflow-auto p-2 max-h-[40vh]"
        >
          {lines.map((line, i) => (
            <span
              key={i}
              className={clsx('block', {
                'bg-intents-ux-feedbackHighContrastSuccess-backgroundColor/10 text-intents-ux-feedbackHighContrastSuccess-feedbackColor': line.kind === 'add',
                'bg-intents-ux-feedbackHighContrastCritical-backgroundColor/10 text-intents-ux-feedbackHighContrastCritical-feedbackColor': line.kind === 'del',
                'text-intents-ux-link-foregroundColor bg-intents-ux-actionHovered-backgroundColor/40': line.kind === 'hunk',
              })}
            >
              {line.content || ' '}
            </span>
          ))}
        </pre>
      )}
    </div>
  )
}

/**
 * Renderer for synthetic 'undo' and 'restore' user-action notices in the
 * transcript. Replaces the default JSON-dumping renderer with a compact
 * action card; clicking it opens a modal that shows the captured git diff
 * split into per-file cards. Each card has a change-type tag + path header
 * and a body that contains only the actual code changes (context + add +
 * del lines), modeled on FileEditToolRenderer's per-operation layout.
 *
 * The diff is fetched lazily from the agents service when the modal opens —
 * the persisted notice metadata only carries the relevant `commitHash` and
 * `stashHash`, so we hit `GET /apps/:id/git/diff` with those hashes and
 * render the combined unified diff returned by the route.
 *
 * The header is a single 'Restored to: "(commit message)"' format, falling
 * back to a generic 'Restored recent changes' when no target commit was
 * involved (e.g. stash-only undo on a dirty tree) or when the target commit
 * is older than the loaded history window. Hashes and stash details are
 * intentionally not surfaced in the user-facing label — they're not
 * meaningful to a customer reading their chat history.
 *
 * The commit message is computed at render time from `useGitHistoryQuery`
 * rather than persisted into the message metadata. The develop page already
 * keeps git history warm in the React Query cache (Version History panel,
 * StreamingMessageList commit pills), so this is normally a cache hit; it
 * also keeps the displayed subject in sync if the commit is later amended.
 */
export default function GitRestoreDiffRenderer({ toolName, result }: DefaultToolRendererProps) {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const data = asUserActionResult(result)

  const restoredCommitHash = data.restoredCommitHash ?? null

  // Look up the rewound-to commit's subject line from cached git history
  // instead of persisting it into the synthetic notice's metadata. The
  // develop page already drives this query (Version History, commit pills),
  // so the render is normally served from cache.
  const historyQuery = useGitHistoryQuery({
    appId,
    enabled: !!appId && !!restoredCommitHash,
  })
  const commitMessage = useMemo(() => {
    if (!restoredCommitHash) return null
    const match = historyQuery.data?.commits.find(c => c.hash === restoredCommitHash)
    const subject = match?.message?.trim()
    return subject && subject.length > 0 ? subject : null
  }, [historyQuery.data?.commits, restoredCommitHash])

  const headerLabel = commitMessage
    ? t(
        'builder_chat_user_action_restored_to',
        { message: commitMessage },
        `Restored to: "${commitMessage}"`,
      )
    : t('builder_chat_user_action_restored', undefined, 'Restored recent changes')

  const modalTitle = t('builder_chat_user_action_restore_modal_title', undefined, 'Restored changes')

  // Lazy fetch — only hits the agents service once the user opens the modal.
  // The (commitHash, stashHash) pair is immutable for a persisted notice,
  // so the query stays warm in cache between opens.
  const diffQuery = useUserActionDiffQuery({
    appId,
    commitHash: data.commitHash ?? undefined,
    stashHash: data.stashHash ?? undefined,
    enabled: isModalOpen,
  })

  const files = useMemo<FileSection[]>(
    () => (diffQuery.data?.diff ? parseDiffByFile(diffQuery.data.diff) : []),
    [diffQuery.data?.diff],
  )

  const summary = useMemo(() => {
    if (files.length === 0) return null
    return files.reduce(
      (acc, f) => ({
        files: acc.files + 1,
        added: acc.added + f.added,
        removed: acc.removed + f.removed,
      }),
      { files: 0, added: 0, removed: 0 },
    )
  }, [files])

  // Always offer the modal — the captured diff is the substantive part of
  // the card and is independent of whether a target commit was involved.
  const hasDiff = files.length > 0

  return (
    <div data-testid="user-action-restore">
      <ToolHeader
        icon={<Undo2 className="w-2 h-2" />}
        displayName={headerLabel}
        toolStatus="completed"
        hasDetails
        onOpenModal={() => setIsModalOpen(true)}
      />

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalTitle}
      >
        <div className="flex-1 overflow-y-auto space-y-2 min-w-0">
          {summary && (
            <p data-testid="user-action-summary" className="text-xs text-intents-ux-text-textSecondaryColor">
              {t(
                'builder_chat_user_action_diff_summary',
                { files: summary.files, added: summary.added, removed: summary.removed },
                `${summary.files} file${summary.files === 1 ? '' : 's'} · +${summary.added} / -${summary.removed}`,
              )}
            </p>
          )}

          {diffQuery.isLoading
            ? (
              <p data-testid="user-action-diff-loading" className="text-xs text-intents-ux-text-textSecondaryColor">
                {t('builder_chat_user_action_diff_loading', undefined, 'Loading changes…')}
              </p>
            )
            : diffQuery.isError
              ? (
                <p data-testid="user-action-diff-error" className="text-xs text-intents-ux-feedbackCritical-feedbackColor">
                  {t('builder_chat_user_action_diff_error', undefined, 'Could not load changes for this action.')}
                </p>
              )
              : hasDiff
                ? (
                  <div className="space-y-2">
                    {files.map((file, i) => (
                      <FileDiffCard key={`${file.path}-${i}`} file={file} t={t} />
                    ))}
                  </div>
                )
                : (
                  <p className="text-xs text-intents-ux-text-textSecondaryColor">
                    {t('builder_chat_user_action_no_diff', undefined, 'No changes were detected.')}
                  </p>
                )
          }
        </div>
      </ToolModal>

      {/* Hidden marker so tests can inspect what kind of action this is without */}
      {/* relying on translated strings. */}
      <span data-testid={`user-action-tool-name`} className="hidden">{toolName}</span>
    </div>
  )
}
