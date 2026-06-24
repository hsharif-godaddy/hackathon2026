import { cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Mirror agents/Dockerfile's `cp -r src/reference dist/` so local builds (and
// any consumer importing @airo/agents from dist) can resolve reference corpora
// markdown at runtime.
const agentsRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')
const srcDir = path.join(agentsRoot, 'src/reference')
const destDir = path.join(agentsRoot, 'dist/reference')

await cp(srcDir, destDir, { recursive: true })
