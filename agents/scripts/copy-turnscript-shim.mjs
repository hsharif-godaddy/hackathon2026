import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// runner.ts reads runtime/shim.mjs at module load via `new URL('./runtime/shim.mjs',
// import.meta.url)`. tsc does NOT emit non-.ts files, so without this copy the shim is
// absent from dist and the agent fails to boot in production (works in dev only because
// tsx runs from src). Mirror the .mjs into dist next to its compiled runner.js. The
// runtime/ dir holds no .ts files, so tsc never creates it in dist — mkdir it first.
const agentsRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')
const src = path.join(agentsRoot, 'src/tools/ai-lib-tools/turnscript/runtime/shim.mjs')
const dest = path.join(agentsRoot, 'dist/tools/ai-lib-tools/turnscript/runtime/shim.mjs')

await mkdir(path.dirname(dest), { recursive: true })
await cp(src, dest)
