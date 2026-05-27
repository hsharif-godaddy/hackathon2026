import { cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Mirror agents/Dockerfile's `cp -r src/prompts dist/` so local builds (and
// any consumer importing @airo/agents from dist, e.g. the rebuild-prompts
// eval workspace) can resolve modular prompt files at runtime.
const agentsRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')
const srcDir = path.join(agentsRoot, 'src/prompts')
const destDir = path.join(agentsRoot, 'dist/prompts')

await cp(srcDir, destDir, { recursive: true })
