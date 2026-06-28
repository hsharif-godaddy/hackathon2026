import type { AddressInfo } from 'node:net'
import type http from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createControlServer } from '../control.js'
import { FaultController } from '../faults.js'

const servers: http.Server[] = []

afterEach(async (): Promise<void> => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function start(env?: NodeJS.ProcessEnv): Promise<{ base: string; controller: FaultController }> {
  const controller: FaultController = new FaultController()
  const config: Parameters<typeof createControlServer>[0] = { controller, log: (): void => {} }
  if (env) {
    config.env = env
  }
  const server: http.Server = createControlServer(config)
  servers.push(server)
  const port: number = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  )
  return { base: `http://127.0.0.1:${port}`, controller }
}

describe('control server', () => {
  it('reports health', async (): Promise<void> => {
    const { base } = await start()
    const res: Response = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('arms a fault and reflects it in /state', async (): Promise<void> => {
    const { base } = await start()
    const armed: Response = await fetch(`${base}/arm`, {
      method: 'POST',
      body: JSON.stringify({ fault: 'premature-close', count: 2, scope: 'all' }),
    })
    expect(armed.status).toBe(200)
    const state: Response = await fetch(`${base}/state`)
    expect(await state.json()).toMatchObject({ armed: true, fault: 'premature-close', remaining: 2, scope: 'all' })
  })

  it('rejects an unknown fault name', async (): Promise<void> => {
    const { base } = await start()
    const res: Response = await fetch(`${base}/arm`, { method: 'POST', body: JSON.stringify({ fault: 'nope' }) })
    expect(res.status).toBe(400)
  })

  it('disarms', async (): Promise<void> => {
    const { base, controller } = await start()
    controller.arm({ fault: 'invalid-chunk' })
    const res: Response = await fetch(`${base}/disarm`, { method: 'POST' })
    expect(await res.json()).toEqual({ armed: false })
    expect(controller.snapshot()).toBeNull()
  })

  it('drops malformed params instead of crashing, falling back to defaults', async (): Promise<void> => {
    const { base, controller } = await start()
    const res: Response = await fetch(`${base}/arm`, {
      method: 'POST',
      body: JSON.stringify({ fault: 'http-error', params: { status: 'oops', afterChunks: -5 } }),
    })
    expect(res.status).toBe(200)
    expect(controller.snapshot()?.params).toEqual({})
  })

  it('refuses to arm under NODE_ENV=production', async (): Promise<void> => {
    const { base, controller } = await start({ NODE_ENV: 'production' })
    const res: Response = await fetch(`${base}/arm`, { method: 'POST', body: JSON.stringify({ fault: 'http-error' }) })
    expect(res.status).toBe(403)
    expect(controller.snapshot()).toBeNull()
  })
})
