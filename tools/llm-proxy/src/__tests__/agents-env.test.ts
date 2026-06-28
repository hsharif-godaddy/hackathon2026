import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findRepoRoot, parseEnvFile, readAgentsEnv } from '../agents-env.js'

const tmpDirs: string[] = []

afterEach((): void => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeRepo(agentsEnv: string): string {
  const root: string = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-proxy-'))
  tmpDirs.push(root)
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  const agentsDir: string = path.join(root, 'agents')
  fs.mkdirSync(agentsDir)
  fs.writeFileSync(path.join(agentsDir, '.env'), agentsEnv)
  return root
}

describe('parseEnvFile', () => {
  it('parses keys and strips surrounding quotes', () => {
    const root: string = makeRepo('A=plain\nB="quoted"\n# comment\nC=\n')
    const env: Record<string, string> = parseEnvFile(path.join(root, 'agents', '.env'))
    expect(env.A).toBe('plain')
    expect(env.B).toBe('quoted')
    expect(env.C).toBe('')
  })

  it('returns empty for a missing file', () => {
    expect(parseEnvFile('/no/such/file.env')).toEqual({})
  })
})

describe('findRepoRoot', () => {
  it('walks up to the pnpm-workspace.yaml directory', () => {
    const root: string = makeRepo('GOCODE_USE_S2S_AUTH=true\n')
    expect(findRepoRoot(path.join(root, 'agents'))).toBe(path.resolve(root))
  })
})

describe('readAgentsEnv', () => {
  it('detects s2s mode', () => {
    const root: string = makeRepo('GOCODE_USE_S2S_AUTH=true\n')
    expect(readAgentsEnv(path.join(root, 'agents'))).toEqual({ s2s: true })
  })

  it('reads api-key upstreams', () => {
    const root: string = makeRepo(
      'GOCODE_USE_S2S_AUTH=false\nOPENAI_BASE_URL="https://litellm.example.com"\nANTHROPIC_BASE_URL="https://litellm.example.com"\n',
    )
    expect(readAgentsEnv(path.join(root, 'agents'))).toEqual({
      s2s: false,
      openaiBaseUrl: 'https://litellm.example.com',
      anthropicBaseUrl: 'https://litellm.example.com',
    })
  })

  it('defaults to api-key mode when no repo root is found (matches the agent default)', () => {
    expect(readAgentsEnv('/')).toEqual({ s2s: false })
  })
})
