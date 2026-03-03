/**
 * Runtime error data structure from AiroErrorBoundary
 * This matches the interface in app-templates/v8/dev-tools/src/types.ts
 */
export interface RuntimeErrorData {
  message: string
  name: string
  stack?: string
  componentStack?: string
  url?: string
  timestamp?: number
}
