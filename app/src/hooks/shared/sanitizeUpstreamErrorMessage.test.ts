import { describe, expect, it } from 'vitest'

import {
  resolveUpstreamErrorStatusCode,
  sanitizeUpstreamErrorMessage,
} from '@/hooks/shared/sanitizeUpstreamErrorMessage'

const t = (key: string) => key

describe('sanitizeUpstreamErrorMessage', function sanitizeUpstreamErrorMessageTests() {
  it('replaces gateway timeout with generic copy', function gatewayTimeout() {
    expect(sanitizeUpstreamErrorMessage('Gateway Time-out', t)).toBe('builder_common_error_generic')
  })

  it('replaces retry exhaustion signals with generic copy', function retryFailed() {
    expect(sanitizeUpstreamErrorMessage('retry failed', t)).toBe('builder_common_error_generic')
    expect(sanitizeUpstreamErrorMessage('maxRetriesExceeded', t)).toBe('builder_common_error_generic')
  })

  it('preserves connection-dropped sentinel text for downstream UI mapping', function terminatedSentinel() {
    expect(sanitizeUpstreamErrorMessage('terminated', t)).toBe('terminated')
  })

  it('replaces 408 timeout tokens with generic copy', function requestTimeout() {
    expect(sanitizeUpstreamErrorMessage('408', t)).toBe('builder_common_error_generic')
  })

  it('preserves already-friendly server copy', function friendlyServerCopy() {
    const friendly = 'The AI took too long to respond and the request timed out. Please send your message again.'
    expect(sanitizeUpstreamErrorMessage(friendly, t)).toBe(friendly)
  })

  it('preserves plain-language errors that are not technical tokens', function plainLanguage() {
    expect(sanitizeUpstreamErrorMessage('something went wrong', t)).toBe('something went wrong')
  })
})

describe('resolveUpstreamErrorStatusCode', function resolveUpstreamErrorStatusCodeTests() {
  it('returns explicit timeout status codes unchanged', function explicitTimeout() {
    expect(resolveUpstreamErrorStatusCode('ignored', 504)).toBe(504)
    expect(resolveUpstreamErrorStatusCode('ignored', 408)).toBe(408)
  })

  it('infers 504 from gateway timeout text when status is missing', function gatewayTimeoutInference() {
    expect(resolveUpstreamErrorStatusCode('Gateway Time-out')).toBe(504)
  })

  it('parses status from Chat request failed messages', function chatRequestFailedStatus() {
    expect(resolveUpstreamErrorStatusCode('Chat request failed: 504')).toBe(504)
    expect(resolveUpstreamErrorStatusCode('Chat request failed: 503')).toBe(503)
  })
})
