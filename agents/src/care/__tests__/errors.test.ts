import { describe, it, expect } from 'vitest'
import { AgentClientError, NetworkError, TimeoutError } from '@airo-care/client'
import { userFacingErrorMessage } from '../errors.js'

describe('userFacingErrorMessage', () => {
  it('returns the generic message for a NetworkError', () => {
    const msg = userFacingErrorMessage(new NetworkError('connection refused'))
    expect(msg).toContain('connection')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns a timeout-specific message for a TimeoutError', () => {
    const msg = userFacingErrorMessage(new TimeoutError('timed out', 30000))
    expect(msg.toLowerCase()).toContain('took too long')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns the generic message for a 5xx AgentClientError', () => {
    const msg = userFacingErrorMessage(new AgentClientError('boom', {
      fault: 'server', type: 'INTERNAL_SERVER_ERROR', statusCode: 500,
    }))
    expect(msg.toLowerCase()).toContain('support')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns a not-found message for a 404 AgentClientError', () => {
    const msg = userFacingErrorMessage(new AgentClientError('not found', {
      fault: 'client', type: 'NOT_FOUND', statusCode: 404,
    }))
    expect(msg.toLowerCase()).toContain('try again')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns the generic message for any other thrown value', () => {
    expect(userFacingErrorMessage('oops')).toMatch(/.+/)
    expect(userFacingErrorMessage(undefined)).toMatch(/.+/)
    expect(userFacingErrorMessage(new Error('weird'))).toMatch(/.+/)
  })

  it('never throws', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => userFacingErrorMessage(circular)).not.toThrow()
  })
})
