import type { ModelMessage } from 'ai'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

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

export function extractFileAccess(steps: StepWithResponse[], mode: 'read' | 'write'): FileAccess[] {
  const toolNames = mode === 'read' ? READ_TOOL_NAMES : WRITE_TOOL_NAMES
  const now = Date.now()
  const accesses: FileAccess[] = []
  const seen = new Set<string>()
  for (const step of steps) {
    const calls = step.toolResults ?? step.toolCalls ?? []
    for (const call of calls) {
      if (toolNames.has(call.toolName)) {
        // AI SDK v6 puts arguments on `input`; fall back to legacy `args`.
        const args = (call.input ?? call.args) as Record<string, unknown> | undefined
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
