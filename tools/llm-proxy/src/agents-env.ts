import fs from 'node:fs'
import path from 'node:path'

import type { AgentsEnv } from './resolve.js'

// Reads the agent's provider configuration from agents/.env. The proxy needs
// the mode and the real (non-proxied) upstreams; dev-runner injects the proxy
// base URLs into the agent process's environment, NOT into this file, so the
// file still holds the authoritative upstreams.
export function readAgentsEnv(startDir: string = process.cwd()): AgentsEnv {
  const root: string | null = findRepoRoot(startDir)
  if (!root) {
    // Mirror the agent's own default: it reads GOCODE_USE_S2S_AUTH === 'true',
    // so an unknown/unreadable config means api-key mode, same as a present
    // file that doesn't set the flag.
    return { s2s: false }
  }
  const env: Record<string, string> = parseEnvFile(path.join(root, 'agents', '.env'))
  const result: AgentsEnv = { s2s: env.GOCODE_USE_S2S_AUTH === 'true' }
  if (env.OPENAI_BASE_URL) {
    result.openaiBaseUrl = env.OPENAI_BASE_URL
  }
  if (env.ANTHROPIC_BASE_URL) {
    result.anthropicBaseUrl = env.ANTHROPIC_BASE_URL
  }
  return result
}

// Walks upward from startDir until it finds the workspace root (the directory
// containing pnpm-workspace.yaml). Returns null if none is found.
export function findRepoRoot(startDir: string): string | null {
  let dir: string = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent: string = path.dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
}

export function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const trimmed: string = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eq: number = trimmed.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key: string = trimmed.slice(0, eq).trim()
    let value: string = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}
