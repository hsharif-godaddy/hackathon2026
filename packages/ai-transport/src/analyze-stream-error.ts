/** Structured breakdown of a stream-time error for logs and Langfuse
 * emission. */
export interface AnalyzedStreamError {
  type: string
  message: string
  isNetworkError: boolean
  isAbortError: boolean
  code: string | undefined
  causeChain: string[]
  statusCode: number | undefined
  responseBody: string | undefined
}

const KNOWN_NETWORK_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_REQUEST_TIMEOUT',
])

const NETWORK_ERROR_MESSAGES = ['terminated', 'other side closed', 'content-length']

export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  const errorMessage = error instanceof Error ? error.message : ''
  const errorName = error instanceof Error ? error.name : ''
  const errorCode = (error as { code?: string })?.code || ''
  const errorCause = (error as { cause?: { code?: string } })?.cause

  if (KNOWN_NETWORK_CODES.has(errorCode) || (errorCause && errorCause.code && KNOWN_NETWORK_CODES.has(errorCause.code))) {
    return true
  }

  const isNetworkErrorName =
    (errorName === 'TypeError' && errorMessage.includes('terminated')) ||
    errorName === 'FetchError' ||
    errorName === 'SocketError'

  const hasNetworkMessage = NETWORK_ERROR_MESSAGES.some(msg => errorMessage.includes(msg))

  return isNetworkErrorName || hasNetworkMessage
}

/** Walk up to 5 levels of `error.cause` to surface the root network/socket
 * error. Extracts `statusCode` + truncated `responseBody` off AI-SDK
 * `APICallError`-shaped errors. Pure — no I/O, no logging. */
export function analyzeStreamError(error: unknown): AnalyzedStreamError {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorName = error instanceof Error ? error.name : 'UnknownError'

  const isAbortError =
    errorName === 'AbortError' ||
    errorMessage.includes('aborted') ||
    errorMessage.includes('cancelled') ||
    errorMessage.includes('canceled')

  const isNet = isNetworkError(error)

  let errorType = 'UnknownError'
  if (isAbortError) {
    errorType = 'AbortError'
  } else if (isNet) {
    errorType = 'NetworkError'
  } else if (errorName) {
    errorType = errorName
  }

  const code = (error as { code?: string })?.code

  const causeChain: string[] = []
  let current: unknown = (error as { cause?: unknown })?.cause
  while (current && causeChain.length < 5) {
    if (current instanceof Error) {
      const causeCode = (current as { code?: string }).code ? ` [${(current as { code?: string }).code}]` : ''
      causeChain.push(`${current.name}: ${current.message}${causeCode}`)
      current = (current as { cause?: unknown }).cause
    } else if (typeof current === 'string') {
      causeChain.push(current)
      break
    } else if (typeof current === 'object' && current !== null) {
      const obj = current as Record<string, unknown>
      const causeCode = typeof obj.code === 'string' ? ` [${obj.code}]` : ''
      // JSON.stringify throws on circular references (e.g. a Node socket
      // reachable via error.cause). The catch keeps analyzeStreamError
      // from propagating out of the transport's outer catch and silently
      // aborting the error-publish path.
      let msg: string
      if (typeof obj.message === 'string') {
        msg = obj.message
      } else {
        try { msg = JSON.stringify(current) }
        catch { msg = '[non-serializable object]' }
      }
      const name = typeof obj.name === 'string' ? obj.name : 'Object'
      causeChain.push(`${name}: ${msg}${causeCode}`)
      current = obj.cause
    } else {
      causeChain.push(String(current))
      break
    }
  }

  const statusCode = (error as { statusCode?: number })?.statusCode
  const rawBody = (error as { responseBody?: unknown })?.responseBody
  const responseBody = typeof rawBody === 'string' ? rawBody.slice(0, 500) : undefined

  return {
    type: errorType,
    message: errorMessage,
    isNetworkError: isNet,
    isAbortError,
    code,
    causeChain,
    statusCode,
    responseBody,
  }
}
