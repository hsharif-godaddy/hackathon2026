import { cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const agentsRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')
const srcDir = path.join(agentsRoot, 'src/agents/assessment-agent/models')
const destDir = path.join(agentsRoot, 'dist/agents/assessment-agent/models')

await cp(srcDir, destDir, { recursive: true })
