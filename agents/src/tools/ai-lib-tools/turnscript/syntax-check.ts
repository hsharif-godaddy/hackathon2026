/**
 * Turnscript post-run syntax gate.
 *
 * Turnscript applies its edits opaquely inside the preview container, bypassing
 * the text editor's per-edit checks, and the downstream per-turn validator is
 * fail-open — so a syntax-broken write can reach the customer preview with no
 * signal to the agent. After a run, turnscript-tool.ts re-reads every written
 * file (`editedPaths`) here and babel-parses it; each file that no longer
 * parses gets a loud, actionable note appended to the tool result so the model
 * fixes it in the same conversation.
 *
 * Fail-safe contract: this function never throws, only a babel error carrying a
 * source location counts as a broken file (an internal parser throw is not),
 * and any read/infra error yields no note — the gate must never turn a
 * successful edit into a failure by itself.
 *
 * Known limitation: runs that die before returning a result envelope (timeout,
 * result_unreadable, exec failure) report no editedPaths and are not gated.
 */

import { extname } from 'node:path'
import { parse, type ParserOptions, type ParserPlugin } from '@babel/parser'

import { logger } from '../../../logging/index.js'
import type { CreateForWorkspace } from '../../../workspace/client.js'
import type { WorkspaceFiles } from '../../../workspace/files.js'
import { createForWorkspace } from '../../../workspace/index.js'
import { resolveWorkspaceFiles } from '../../../workspace/resolve.js'

/** Per-extension parser configs. jsx is deliberately absent for .ts/.mts/.cts —
 * with it, valid angle-bracket type assertions (`<HTMLInputElement>e.target`)
 * false-positive as "Unterminated JSX contents". js-family parses as
 * 'unambiguous' with top-level return allowed so CommonJS-shaped files pass. */
const TS_PLUGINS: ParserPlugin[] = ['typescript', 'decorators-legacy', 'decoratorAutoAccessors', 'deprecatedImportAssert']
const PARSER_CONFIGS: ReadonlyMap<string, ParserOptions> = new Map([
  ['.tsx', { sourceType: 'module', plugins: [...TS_PLUGINS, 'jsx'] }],
  ['.ts', { sourceType: 'module', plugins: TS_PLUGINS }],
  ['.mts', { sourceType: 'module', plugins: TS_PLUGINS }],
  ['.cts', { sourceType: 'module', plugins: TS_PLUGINS }],
  ['.jsx', { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins: ['jsx'] }],
  ['.js', { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins: ['jsx'] }],
  ['.mjs', { sourceType: 'module', plugins: ['jsx'] }],
  ['.cjs', { sourceType: 'script', allowReturnOutsideFunction: true, plugins: ['jsx'] }],
])

/** Bound the per-run work: a script can write up to the dispatch cap (200) files;
 * parsing the first N is enough signal without stalling the tool result. */
const MAX_FILES_PER_RUN: number = 25

/** The model emits paths verbatim; normalize the benign spellings the container
 * accepts ('./x', '/app/x') so the checkable/exclusion rules can't be dodged. */
function normalizeRelPath(relPath: string): string {
  let p: string = relPath.replace(/\\/g, '/')
  if (p.startsWith('/app/')) p = p.slice('/app/'.length)
  while (p.startsWith('./')) p = p.slice(2)
  return p
}

/** Files the gate applies to: parseable source, excluding the content-layer tree. */
export function isSyntaxCheckable(relPath: string): boolean {
  const p: string = normalizeRelPath(relPath)
  if (p.startsWith('src/content/')) return false
  return PARSER_CONFIGS.has(extname(p))
}

export interface ParseFailure {
  line?: number
  column?: number
  message: string
}

type LocatedError = { loc?: { line?: number; column?: number }; message?: string }

/** Babel-parse `source` with the config for `relPath`'s extension; return the
 * located parse error, or null when valid (or when the file isn't checkable). */
export function checkFileSyntax(source: string, relPath: string): ParseFailure | null {
  const config: ParserOptions | undefined = PARSER_CONFIGS.get(extname(normalizeRelPath(relPath)))
  if (!config) return null
  try {
    parse(source, config)
    return null
  } catch (err) {
    const e: LocatedError = err as LocatedError
    // No source location ⇒ an internal parser failure, not a broken file — fail safe.
    if (!e.loc) {
      logger.warn('turnscript.syntax_check.parser_threw', { filePath: relPath, error: e.message ?? String(err) })
      return null
    }
    return { line: e.loc.line, column: e.loc.column, message: e.message ?? String(err) }
  }
}

// The note must never start a line with "[turnscript " — turnscriptReportedFailure
// regex-matches those prefixes and would wrongly flip the direct-tools admit. relPath is
// model-controlled (editedPaths), so flatten any embedded newlines before interpolating —
// otherwise a crafted path like "x\n[turnscript failed: y.ts" injects a matching line.
function formatSyntaxNote(relPath: string, err: ParseFailure): string {
  const safePath: string = relPath.replace(/[\r\n]+/g, ' ')
  const where: string = err.line ? `${safePath}:${err.line}${err.column !== undefined ? `:${err.column}` : ''}` : safePath
  return [
    `🛑 SYNTAX ERROR — the edit was applied but ${where} no longer parses:`,
    `  ${err.message}`,
    'The preview is broken until this is fixed. Fix this file NOW, before any other work.',
  ].join('\n')
}

/**
 * Syntax-check the given app-relative paths through the Workspace API and
 * return a note block for every file that fails to parse ('' when all clean).
 * Never throws.
 */
export async function syntaxNotesForPaths(
  appId: string,
  relPaths: string[],
  workspaceFactory: CreateForWorkspace = createForWorkspace,
): Promise<string> {
  const started: number = Date.now()
  try {
    const checkable: string[] = relPaths.filter(isSyntaxCheckable)
    if (checkable.length === 0) return ''
    if (checkable.length > MAX_FILES_PER_RUN) {
      logger.info('turnscript.syntax_check.capped', { appId, total: checkable.length, checked: MAX_FILES_PER_RUN })
    }

    const files: WorkspaceFiles = resolveWorkspaceFiles(appId, 'preview', workspaceFactory)
    const checked: string[] = checkable.slice(0, MAX_FILES_PER_RUN)
    // Reads are independent — run them concurrently so 25 files cost one round-trip, not 25.
    const perFile: Array<string | null> = await Promise.all(checked.map(async (relPath: string): Promise<string | null> => {
      try {
        const source: string = await files.readText({ path: relPath })
        if (source.length > 1_000_000) return null // parse cost on multi-MB files is real; the per-turn validator still covers them
        const err: ParseFailure | null = checkFileSyntax(source, relPath)
        if (err) {
          logger.warn('turnscript.syntax_check.parse_error', { appId, filePath: relPath, line: err.line, message: err.message })
          return formatSyntaxNote(normalizeRelPath(relPath), err)
        }
        return null
      } catch (readErr) {
        logger.warn('turnscript.syntax_check.read_failed', {
          appId,
          filePath: relPath,
          error: readErr instanceof Error ? readErr.message : String(readErr),
        })
        return null
      }
    }))
    const notes: string[] = perFile.filter((n: string | null): n is string => n !== null)
    // Emitted for every run with ≥1 checkable file (clean ones included) so hit-rate,
    // FP-rate, and gate latency are measurable in prod.
    logger.info('turnscript.syntax_check.complete', { appId, checked: checked.length, broken: notes.length, ms: Date.now() - started })
    if (notes.length === 0) return ''
    const joined: string = notes.join('\n\n')
    // Cap the appended notes so the gate respects the result's size discipline
    // (body 8000 / trailer 2000 — see formatTurnscriptResult).
    const capped: string = joined.length > 4000
      ? `${joined.slice(0, 4000)}\n…[more syntax errors truncated — fix the above first]`
      : joined
    return `\n\n${capped}`
  } catch (err) {
    logger.warn('turnscript.syntax_check.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}
