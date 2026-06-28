import type { Server } from 'node:http'

import { readAgentsEnv } from './agents-env.js'
import { createControlServer } from './control.js'
import { FaultController } from './faults.js'
import { createRelayServer, type RelayConfig } from './relay.js'
import type { AgentsEnv } from './resolve.js'
import { GREEN, RESET } from './sse-log.js'

// Parses a port from a proxy-specific env var, falling back when unset, empty,
// or non-numeric. `|| fallback` catches both NaN (non-numeric) and 0 (empty
// string), either of which would otherwise bind a random port.
function port(raw: string | undefined, fallback: number): number {
  return Number(raw) || fallback
}

// Loopback only: neither listener should ever be reachable off the dev box.
const HOST: string = '127.0.0.1'
// Deliberately NOT reading the generic `PORT`: it's commonly exported (the env
// fixer writes PORT=3000), which would move the data listener off 8788 while
// dev-runner hardcodes 8788 for the agent base URLs and health check — the
// proxy would look healthy but every agent call would get ECONNREFUSED.
const DATA_PORT: number = port(process.env.LLM_PROXY_PORT, 8788)
const CONTROL_PORT: number = port(process.env.LLM_PROXY_CONTROL_PORT, 8789)
const upstreamOverride: string | undefined = process.env.UPSTREAM_URL

const controller: FaultController = new FaultController()
const proxyOrigin: string = `http://${HOST}:${DATA_PORT}`
const agentsEnv: AgentsEnv = readAgentsEnv()

const relayConfig: RelayConfig = { controller, proxyOrigin, agentsEnv }
if (upstreamOverride) {
  relayConfig.upstreamOverride = upstreamOverride
}

const relay: Server = createRelayServer(relayConfig)
const control: Server = createControlServer({ controller })

relay.listen(DATA_PORT, HOST, (): void => {
  console.log(`${GREEN}llm-proxy data listener${RESET}  http://${HOST}:${DATA_PORT}`)
  if (upstreamOverride) {
    console.log(`  standalone upstream: ${upstreamOverride}`)
  } else {
    console.log(`  provider routing: /u/gocode  /u/anthropic  /u/openai  (agent mode: ${agentsEnv.s2s ? 's2s' : 'api-key'})`)
  }
})

control.listen(CONTROL_PORT, HOST, (): void => {
  console.log(`${GREEN}llm-proxy control listener${RESET}  http://${HOST}:${CONTROL_PORT}`)
  console.log(`  GET /health  GET /state  POST /arm  POST /disarm`)
})
