/**
 * Runtime error data structure from AiroErrorBoundary.
 * Keep in sync with `app-templates/v8/dev-tools/src/types.ts`.
 *
 * `cycleId` identifies the preview's current render generation — the
 * dev-tools client advances it on every Vite HMR boundary and on
 * initial load. The builder parent forwards it unchanged to the agents'
 * `POST /apps/:id/runtime-errors` so the server's runtime-error buffer
 * can drop entries from superseded generations (the "ghost error" fix).
 * See `agents/src/services/runtime-error-buffer.ts`.
 */
export interface RuntimeErrorData {
  message: string
  name: string
  cycleId: number
  stack?: string
  componentStack?: string
  url?: string
  timestamp?: number
  attemptNumber?: number
}
