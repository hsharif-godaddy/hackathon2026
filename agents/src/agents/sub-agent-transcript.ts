import type { ModelMessage } from 'ai'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isSuccessfulEditResult } from '../tools/text-editor-workspace.js'

const MAX_TRANSCRIPT_TOKENS = 150_000
const CHARS_PER_TOKEN = 4

export interface FileAccess {
  path: string
  mtime: number
}

interface StepToolEntry {
  toolName: string
  // AI SDK v6 exposes tool-call arguments under `input` (results under `output`).
  // `args`/`result` are legacy v4 shapes kept as a fallback.
  input?: Record<string, unknown>
  args?: Record<string, unknown>
  result?: unknown
  output?: unknown
}

interface StepWithResponse {
  response: { messages: ModelMessage[] }
  toolCalls?: StepToolEntry[]
  toolResults?: StepToolEntry[]
}

const READ_TOOL_NAMES = new Set(['readFile', 'directoryListing'])
/** Tools that write files — used for staleness tracking and artifact extraction. */
export const WRITE_TOOL_NAMES = new Set(['writeFile', 'str_replace_based_edit_tool', 'fileEdit'])
const TEXT_EDITOR_TOOL = 'str_replace_based_edit_tool'
// Keep in sync with the str_replace_based_edit_tool command enum in tools/ai-lib-tools/text-editor.ts.
// `view` is read-only; the commands below mutate files.
const TEXT_EDITOR_WRITE_COMMANDS = new Set(['str_replace', 'insert', 'create'])

function textEditorMatchesMode(command: string | undefined, mode: 'read' | 'write'): boolean {
  if (mode === 'read') return command === 'view'
  // Legacy transcript fixtures predate the command field; preserve their write classification.
  return command === undefined || TEXT_EDITOR_WRITE_COMMANDS.has(command)
}

// NOTE: The AI SDK accumulates response messages — the LAST step's `response.messages`
// already contains every assistant/tool message from the entire run, so taking only the
// last step here is complete, not lossy.
export function extractTranscript(steps: StepWithResponse[], originalTask: string): ModelMessage[] {
  if (!steps || steps.length === 0) return []
  const lastStep = steps[steps.length - 1]
  if (!lastStep?.response?.messages) return []
  return [
    { role: 'user', content: [{ type: 'text', text: originalTask }] } as ModelMessage,
    ...lastStep.response.messages,
  ]
}

/**
 * Collect the files a run read or wrote from its steps.
 *
 * `confirmedOnly` (write mode) additionally requires the text editor to have
 * reported success, so a failed/no-op edit is excluded — its `create`
 * skip-branches (no matching upload, file left unchanged) return a non-success
 * status string without writing. Use it when the result feeds artifact reporting
 * (a claimed produced file must be real); leave it off for staleness tracking,
 * where over-inclusion is harmless and under-inclusion would skip a re-read.
 */
export function extractFileAccess(
  steps: StepWithResponse[],
  mode: 'read' | 'write',
  options?: { confirmedOnly?: boolean },
): FileAccess[] {
  const toolNames = mode === 'read' ? READ_TOOL_NAMES : WRITE_TOOL_NAMES
  const now = Date.now()
  const accesses: FileAccess[] = []
  const seen = new Set<string>()
  for (const step of steps) {
    const calls = step.toolResults ?? step.toolCalls ?? []
    for (const call of calls) {
      // AI SDK v6 puts arguments on `input`; fall back to legacy `args`.
      const args = (call.input ?? call.args) as Record<string, unknown> | undefined
      const isTextEditor: boolean = call.toolName === TEXT_EDITOR_TOOL
      const command = typeof args?.command === 'string' ? args.command.toLowerCase() : undefined
      const matchesMode: boolean = isTextEditor
        ? textEditorMatchesMode(command, mode)
        : toolNames.has(call.toolName)
      // Confirmed-write gate (artifact reporting only). Scoped to the text editor
      // because it is the only registered write tool that returns a status STRING
      // rather than a structured `{ path }` result — so a real write can be told
      // from a no-op/failed one only by matching its success message. The other
      // WRITE_TOOL_NAMES entries (writeFile, fileEdit) return a structured result
      // and are success-gated by the result-based `extractArtifacts` pass instead;
      // note that `extractFileAccess` reads the path from INPUT for those too, so on
      // this input-based path they are currently left ungated. They aren't wired
      // into any sub-agent toolset today; if one ever is, add a per-tool success
      // check here so a failed write can't be reported as a produced file.
      const confirmed: boolean = !(options?.confirmedOnly && isTextEditor && mode === 'write')
        || isSuccessfulEditResult(call.output ?? call.result)

      if (matchesMode && confirmed) {
        const path = (args?.path as string) ?? (args?.file_path as string)
        if (path && !seen.has(path)) {
          seen.add(path)
          accesses.push({ path, mtime: now })
        }
      }
    }
  }
  return accesses
}

export function truncateTranscript(messages: ModelMessage[]): ModelMessage[] {
  const estimatedTokens = estimateTokenCount(messages)
  if (estimatedTokens <= MAX_TRANSCRIPT_TOKENS) return messages

  const turnStarts = findTurnBoundaries(messages)
  const KEEP_RECENT = 2
  if (turnStarts.length <= KEEP_RECENT + 1) return messages

  const firstTurnEnd = turnStarts[1] ?? messages.length
  const recentStart = turnStarts[turnStarts.length - KEEP_RECENT]

  return [
    ...messages.slice(0, firstTurnEnd),
    {
      role: 'user',
      content: [{ type: 'text', text: '[Earlier conversation turns omitted. Continue from your most recent state.]' }],
    } as ModelMessage,
    ...messages.slice(recentStart),
  ]
}

export async function detectStaleFiles(accesses: FileAccess[], appPath: string): Promise<string[]> {
  // stat() every accessed file in parallel — one round-trip instead of N serial
  // awaits, which matters on re-entry where a session may have touched many files.
  const checks = await Promise.all(
    accesses.map(async ({ path, mtime }) => {
      try {
        const fileStat = await stat(resolve(appPath, path))
        return fileStat.mtimeMs > mtime ? path : null
      } catch {
        // Intentional: if the file can't be stat'd (missing/unreadable), treat it as stale so
        // the agent is told to re-read rather than trust a possibly-invalid cached read.
        return path
      }
    }),
  )
  return checks.filter((p): p is string => p !== null)
}

function findTurnBoundaries(messages: ModelMessage[]): number[] {
  const boundaries: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') boundaries.push(i)
  }
  return boundaries
}

function estimateTokenCount(messages: ModelMessage[]): number {
  let totalChars = 0
  for (const msg of messages) {
    totalChars += JSON.stringify(msg.content).length
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN)
}
