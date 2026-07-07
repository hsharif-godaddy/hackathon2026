import { describe, it, expect } from 'vitest'
import { buildResultEnvelope, type SubAgentUsage } from '../result-envelope.js'

const USAGE: SubAgentUsage = {
  modelName: 'm',
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  steps: 1,
}

describe('buildResultEnvelope', () => {
  it('normalizes a well-formed result', () => {
    const env = buildResultEnvelope({
      jobId: 'job_1',
      agent: 'builder',
      title: 'Home',
      status: 'success',
      summary: 'built',
      artifacts: ['index.html'],
    })
    expect(env).toMatchObject({ jobId: 'job_1', agent: 'builder', status: 'success', summary: 'built', artifacts: ['index.html'] })
  })

  it('passes usage and durationMs through', () => {
    const env = buildResultEnvelope({ jobId: 'j', agent: 'a', title: 't', status: 'success', usage: USAGE, durationMs: 1234 })
    expect(env.usage).toEqual(USAGE)
    expect(env.durationMs).toBe(1234)
  })

  it('drops a malformed soft field instead of failing the whole parse', () => {
    const env = buildResultEnvelope({
      jobId: 'j',
      agent: 'a',
      title: 't',
      status: 'success',
      artifacts: 'not-an-array' as unknown as string[],
    })
    expect(env.status).toBe('success')
    expect(env.artifacts).toBeUndefined()
  })

  it('degrades to an error envelope (does not throw) when identity fields are malformed', () => {
    const bad = { jobId: 123, agent: null, title: undefined, status: 'nonsense', summary: 'partial' } as unknown as Parameters<typeof buildResultEnvelope>[0]
    const env = buildResultEnvelope(bad)
    expect(env.status).toBe('error')
    expect(env.jobId).toBe('unknown')
    expect(env.agent).toBe('unknown')
    expect(env.error).toContain('failed validation')
    // A soft field that IS valid is still preserved on the degraded envelope.
    expect(env.summary).toBe('partial')
  })
})
