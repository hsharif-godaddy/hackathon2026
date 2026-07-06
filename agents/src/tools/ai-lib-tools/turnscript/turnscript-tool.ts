import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { logger } from '../../../logging/index.js'
import type { TurnscriptFailureKind, TurnscriptResult } from './executor.js'
import { runTurnscriptInContainer } from './runner.js'
import { generateTurnscriptTypes } from './type-gen.js'

/**
 * Turnscript prototype spike — MAIN-TOOLS variant (the user's original main-tools idea).
 *
 * Exposes main's EXISTING develop tools — directoryListing / grepSearch / readFile /
 * str_replace_based_edit_tool — as a callable `turnscript.*` API. The model emits ONE
 * async orchestration script that calls these in a single turn; intermediate results
 * stay in the sandbox and only the script's returned summary re-enters LLM context.
 * This collapses the read→edit→read→edit round-trips (each an LLM inference) into one
 * inference, WITHOUT introducing any new tool implementations.
 *
 * Gated by a two-level config (see resolveTurnscriptEnabled in turnscript-context.ts).
 * When disabled, the develop agent is unchanged (plain main).
 *
 * When enabled, turnscript starts as the ONLY discovery/edit surface (preserving the
 * cost win of one orchestration script per turn); once a turnscript call reports a
 * recoverable failure within a conversation, the 4 direct tools (directoryListing /
 * grepSearch / readFile / str_replace_based_edit_tool) are ADMITTED for the remainder
 * of that conversation so the model can recover with a single-shot direct edit. The
 * per-conversation admit state lives in develop-agent.ts (afterToolExecution flips it;
 * the activeTools resolver reads it).
 */

// readFile / directoryListing / str_replace define their schemas inline on the tool
// def; mirror the shapes here purely for type-gen (the real guards live in execute()).
const readFileCodeSchema = z.object({
  path: z.string().describe('File path relative to app root'),
  startLine: z.number().int().min(1).optional().describe('Start line (1-indexed). Omit to read from line 1'),
  numLines: z.number().int().min(1).optional().describe('Line count from startLine. Omit to read to end'),
})

const directoryListingCodeSchema = z.object({
  path: z.string().optional().describe('Relative path within the app to list (default: root)'),
  directoriesOnly: z.boolean().optional().describe('Show only directories, not files'),
  pattern: z.string().optional().describe('Pattern to filter entries (supports * wildcard)'),
  search: z.string().optional().describe('Search for entries containing this text'),
  maxDepth: z.number().int().min(0).optional().describe('Maximum depth to traverse'),
  showHidden: z.boolean().optional().describe('Show hidden files/directories (starting with .)'),
})

const strReplaceCodeSchema = z.object({
  command: z.enum(['view', 'str_replace', 'create', 'insert']).describe('view | str_replace | create | insert'),
  path: z.string().describe('Path to the file (relative to app root)'),
  view_range: z.array(z.number().int()).optional().describe('For view: [start_line, end_line] (1-indexed)'),
  old_str: z.string().optional().describe('For str_replace: EXACT text to find (must match exactly once)'),
  new_str: z.string().optional().describe('For str_replace: replacement text'),
  file_text: z.string().optional().describe('For create: full file content'),
  insert_line: z.number().int().min(0).optional().describe('For insert: 0-indexed line to insert before'),
  insert_text: z.string().optional().describe('For insert: text to insert'),
})

// grepSearch: only the params the in-container shim actually applies (see runtime/shim.mjs
// _grepSearch). Bespoke (not the shared grepSearchSchema) so the model-facing type surface
// can't advertise rg flags the shim silently drops.
const grepSearchCodeSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z.string().optional().describe('Relative path within the app to search (default: app root)'),
  glob: z.string().optional().describe('Glob to filter files (e.g. "*.ts")'),
  type: z.string().optional().describe('File type filter (e.g. "ts", "tsx", "js")'),
  '-i': z.boolean().optional().describe('Case-insensitive search'),
  output_mode: z.enum(['content', 'files_with_matches', 'count']).optional().describe('content (default) | files_with_matches | count'),
})

const SUBSET_SCHEMAS: Record<string, z.ZodType> = {
  directoryListing: directoryListingCodeSchema,
  grepSearch: grepSearchCodeSchema,
  readFile: readFileCodeSchema,
  str_replace_based_edit_tool: strReplaceCodeSchema,
}

const API_TYPES = generateTurnscriptTypes(SUBSET_SCHEMAS)

const DESCRIPTION = [
  'Orchestrate file discovery + edits in ONE turn by writing a script, instead of',
  'one tool call per LLM round-trip. Provide an async arrow function that calls the',
  'typed `turnscript.*` API below (these are the SAME tools you already know) and',
  'RETURNS a short text summary.',
  '',
  'API:',
  API_TYPES,
  '',
  'Rules:',
  '- Read every file you need UP FRONT, and batch those reads with Promise.all: the reads are',
  '  independent + idempotent, so fire them concurrently (one await for the whole read phase)',
  '  rather than awaiting each readFile/grepSearch/directoryListing one at a time.',
  '- THEN edit. Apply ALL edits within the SAME script by looping turnscript.str_replace_based_edit_tool',
  '  over each change. Keep edits sequential/ordered — do NOT Promise.all edits to the SAME file',
  '  (concurrent str_replace on one file races and corrupts it). Edits to different files may run',
  '  after the reads, but a simple sequential edit loop is safe and preferred.',
  '- Each method returns the tool result text as DATA; inspect it and branch (continue vs abort).',
  '- str_replace requires old_str to match EXACTLY once — read the file in the same script first if unsure.',
  '- Wrap per-file work in try/catch so one failed edit does not abort the rest; return remaining work to resume next turn.',
  '- Only your returned value re-enters context; intermediate tool results stay in the sandbox. Keep the summary concise.',
  '',
  'Example:',
  'async () => {',
  '  // Read phase: independent reads run in parallel.',
  '  const [home, about, routes] = await Promise.all([',
  '    turnscript.readFile({ path: "src/pages/Home.tsx" }),',
  '    turnscript.readFile({ path: "src/pages/About.tsx" }),',
  '    turnscript.readFile({ path: "src/routes.tsx" }),',
  '  ])',
  '  // Edit phase: sequential, ordered (never Promise.all edits to the same file).',
  '  const results = []',
  '  for (const path of ["src/pages/Home.tsx", "src/pages/About.tsx"]) {',
  '    try {',
  '      results.push(await turnscript.str_replace_based_edit_tool({ command: "str_replace", path, old_str: "...", new_str: "..." }))',
  '    } catch (e) { results.push(`failed ${path}: ${e.message}`) }',
  '  }',
  '  return `edited: ${results.join("; ")}`',
  '}',
].join('\n')

export const turnscriptSchema = z.object({
  code: z.string().describe(
    'An async arrow function `async () => { ... }` orchestrating turnscript.directoryListing / turnscript.grepSearch / turnscript.readFile / turnscript.str_replace_based_edit_tool. Must RETURN a short summary string. No imports/require/process/network — only the turnscript.* API and console.',
  ),
})

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Failure kinds where rewriting/re-running the same script is unlikely to help, so
 * we steer the model to finish the remaining work with the direct tools this turn
 * (model-driven fallback — there is no automatic server-side retry). `runtime_throw`
 * is excluded on purpose: the underlying tool error is genuine and surfaced verbatim.
 */
const RECOVERABLE_FAILURE_KINDS: ReadonlySet<TurnscriptFailureKind> = new Set([
  'blocked',
  'compile',
  'not_a_function',
  'dispatch_cap',
  'timeout',
])

export interface FormattedTurnscriptResult {
  text: string
  fallbackAdvised: boolean
}

/**
 * Render the model-facing text for a turnscript run and decide whether we advised a
 * direct-tool fallback. On a recoverable failure we tell the model NOT to rewrite
 * the script and report which dispatches already landed (so it won't double-apply).
 */
export function formatTurnscriptResult(result: TurnscriptResult): FormattedTurnscriptResult {
  const byTool: Record<string, number> = {}
  for (const dispatch of result.dispatches) {
    byTool[dispatch.tool] = (byTool[dispatch.tool] ?? 0) + 1
  }
  const conflicts = result.dispatches.filter(d => d.status === 'conflict').length
  const failures = result.dispatches.filter(d => !d.ok).length

  const lines: string[] = []
  let fallbackAdvised = false

  if (!result.ok) {
    const kind = result.failureKind
    if (kind && RECOVERABLE_FAILURE_KINDS.has(kind)) {
      fallbackAdvised = true
      const appliedByTool: Record<string, number> = {}
      let appliedCount = 0
      for (const dispatch of result.dispatches) {
        if (!dispatch.ok) continue
        appliedByTool[dispatch.tool] = (appliedByTool[dispatch.tool] ?? 0) + 1
        appliedCount++
      }
      lines.push(`[turnscript failed: ${kind}] ${result.error ?? 'unknown error'}`)
      lines.push(
        'Do NOT rewrite or re-run this script. Complete the remaining edits directly this turn ' +
          'using the direct readFile / grepSearch / directoryListing / str_replace_based_edit_tool tools.',
      )
      lines.push(
        appliedCount
          ? `Already applied this script (do NOT re-apply): ${appliedCount} dispatch(es) ${JSON.stringify(appliedByTool)}.`
          : 'No edits were applied before the failure.',
      )
    } else if (kind === 'runtime_throw') {
      lines.push(`[turnscript runtime error] ${result.error ?? 'unknown error'}`)
    } else if (kind === 'result_unreadable') {
      // The script ran but its result couldn't be transported/decoded — its edits may have
      // ALREADY been applied. Not a RECOVERABLE_FAILURE_KIND (no direct-tool admit), and the
      // wording deliberately avoids the `turnscriptReportedFailure` prefixes so we don't trip
      // the fallback hook: the right move is to re-verify state, not re-run (which could
      // double-apply).
      lines.push(`[turnscript result unavailable] ${result.error ?? 'the script ran but its result could not be read back'}`)
      lines.push('The script may have ALREADY applied its edits. Do NOT re-run the same script — re-read the affected files to verify their current state before making any further edits.')
    } else {
      lines.push(`[turnscript error${kind ? `: ${kind}` : ''}] ${result.error ?? 'unknown error'}`)
    }
  } else {
    const summary = stringify(result.result)
    if (summary) lines.push(summary)
  }

  lines.push(
    `[turnscript] ${result.dispatches.length} dispatch(es) ${JSON.stringify(byTool)}` +
      `${conflicts ? `, ${conflicts} conflict(s)` : ''}${failures ? `, ${failures} failure(s)` : ''}`,
  )
  // With no-rethrow, a recovered per-dispatch failure leaves the script ok:true; surface the
  // underlying errors so the model can fix just those edits on a follow-up turn. This is NOT
  // a "[turnscript ...]" failure line, so turnscriptReportedFailure won't trip the fallback hook.
  const failedWithError = result.dispatches.filter(d => !d.ok && d.error)
  if (failedWithError.length) {
    lines.push(
      `[failed dispatches] ${failedWithError.map(d => `${d.tool}: ${d.error}`).join(' | ')}`.slice(0, 2000),
    )
  }
  if (result.logs.length) {
    lines.push(`[logs] ${result.logs.slice(0, 20).join(' | ')}`.slice(0, 2000))
  }

  // Trailer listing the files this run wrote, appended AFTER the 8000-char body slice so it
  // can't be truncated away. The client parses this exact `[turnscript:edited] ` prefix to
  // dismiss the first-build overlay on a src/pages/index write (turnscript edits are otherwise
  // invisible to the UI). The `[turnscript:` marker + hyphen-free suffix deliberately avoid the
  // `[turnscript (failed:|runtime error]|error)` prefixes that turnscriptReportedFailure matches.
  // KEEP IN SYNC with parseTurnscriptEditedPaths in app/.../develop/hooks/useInitialization.ts.
  const body: string = lines.join('\n').slice(0, 8000)
  const editedPaths: string[] = result.editedPaths ?? []
  const trailer: string = editedPaths.length
    ? `\n[turnscript:edited] ${editedPaths.join(', ').slice(0, 2000)}`
    : ''
  return { text: body + trailer, fallbackAdvised }
}

/**
 * Detect whether a turnscript tool result string reported a failure. Used by the
 * develop agent's afterToolExecution hook to track fallback events without
 * re-plumbing the structured result through the tool-call loop.
 */
export function turnscriptReportedFailure(output: string): boolean {
  return /^\[turnscript (failed:|runtime error\]|error)/m.test(output)
}

export const turnscriptAITool: Tool = createTool(
  DESCRIPTION,
  turnscriptSchema,
  async (input: { code: string }, context) => {
    const appId = context?.metadata?.appId as string | undefined

    const started = Date.now()
    const result = await runTurnscriptInContainer(input.code, {
      appId,
      timeoutMs: 30000,
      maxDispatches: 200,
    })

    // One record per real tool dispatch inside the single turnscript turn, so the eval
    // can recover the true dispatch count (gosym-probe only sees the single outer
    // turnscript tool call). Dispatch telemetry now comes back in the result envelope.
    for (const record of result.dispatches) {
      logger.info('turnscript.dispatch', {
        appId,
        tool: record.tool,
        ms: record.ms,
        ok: record.ok,
        status: record.status,
        resultBytes: record.resultBytes,
      })
    }

    const byTool: Record<string, number> = {}
    for (const dispatch of result.dispatches) {
      byTool[dispatch.tool] = (byTool[dispatch.tool] ?? 0) + 1
    }
    const conflicts = result.dispatches.filter(d => d.status === 'conflict').length
    const failures = result.dispatches.filter(d => !d.ok).length

    const formatted = formatTurnscriptResult(result)

    logger.info('turnscript.complete', {
      appId,
      ok: result.ok,
      totalDispatches: result.dispatches.length,
      byTool,
      conflicts,
      failures,
      failureKind: result.failureKind,
      fallbackAdvised: formatted.fallbackAdvised,
      wallMs: Date.now() - started,
      error: result.error,
    })

    return formatted.text
  },
)
