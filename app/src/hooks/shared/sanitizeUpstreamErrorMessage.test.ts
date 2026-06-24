import { describe, expect, it } from 'vitest'

import {
  resolveUpstreamErrorStatusCode,
  sanitizeUpstreamErrorMessage,
} from '@/hooks/shared/sanitizeUpstreamErrorMessage'

const t = (key: string) => key

describe('sanitizeUpstreamErrorMessage', function sanitizeUpstreamErrorMessageTests() {
  it('replaces raw text with generic copy when errorType is absent (allowlist)', function noErrorType() {
    expect(sanitizeUpstreamErrorMessage('Cannot connect to API: Connect Timeout Error', undefined, t))
      .toBe('builder_common_error_generic')
  })

  it('replaces raw text for non-allowlisted errorType (e.g. UPSTREAM_ERROR)', function unsafeType() {
    expect(sanitizeUpstreamErrorMessage('socket hang up at 10.0.0.1:443', 'UPSTREAM_ERROR', t))
      .toBe('builder_common_error_generic')
  })

  it('preserves the server-curated message for an allowlisted errorType', function safeType() {
    const curated = 'Budget service temporarily unavailable'
    expect(sanitizeUpstreamErrorMessage(curated, 'BUDGET_SERVICE_UNAVAILABLE', t)).toBe(curated)
    const network = 'A network error interrupted the connection. Please send your message again.'
    expect(sanitizeUpstreamErrorMessage(network, 'NETWORK_ERROR', t)).toBe(network)
  })

  it('replaces an empty message with generic copy even for an allowlisted type', function emptySafe() {
    expect(sanitizeUpstreamErrorMessage('   ', 'NETWORK_ERROR', t)).toBe('builder_common_error_generic')
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
