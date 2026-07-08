import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isFileBlocked } from '../../../read-file.js'
import { buildScript } from '../runner.js'

/**
 * Smoke test for the in-container turnscript shim. Runs the real shim with `node`
 * against a temp workspace (cwd = workspace root), exactly as it would run inside
 * the preview container via /exec — minus the Landlock sandbox. Exercises the
 * fs-based paths (readFile / str_replace / guards) without needing a container.
 */

const SHIM_SOURCE = readFileSync(fileURLToPath(new URL('../runtime/shim.mjs', import.meta.url)), 'utf8')
/** Reassemble + decode the shim's base64 `__TURNSCRIPT_CHUNK` stdout transport (mirrors runner.ts). */
function decodeEnvelope(stdout: string): {
  ok: boolean
  result: unknown
  error?: string
  failureKind?: string
  dispatches: Array<{ tool: string; ok: boolean; status: string; error?: string }>
  logs: string[]
  editedPaths?: string[]
} {
  const chunks = new Map<number, string>()
  let total: number | undefined
  for (const m of stdout.matchAll(/^__TURNSCRIPT_CHUNK (\d+)\/(\d+) (\S+)$/gm)) {
    total = Number(m[2])
    chunks.set(Number(m[1]), m[3])
  }
  if (total === undefined) throw new Error(`no envelope in output:\n${stdout}`)
  const b64 = Array.from({ length: total }, (_, i) => chunks.get(i) ?? '').join('')
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
}

function run(dir: string, userCode: string, env: Record<string, string> = {}): {
  ok: boolean
  result: unknown
  error?: string
  failureKind?: string
  dispatches: Array<{ tool: string; ok: boolean; status: string; error?: string }>
  logs: string[]
  editedPaths?: string[]
} {
  mkdirSync(join(dir, '.airo'), { recursive: true })
  const scriptPath = join(dir, '.airo', 'turnscript-test.mjs')
  writeFileSync(scriptPath, `${SHIM_SOURCE}\nglobalThis.__turnscriptUserFn = (\n${userCode}\n);\n`)
  const stdout = execFileSync('node', [scriptPath], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return decodeEnvelope(stdout)
}

describe('turnscript in-container shim', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cm-shim-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('readFile returns cat-n formatted content + records a dispatch', () => {
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree')
    const env = run(dir, `async () => turnscript.readFile({ path: 'a.txt' })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('1\tone')
    expect(String(env.result)).toContain('2\ttwo')
    expect(String(env.result)).toContain('3\tthree')
    expect(String(env.result)).not.toContain('[3 lines]')
    expect(env.dispatches).toHaveLength(1)
    expect(env.dispatches[0]).toMatchObject({ tool: 'readFile', ok: true, status: 'ok' })
  })

  it('str_replace applies a unique edit to the real file', () => {
    writeFileSync(join(dir, 'b.txt'), 'hello world')
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'b.txt', old_str: 'world', new_str: 'turnscript' })`)
    expect(env.ok).toBe(true)
    expect(env.result).toBe('Successfully replaced text.')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('hello turnscript')
  })

  it('str_replace multi-match fails as data (no-rethrow) and leaves the file unchanged', () => {
    writeFileSync(join(dir, 'c.txt'), 'x\nx\n')
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'c.txt', old_str: 'x', new_str: 'y' })`)
    expect(env.ok).toBe(true) // script completes; the dispatch error is returned as data
    expect(String(env.result)).toContain('[error] Found 2 matches')
    expect(env.dispatches[0]).toMatchObject({ ok: false, status: 'throw' })
    expect(readFileSync(join(dir, 'c.txt'), 'utf8')).toBe('x\nx\n')
  })

  it('create auto-makes missing parent directories (P0: mkdir -p parity)', () => {
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'src/server/api/new/handler.ts', file_text: 'export const x = 1' })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully created handler.ts')
    expect(readFileSync(join(dir, 'src/server/api/new/handler.ts'), 'utf8')).toBe('export const x = 1')
  })

  it('records editedPaths for successful writes (create/str_replace), deduped, reads excluded', () => {
    writeFileSync(join(dir, 'existing.ts'), 'const a = 1')
    const env = run(dir, `async () => {
      await turnscript.str_replace_based_edit_tool({ command: 'create', path: 'src/pages/index.tsx', file_text: 'export default () => null' })
      await turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'existing.ts', old_str: 'const a = 1', new_str: 'const a = 2' })
      await turnscript.readFile({ path: 'existing.ts' })
      await turnscript.str_replace_based_edit_tool({ command: 'view', path: 'existing.ts' })
      return 'done'
    }`)
    expect(env.ok).toBe(true)
    // create + str_replace are recorded; the readFile and the str_replace_based_edit_tool `view`
    // (both reads) are not.
    expect(env.editedPaths).toEqual(['src/pages/index.tsx', 'existing.ts'])
  })

  it('does not record editedPaths for a failed write (multi-match str_replace)', () => {
    writeFileSync(join(dir, 'dup.txt'), 'x\nx\n')
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'dup.txt', old_str: 'x', new_str: 'y' })`)
    expect(env.ok).toBe(true) // dispatch error returned as data
    expect(env.editedPaths ?? []).toEqual([])
  })

  it('REJECTS writing readFile display output back as content (prod corruption repro)', () => {
    const original = 'import { RouteObject } from "react-router-dom";\nexport const routes = [];\n'
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/routes.tsx'), original)
    // The exact incident shape: pipe a readFile result variable straight into create.
    const env = run(dir, `async () => {
      const c = await turnscript.readFile({ path: 'src/routes.tsx' })
      return turnscript.str_replace_based_edit_tool({ command: 'create', path: 'src/routes.tsx', file_text: c })
    }`)
    expect(env.ok).toBe(true) // guard error is returned as dispatch data, not a crash
    expect(String(env.result)).toContain('[error]')
    expect(String(env.result)).toContain('DISPLAY output')
    // The file is untouched and the failed write is not reported as an edit.
    expect(readFileSync(join(dir, 'src/routes.tsx'), 'utf8')).toBe(original)
    expect(env.editedPaths ?? []).toEqual([])
  })

  it('REJECTS the legacy header + pipe-numbered display format (pre-#6106 reads echoed from history)', () => {
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'legacy.tsx', file_text: ${JSON.stringify('legacy.tsx [3 lines]\n     1|import x from "y"\n     2|const a = 1\n     3|export default a')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('[error]')
    expect(existsSync(join(dir, 'legacy.tsx'))).toBe(false)
  })

  it('does NOT reject numbered rows wrapped in code (homogeneity broken by the wrapper lines)', () => {
    // Lines DO start with number+tab (like a TSV in a template literal), but the numbers are
    // non-sequential — real display output is sequential.
    const content = 'const tsv = `\n7\talpha\n3\tbeta\n4\tgamma\n9\tdelta\n`\nexport default tsv\n'
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'notes.ts', file_text: ${JSON.stringify('const tsv = `\n7\talpha\n3\tbeta\n4\tgamma\n9\tdelta\n`\nexport default tsv\n')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully created')
    expect(readFileSync(join(dir, 'notes.ts'), 'utf8')).toBe(content)
  })

  it('does NOT reject sequential-id data wrapped in code (standings template literal)', () => {
    // Sequential 1/2/3 rows, but the surrounding code lines break homogeneity —
    // display output numbers EVERY line.
    const content = 'export const standings = `rank\tteam\tpts\n1\tAustralia\t24\n2\tIndia\t22\n3\tEngland\t18\n`\n'
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'standings.ts', file_text: ${JSON.stringify('export const standings = `rank\tteam\tpts\n1\tAustralia\t24\n2\tIndia\t22\n3\tEngland\t18\n`\n')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully created')
    expect(readFileSync(join(dir, 'standings.ts'), 'utf8')).toBe(content)
  })

  it('does NOT reject a seed TSV/PSV with a header row and sequential ids', () => {
    const content = 'id\tname\tscore\n1\tAlice\t98\n2\tBob\t95\n3\tCarol\t92\n'
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'data/scores.tsv', file_text: ${JSON.stringify('id\tname\tscore\n1\tAlice\t98\n2\tBob\t95\n3\tCarol\t92\n')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully created')
    expect(readFileSync(join(dir, 'data/scores.tsv'), 'utf8')).toBe(content)
  })

  it('REJECTS a mid-file display slice (offset read echoed back, numbering not starting at 1)', () => {
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'slice.ts', file_text: ${JSON.stringify('47\tconst a = compute()\n48\treturn a\n49\t}')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('[error]')
    expect(existsSync(join(dir, 'slice.ts'))).toBe(false)
  })

  it('REJECTS display output pasted as str_replace new_str (not just create)', () => {
    writeFileSync(join(dir, 'target.ts'), 'const OLD = 1\n')
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'target.ts', old_str: 'const OLD = 1', new_str: ${JSON.stringify('1\tconst a = 1\n2\tconst b = 2\n3\texport default a')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('[error]')
    expect(readFileSync(join(dir, 'target.ts'), 'utf8')).toBe('const OLD = 1\n')
  })

  it('does NOT reject pure headerless NON-sequential numbered rows (sequentiality is load-bearing)', () => {
    // Homogeneous numbered lines, but out of order — real display output is always
    // sequential, so this must pass. Pins the `n !== prev + 1` branch.
    const content = '7\talpha\n3\tbeta\n4\tgamma\n9\tdelta\n'
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'rows.tsv', file_text: ${JSON.stringify('7\talpha\n3\tbeta\n4\tgamma\n9\tdelta\n')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully created')
    expect(readFileSync(join(dir, 'rows.tsv'), 'utf8')).toBe(content)
  })

  it('does NOT reject 2-line numbered content (documented sub-3-line limitation)', () => {
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'two.tsv', file_text: ${JSON.stringify('1\talpha\n2\tbeta\n')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully created')
  })

  it('does NOT reject insert of sequential continuation rows (fragments are exempt from the numbered-run check)', () => {
    writeFileSync(join(dir, 'scores.tsv'), 'id\tname\tscore\n1\tAlice\t98\n2\tBob\t95\n3\tCarol\t92\n')
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'insert', path: 'scores.tsv', insert_line: 4, insert_text: ${JSON.stringify('4\tDave\t90\n5\tEve\t88\n6\tFrank\t85')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully inserted')
    expect(readFileSync(join(dir, 'scores.tsv'), 'utf8')).toContain('4\tDave\t90')
  })

  it('REJECTS insert of a full legacy display (header still guards fragments)', () => {
    writeFileSync(join(dir, 'ins.ts'), 'const a = 1\n')
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'insert', path: 'ins.ts', insert_line: 1, insert_text: ${JSON.stringify('ins.ts [2 lines]\n     1|const a = 1\n     2|export default a')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('[error]')
    expect(readFileSync(join(dir, 'ins.ts'), 'utf8')).toBe('const a = 1\n')
  })

  it('does NOT reject prose whose first line happens to end in "[N lines]" (header needs a numbered follow-up)', () => {
    const content = 'Summary of output [3 lines]\nplain prose here\nmore prose\n'
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'notes.md', file_text: ${JSON.stringify('Summary of output [3 lines]\nplain prose here\nmore prose\n')} })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('Successfully created')
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe(content)
  })

  it('str_replace recovers from indentation/whitespace drift via tolerant retry (P0)', () => {
    writeFileSync(join(dir, 'w.ts'), '    const x = 1;\n    return x;\n') // file uses 4-space indent
    // model sends 2-space indent — exact match fails, whitespace-tolerant retry recovers uniquely
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'w.ts', old_str: '  const x = 1;\\n  return x;', new_str: '  const y = 2;' })`)
    expect(env.ok).toBe(true)
    expect(env.result).toBe('Successfully replaced text.')
    const out = readFileSync(join(dir, 'w.ts'), 'utf8')
    expect(out).toContain('const y = 2;')
    expect(out).not.toContain('const x = 1;')
  })

  it('str_replace hard-fails on an ambiguous tolerant match — no silent wrong edit (P0)', () => {
    writeFileSync(join(dir, 'amb.ts'), 'foo();\n  foo();\n') // same line at 0- and 2-space indent
    // old_str at 4-space indent: exact-fails (no 4-space occurrence), tolerant normalizes to BOTH → ambiguous
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'amb.ts', old_str: '    foo();', new_str: 'bar();' })`)
    expect(String(env.result)).toContain('[error]')
    expect(String(env.result)).toContain('whitespace-insensitive matches')
    expect(readFileSync(join(dir, 'amb.ts'), 'utf8')).toBe('foo();\n  foo();\n') // unchanged
  })

  it('blocks edits to the protected .airo directory', () => {
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: '.airo/x.txt', file_text: 'nope' })`)
    expect(String(env.result)).toContain('[error]')
    expect(String(env.result)).toContain('protected')
  })

  it('blocks reading lock files', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lock')
    const env = run(dir, `async () => turnscript.readFile({ path: 'pnpm-lock.yaml' })`)
    expect(String(env.result)).toContain('[error]')
    expect(String(env.result)).toContain('Lock files')
  })

  it('rejects upload/api paths written into source files', () => {
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'create', path: 'src/x.tsx', file_text: 'const u = "/api/files/abc"' })`)
    expect(String(env.result)).toContain('[error]')
    expect(String(env.result)).toContain('FORBIDDEN')
  })

  it('a non-function script maps to not_a_function', () => {
    const env = run(dir, `42`)
    expect(env.ok).toBe(false)
    expect(env.failureKind).toBe('not_a_function')
  })

  it('enforces the dispatch cap', () => {
    writeFileSync(join(dir, 'd.txt'), 'hi')
    const env = run(
      dir,
      `async () => { for (let i = 0; i < 10; i++) await turnscript.readFile({ path: 'd.txt' }); return 'done' }`,
      { TURNSCRIPT_MAX_DISPATCHES: '3' },
    )
    expect(env.ok).toBe(false)
    expect(env.failureKind).toBe('dispatch_cap')
  })

  it('captures console output into logs, not stdout', () => {
    const env = run(dir, `async () => { console.log('hello from script'); return 'ok' }`)
    expect(env.ok).toBe(true)
    expect(env.result).toBe('ok')
    expect(env.logs).toContain('hello from script')
  })

  it('transpiles TypeScript in the model script so node can run it (buildScript)', async () => {
    writeFileSync(join(dir, 'r.txt'), 'hi')
    // TS-flavoured orchestration: type annotation + `as` — would SyntaxError as raw .mjs.
    const tsUserCode = `async () => {
      const paths: string[] = ['r.txt']
      const out = await turnscript.readFile({ path: paths[0] as string })
      const n: number = out.split('\\n').length
      return \`lines:\${n}\`
    }`
    const script = await buildScript(tsUserCode)
    expect(script).not.toContain(': string[]') // types stripped
    const scriptPath = join(dir, '.airo', 'turnscript-ts.mjs')
    mkdirSync(join(dir, '.airo'), { recursive: true })
    writeFileSync(scriptPath, script)
    const stdout = execFileSync('node', [scriptPath], { cwd: dir, encoding: 'utf8' })
    const env = decodeEnvelope(stdout)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('lines:')
  })

  it('caps an oversized result so the envelope stays parseable (no false failure)', () => {
    // Script returns a huge string (e.g. full file dumps) — must not blow stdout / break parse.
    const env = run(dir, `async () => 'X'.repeat(60000)`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('[truncated by turnscript')
    expect(String(env.result).length).toBeLessThan(13000)
  })

  it('transports a large multi-chunk result intact over stdout (base64 chunking)', () => {
    // ~18KB result stays under the 24KB envelope cap, so it is NOT truncated — it must
    // round-trip exactly across multiple base64 chunk lines (each > one 4096-byte line).
    const big = 'Z'.repeat(18000)
    const env = run(dir, `async () => ${JSON.stringify(big)}`)
    expect(env.ok).toBe(true)
    expect(env.result).toBe(big)
  })

  it('isFileBlocked matches the canonical read-file tool for every fixture (parity)', () => {
    // Drift guard: the shim re-implements isFileBlocked over its own ext sets, which
    // MUST stay in lockstep with agents/src/utils/file-types.ts. This runs each fixture
    // through the shim and asserts the {blocked, reason} matches the canonical tool.
    const fixtures = [
      'logo.png', 'pic.tiff', 'hero.avif', // images
      'spec.pdf', 'report.docx', 'data.xlsx', 'deck.pptx', // documents
      'font.woff2', 'track.m4a', 'clip.avi', 'lib.so', // fonts/audio/video/lib
      'app.sqlite3', 'mod.wasm', 'tool.exe', // db/wasm/exe
      '.airo/turnscript-abc123.mjs', // protected platform dir — read-blocked
      'index.ts', 'notes.txt', 'config.json', 'icon.svg', // text — not blocked
    ]
    mkdirSync(join(dir, '.airo'), { recursive: true })
    for (const f of fixtures) writeFileSync(join(dir, f), 'x')
    const env = run(dir, `async () => {
      const out = []
      for (const n of ${JSON.stringify(fixtures)}) out.push([n, await turnscript.readFile({ path: n })])
      return out
    }`)
    expect(env.ok).toBe(true)
    const mismatches: string[] = []
    for (const [name, res] of env.result as Array<[string, string]>) {
      const canonical = isFileBlocked(name)
      const shimBlocked = res.startsWith('[error]')
      if (shimBlocked !== canonical.blocked) {
        mismatches.push(`${name}: shim blocked=${shimBlocked}, canonical blocked=${canonical.blocked}`)
      } else if (canonical.blocked && canonical.reason && !res.includes(canonical.reason)) {
        mismatches.push(`${name}: reason drift\n  shim:      ${res}\n  canonical: ${canonical.reason}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('batches multiple reads via Promise.all in one run', () => {
    writeFileSync(join(dir, 'p.txt'), 'P')
    writeFileSync(join(dir, 'q.txt'), 'Q')
    const env = run(dir, `async () => {
      const [a, b] = await Promise.all([
        turnscript.readFile({ path: 'p.txt' }),
        turnscript.readFile({ path: 'q.txt' }),
      ])
      return a + ' ' + b
    }`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('1\tP')
    expect(String(env.result)).toContain('1\tQ')
    expect(env.dispatches).toHaveLength(2)
  })

  // --- regression tests for Dan's review ---

  it("str_replace writes new_str literally — $&/$1 aren't regex replacement patterns", () => {
    writeFileSync(join(dir, 'p.txt'), 'color:RED')
    const env = run(dir, `async () => turnscript.str_replace_based_edit_tool({ command: 'str_replace', path: 'p.txt', old_str: 'RED', new_str: 'var(--c-$&-$1)' })`)
    expect(env.ok).toBe(true)
    expect(readFileSync(join(dir, 'p.txt'), 'utf8')).toBe('color:var(--c-$&-$1)')
  })

  it('lists the app root without throwing (directoryListing path ".")', () => {
    writeFileSync(join(dir, 'top.txt'), 'x')
    const env = run(dir, `async () => turnscript.directoryListing({ path: '.' })`)
    expect(env.ok).toBe(true)
    expect(String(env.result)).toContain('top.txt')
  })
})
