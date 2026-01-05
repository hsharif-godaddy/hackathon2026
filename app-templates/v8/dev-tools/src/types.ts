/**
 * Runtime error data structure sent from AiroErrorBoundary to the parent window
 */
export interface RuntimeErrorData {
  message: string
  name: string
  stack?: string
  componentStack?: string
  url?: string
  timestamp?: number
}

/**
 * Message types for postMessage communication between app and builder
 */
export interface ErrorFixRequestMessage {
  type: 'error-fix-request'
  errorData: RuntimeErrorData
}
