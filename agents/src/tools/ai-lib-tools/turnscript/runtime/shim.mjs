/**
 * Turnscript in-container runtime shim.
 *
 * This file is the SOURCE for the `turnscript.*` API as it runs INSIDE the customer
 * preview container (under dev-supervisor's Landlock/cgroups/SELinux sandbox), NOT
 * in the agents process. runner.ts reads this file's source, prepends the model's
 * orchestration function as `globalThis.__turnscriptUserFn`, writes the combined
 * script to `.airo/` in the shared workspace, and runs it via the production
 * `/exec` path (`node .airo/turnscript-<id>.mjs`).
 *
 * It re-implements the four discovery/edit tools over plain node fs/child_process
 * against the app root (cwd), and ports the agents-process edit guards
 * (blocked-file, protected-path, immutability, no-api-paths) so behaviour matches
 * the direct tools. The result envelope is emitted as base64 across
 * `__TURNSCRIPT_CHUNK <i>/<n> <data>` stdout lines, reassembled into a TurnscriptResult
 * by runner.ts (chunked so it stays under the dev-supervisor per-line output cap).
 *
 * Valid standalone ESM (lint/test it directly): `globalThis.__turnscriptUserFn` is
 * injected by runner.ts; running this file alone yields a `not_a_function` result.
 */
import { readFileSync, writeFileSync, writeSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, relative, basename, extname, dirname } from 'node:path'

const APP_ROOT = process.cwd()
const MAX_DISPATCHES = Number(process.env.TURNSCRIPT_MAX_DISPATCHES || '200')

const __dispatches = []
const __logs = []
// Paths written by str_replace/create/insert (not reads/views) so the tool layer can
// surface which files this run modified — the client's first-build overlay dismissal
// keys on a src/pages/index write, otherwise invisible since turnscript batches edits.
const __editedPaths = new Set()
let __count = 0

// console.log/error from the model's script is captured (not streamed) so only the
// returned summary + telemetry leave the sandbox, matching the original contract.
const console = {
  log: (...a) => __logs.push(a.map(String).join(' ')),
  error: (...a) => __logs.push(a.map(String).join(' ')),
  warn: (...a) => __logs.push(a.map(String).join(' ')),
}

// ---------- ported guards (mirror agents/src/tools/read-file.ts isFileBlocked) ----------
// The extension sets MUST stay in lockstep with agents/src/utils/file-types.ts
// (IMAGE_FILE_EXTENSIONS / DOCUMENT_FILE_EXTENSIONS / OTHER_BINARY_EXTENSIONS + the
// fonts/audio/video in BINARY_FILE_EXTENSIONS). The parity test in __tests__/shim.test.ts
// asserts isFileBlocked here returns identical {blocked, reason} to the canonical tool.

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'avif'])
const DOCUMENT_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
const BINARY_EXT = new Set([
  ...IMAGE_EXT,
  'woff', 'woff2', 'ttf', 'otf', 'eot', // fonts
  'mp3', 'wav', 'ogg', 'm4a', 'aac', // audio
  'mp4', 'webm', 'mov', 'avi', // video
  ...DOCUMENT_EXT,
  'zip', 'tar', 'gz', 'rar', '7z', 'db', 'sqlite', 'sqlite3', 'bin', 'exe', 'dll', 'so', 'wasm', // archives/db/executables
])

function isFileBlocked(filePath) {
  const fileName = basename(filePath)
  const p = filePath.replace(/\\/g, '/')
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'Gemfile.lock', 'Pipfile.lock', 'poetry.lock']
  if (lock.includes(fileName) || (fileName.includes('lock') && /\.(json|ya?ml)$/.test(fileName))) {
    return { blocked: true, reason: 'Lock files are auto-generated — not useful for development' }
  }
  if (/(^|\/)(node_modules|vendor|\.pnpm|\.yarn)\//.test(p)) {
    return { blocked: true, reason: 'Dependency directory — external code, not relevant' }
  }
  if (['.cache/', '.vite/', '.turbo/', '.parcel-cache/', '.rollup.cache/', 'tmp/', 'temp/'].some(d => p.includes(d))) {
    return { blocked: true, reason: 'Cache directory — temporary files, not relevant' }
  }
  // Protected platform directory — internal agent/turnscript artifacts and config.
  // Case-insensitive so `.AIRO` can't bypass it on case-insensitive filesystems.
  // Mirrors read-file.ts; isProtected() also blocks the edit path.
  if (/(^|\/)\.airo(\/|$)/i.test(p)) {
    return { blocked: true, reason: 'Protected platform directory (.airo) — not readable' }
  }
  if (fileName.endsWith('.log') || fileName.includes('.log.') || p.includes('logs/') ||
      fileName.startsWith('npm-debug') || fileName.startsWith('yarn-error') || fileName.startsWith('pnpm-debug')) {
    return { blocked: true, reason: 'Log file — runtime output, not useful for development' }
  }
  const ext = extname(fileName).slice(1).toLowerCase()
  if (ext !== 'svg' && BINARY_EXT.has(ext)) {
    if (IMAGE_EXT.has(ext)) return { blocked: true, reason: `Cannot read image as text. Reference by path in code (e.g. src="${filePath}"). Ask the user to describe visual content if needed.` }
    if (DOCUMENT_EXT.has(ext)) return { blocked: true, reason: `Cannot read ${ext.toUpperCase()} as text. Ask the user to paste relevant content into chat.` }
    return { blocked: true, reason: 'Binary file — not readable as text. Reference by path in code.' }
  }
  return { blocked: false }
}

function isProtected(relPath) {
  const norm = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  return norm === '.airo' || norm.startsWith('.airo/')
}

function isSourceFile(p) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro)$/.test(p)
}

function validateNoApiPaths(content, filePath) {
  if (!isSourceFile(filePath)) return { valid: true }
  if (content.includes('/api/files/') || content.includes('/files/uploads/')) {
    return { valid: false, error: 'FORBIDDEN: Cannot write upload URLs (/api/files/ or /files/uploads/) to source code — they are temporary and break in production. Copy the file into the project (e.g. public/assets/) and reference a project-relative path.' }
  }
  return { valid: true }
}

function resolveInApp(p) {
  const abs = resolve(APP_ROOT, p)
  const rel = relative(APP_ROOT, abs)
  // rel === '' means the path IS the app root (e.g. '.') — valid for listing/reads.
  // Only reject paths that escape the root ('..').
  if (rel.startsWith('..')) {
    throw new Error(`File path must be within the app directory: ${p}`)
  }
  return abs
}

function isImmutable(abs) {
  try {
    const fd = readFileSync(abs, 'utf8')
    const first = fd.split('\n', 1)[0] || ''
    return first.includes('TREAT AS IMMUTABLE')
  } catch {
    return false
  }
}

function editGuards(path, content) {
  if (isProtected(path)) throw new Error(`${path} is in a protected directory and cannot be modified.`)
  const abs = resolveInApp(path)
  if (existsSync(abs) && isImmutable(abs)) throw new Error('File is immutable (contains "TREAT AS IMMUTABLE") — cannot edit.')
  if (content != null) {
    const v = validateNoApiPaths(content, path)
    if (!v.valid) throw new Error(v.error)
  }
}

// ---------- tool implementations ----------

function _readFile({ path, offset, limit }) {
  const blocked = isFileBlocked(path)
  if (blocked.blocked) throw new Error(`${blocked.reason} Do not retry — use a different approach.`)
  const abs = resolveInApp(path)
  if (!existsSync(abs)) throw new Error(`File not found: ${path}`)
  const all = readFileSync(abs, 'utf8').split('\n')
  const total = all.length
  const start = Math.max(0, offset || 0)
  if (start >= total) throw new Error(`Offset ${start} exceeds file length (${total} lines)`)
  const cap = limit || 2000
  const end = Math.min(total, start + cap)
  const padWidth = String(end).length
  return all.slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(padWidth)}\t${l}`)
    .join('\n')
}

function _view(path, viewRange) {
  const abs = resolveInApp(path)
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const entries = readdirSync(abs, { withFileTypes: true })
      .map(e => (e.isDirectory() ? `${e.name}/` : e.name)).sort()
    return `Contents:\n${entries.join('\n')}`
  }
  if (!existsSync(abs)) throw new Error(`File not found: ${path}`)
  const lines = readFileSync(abs, 'utf8').split('\n')
  const start = viewRange ? viewRange[0] : 1
  const end = viewRange && viewRange[1] !== -1 ? viewRange[1] : lines.length
  const padWidth = String(end).length
  return lines.slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(padWidth)}\t${l}`)
    .join('\n')
}

// Whitespace/EOL-tolerant line-block match — used ONLY as a fallback when exact
// str_replace finds no match, to recover the model's indentation / trailing-ws / CRLF
// drift in old_str. Compares whole lines after normalizing leading+trailing horizontal
// whitespace and CRLF; requires a UNIQUE match (ambiguous → caller hard-fails) and never
// does fuzzy/similarity matching, so it cannot silently target the wrong code.
function tolerantLineReplace(content, oldStr, newStr) {
  const norm = (l) => l.replace(/\r$/, '').replace(/[ \t]+$/, '').replace(/^[ \t]+/, '')
  const cLines = content.replace(/\r\n/g, '\n').split('\n')
  let oLines = oldStr.replace(/\r\n/g, '\n').split('\n')
  if (oLines.length > 1 && oLines[oLines.length - 1] === '') oLines = oLines.slice(0, -1)
  if (oLines.length === 0) return { matches: 0 }
  const normO = oLines.map(norm)
  const starts = []
  for (let i = 0; i + normO.length <= cLines.length; i++) {
    let hit = true
    for (let j = 0; j < normO.length; j++) {
      if (norm(cLines[i + j]) !== normO[j]) { hit = false; break }
    }
    if (hit) starts.push(i)
  }
  if (starts.length !== 1) return { matches: starts.length }
  const repl = newStr.replace(/\r\n/g, '\n').split('\n')
  const merged = [...cLines.slice(0, starts[0]), ...repl, ...cLines.slice(starts[0] + normO.length)].join('\n')
  return { matches: 1, result: content.includes('\r\n') ? merged.replace(/\n/g, '\r\n') : merged }
}

function _strReplace(path, oldStr, newStr) {
  editGuards(path, newStr)
  const abs = resolveInApp(path)
  if (!existsSync(abs)) throw new Error(`File not found: ${path}`)
  const content = readFileSync(abs, 'utf8')
  const count = content.split(oldStr).length - 1
  if (count === 0) {
    const tol = tolerantLineReplace(content, oldStr, newStr)
    if (tol.matches === 1) {
      writeFileSync(abs, tol.result)
      return 'Successfully replaced text.'
    }
    if (tol.matches > 1) {
      throw new Error(`Found ${tol.matches} whitespace-insensitive matches for old_str. Include more surrounding context to make it unique.`)
    }
    const lines = content.split('\n')
    const snippet = lines.slice(0, 60).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n')
    throw new Error(`No match found for old_str in this file.\n\nFile content (${lines.length} lines):\n${snippet}`)
  }
  if (count > 1) {
    const at = []
    let from = 0
    for (let i = 0; i < count; i++) {
      const idx = content.indexOf(oldStr, from)
      at.push(content.slice(0, idx).split('\n').length)
      from = idx + oldStr.length
    }
    throw new Error(`Found ${count} matches for old_str at lines: ${at.join(', ')}. Include more surrounding context to make it unique.`)
  }
  // index-slice (not String.replace): old_str/new_str stay literal, so '$' / '$&' / '$1'
  // in new_str aren't interpreted as replacement patterns. Match is unique here.
  const idx = content.indexOf(oldStr)
  writeFileSync(abs, content.slice(0, idx) + newStr + content.slice(idx + oldStr.length))
  return 'Successfully replaced text.'
}

function _create(path, fileText) {
  editGuards(path, fileText)
  const abs = resolveInApp(path)
  // Parity with the canonical workspace write (dev-supervisor os.MkdirAll): create missing
  // parent dirs so `create` into a new directory succeeds instead of throwing ENOENT.
  // Warn when a dir is new so a path typo that silently materializes a junk dir is visible.
  const dir = dirname(abs)
  if (!existsSync(dir)) console.warn(`turnscript.create: created missing parent directory ${relative(APP_ROOT, dir)}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(abs, fileText)
  return `Successfully created ${basename(path)}`
}

function _insert(path, insertLine, insertText) {
  editGuards(path, insertText)
  const abs = resolveInApp(path)
  if (!existsSync(abs)) throw new Error(`File not found: ${path}`)
  const lines = readFileSync(abs, 'utf8').split('\n')
  // Anthropic semantics: insert AFTER 0-indexed line N -> splice at N+1... matches
  // the workspace adapter (after-N == before-N+1). insertLine is 0-based "after".
  lines.splice(insertLine, 0, insertText)
  writeFileSync(abs, lines.join('\n'))
  return `Successfully inserted text at line ${insertLine}`
}

function _strReplaceEdit({ command, path, view_range, old_str, new_str, file_text, insert_line, insert_text }) {
  if (['view', 'str_replace', 'insert'].includes(command)) {
    const blocked = isFileBlocked(path)
    if (blocked.blocked) throw new Error(`File blocked: ${blocked.reason} Do not retry — use a different approach.`)
  }
  let out
  switch (command) {
    case 'view': return _view(path, view_range)
    case 'str_replace':
      // == null catches null too (mirror text-editor.ts): a null new_str serializes to ""
      // downstream and would silently DELETE old_str instead of replacing it.
      if (!old_str || new_str == null) throw new Error('str_replace requires old_str and new_str')
      out = _strReplace(path, old_str, new_str)
      break
    case 'create':
      if (file_text == null) throw new Error('create requires file_text')
      out = _create(path, file_text)
      break
    case 'insert':
      if (insert_line === undefined || !insert_text) throw new Error('insert requires insert_line and insert_text')
      out = _insert(path, insert_line, insert_text)
      break
    default: throw new Error(`Unknown command: ${command}`)
  }
  // Reached only when a write command succeeded (the sub-handlers throw on failure, and
  // `view` returns above), so this records genuine, successful writes only.
  __editedPaths.add(path)
  return out
}

function _grepSearch({ pattern, path, glob, type, '-i': caseInsensitive, output_mode }) {
  if (!pattern) throw new Error('grepSearch requires a pattern')
  const args = ['--no-heading', '--color=never', '--line-number']
  if (caseInsensitive) args.push('-i')
  if (glob) args.push('-g', glob)
  if (type) args.push('-t', type)
  if (output_mode === 'files_with_matches') args.push('-l')
  if (output_mode === 'count') args.push('-c')
  // Confine the search target to the app dir: resolveInApp rejects `..` escapes, then pass the
  // app-RELATIVE target to rg (cwd is APP_ROOT) so match lines stay app-relative — matching the
  // canonical grepSearchAITool (which searches a relative target) and the prior eval's output.
  args.push('-e', pattern, relative(APP_ROOT, resolveInApp(path || '.')) || '.')
  try {
    const out = execFileSync('rg', args, { cwd: APP_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
    return out || 'No matches found.'
  } catch (e) {
    if (e && e.status === 1) return 'No matches found.'
    throw new Error(`Grep search failed: ${e && e.message ? e.message : String(e)}`)
  }
}

function _directoryListing({ path, directoriesOnly, pattern, search, maxDepth, showHidden }) {
  const base = resolveInApp(path || '.')
  if (!existsSync(base)) throw new Error(`Path not found: ${path || '.'}`)
  const limit = typeof maxDepth === 'number' ? maxDepth : 2
  const out = []
  // Bound the glob before compiling it to a RegExp (defense against a pathological pattern);
  // only `*` is a wildcard, every other regex meta char is escaped below.
  if (pattern && pattern.length > 200) throw new Error('directoryListing pattern too long (max 200 chars)')
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- escaped glob, length-bounded above, runs in-container on model input only
  const re = pattern ? new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') : null
  const needle = search ? search.toLowerCase() : null
  const walk = (dir, depth, prefix) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!showHidden && e.name.startsWith('.')) continue
      if (e.name === 'node_modules' || e.name === '.git') continue
      const isDir = e.isDirectory()
      if (directoriesOnly && !isDir) continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if ((!re || re.test(e.name)) && (!needle || e.name.toLowerCase().includes(needle))) out.push(isDir ? `${rel}/` : rel)
      if (isDir && depth < limit) walk(resolve(dir, e.name), depth + 1, rel)
    }
  }
  walk(base, 0, '')
  return out.length ? `Contents:\n${out.join('\n')}` : 'Empty.'
}

// ---------- dispatch recorder (no-rethrow: a failed dispatch becomes data) ----------

async function dispatch(tool, fn) {
  if (++__count > MAX_DISPATCHES) throw new Error('__TURNSCRIPT_DISPATCH_CAP__')
  const t = Date.now()
  try {
    const out = await fn()
    const text = typeof out === 'string' ? out : JSON.stringify(out)
    __dispatches.push({ tool, ms: Date.now() - t, ok: true, status: 'ok', resultBytes: Buffer.byteLength(text || '') })
    return out
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    if (msg.includes('__TURNSCRIPT_DISPATCH_CAP__')) throw e
    __dispatches.push({ tool, ms: Date.now() - t, ok: false, status: 'throw', resultBytes: 0, error: msg })
    return `[error] ${msg}`
  }
}

const turnscript = {
  readFile: (a) => dispatch('readFile', () => _readFile(a)),
  grepSearch: (a) => dispatch('grepSearch', () => _grepSearch(a)),
  directoryListing: (a) => dispatch('directoryListing', () => _directoryListing(a)),
  str_replace_based_edit_tool: (a) => dispatch('str_replace_based_edit_tool', () => _strReplaceEdit(a)),
}

// ---------- runner: invoke the injected model function, print one JSON envelope ----------

// Deferred a microtask so the model fn (appended after this module's body by
// runner.ts) is assigned before the runner checks for it — an async IIFE would run
// its sync prefix (the typeof check) before that assignment executes.
Promise.resolve().then(async () => {
  let envelope
  try {
    if (typeof globalThis.__turnscriptUserFn !== 'function') {
      throw new Error('not_a_function: script must evaluate to an async function')
    }
    const result = await globalThis.__turnscriptUserFn()
    envelope = { ok: true, result, dispatches: __dispatches, logs: __logs, editedPaths: [...__editedPaths] }
  } catch (e) {
    const raw = e && e.message ? e.message : String(e)
    const failureKind = raw.includes('__TURNSCRIPT_DISPATCH_CAP__') ? 'dispatch_cap'
      : raw.startsWith('not_a_function') ? 'not_a_function' : 'runtime_throw'
    const error = raw.includes('__TURNSCRIPT_DISPATCH_CAP__')
      ? `dispatch cap exceeded (${MAX_DISPATCHES})` : raw
    // Include edits even on failure: the sub-handlers write before any later throw, so a
    // partially-applied run still reports the files it touched.
    envelope = { ok: false, result: null, error, failureKind, dispatches: __dispatches, logs: __logs, editedPaths: [...__editedPaths] }
  }
  // Cap the envelope so a script that returns large content (e.g. full file dumps)
  // doesn't blow the /exec stdout limit and truncate the JSON — which the runner would
  // then misread as a failure. The model only ever sees ~8000 chars (formatTurnscriptResult
  // slices), so this loses nothing material and nudges toward concise summaries.
  let json = JSON.stringify(envelope)
  if (json.length > 24000) {
    const r = typeof envelope.result === 'string' ? envelope.result : JSON.stringify(envelope.result ?? null)
    envelope.result = String(r).slice(0, 12000) + '\n…[truncated by turnscript — return a concise summary, not full file contents]'
    if (Array.isArray(envelope.logs) && envelope.logs.length > 20) envelope.logs = envelope.logs.slice(-20)
    json = JSON.stringify(envelope)
  }
  // Transport: emit the envelope as base64 across multiple lines, each well under the
  // dev-supervisor per-line cap (taskOutputMaxLineLen = 4096 bytes; 1000-line total).
  // runner.ts reassembles by index and decodes. base64 so a line split can't break a
  // multi-byte UTF-8 sequence; writeSync(1) (synchronous) so a fast process exit can't
  // drop a buffered tail chunk and make a successful run look truncated.
  const b64 = Buffer.from(json, 'utf8').toString('base64')
  const chunkLen = 3900
  const total = Math.max(1, Math.ceil(b64.length / chunkLen))
  for (let i = 0; i < total; i++) {
    writeSync(1, `__TURNSCRIPT_CHUNK ${i}/${total} ${b64.slice(i * chunkLen, (i + 1) * chunkLen)}\n`)
  }
})
