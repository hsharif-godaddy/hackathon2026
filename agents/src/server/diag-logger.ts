import { diag, DiagLogLevel } from '@opentelemetry/api'

type DiagLevel = 'debug' | 'info' | 'warn' | 'error'

export interface DiagEvent {
  msg: string
  args: unknown[]
  suppressedSinceLast: number
}

export type DiagSink = (level: DiagLevel, event: DiagEvent) => void

const DEDUPE_WINDOW_MS: number = 10 * 60 * 1000

function diagSignature(msg: string): string {
  return msg.replace(/\b(\d+|0x[0-9a-f]+|[0-9a-f]{8,})\b/gi, '*').slice(0, 120)
}

/**
 * Install an OTel diag logger that collapses repeated messages to one line per
 * signature (digits/hashes masked) per 10-minute window — a sustained
 * OTLP-export failure would otherwise flood the log stream. The first emission
 * after a quiet window reports how many were suppressed since it last logged.
 *
 * `sink` is where surviving lines go, kept abstract so this module imports only
 * @opentelemetry/api and is safe to load from the `--import` preload (which must
 * not pull in express-transitive deps like the pino logger). The preload passes
 * a console sink; instrumentation-extras passes a pino-backed one.
 */
export function installDedupingDiagLogger(sink: DiagSink, suppressOverrideMessage: boolean = false): void {
  const lastLoggedAt: Map<string, { at: number; suppressed: number }> = new Map()

  const emit = (level: DiagLevel, msg: string, args: unknown[]): void => {
    const sig: string = diagSignature(msg)
    const now: number = Date.now()
    const prev: { at: number; suppressed: number } | undefined = lastLoggedAt.get(sig)
    if (prev && now - prev.at < DEDUPE_WINDOW_MS) {
      prev.suppressed += 1
      return
    }
    const suppressedSinceLast: number = prev?.suppressed ?? 0
    lastLoggedAt.set(sig, { at: now, suppressed: 0 })
    sink(level, { msg, args, suppressedSinceLast })
  }

  diag.setLogger(
    {
      verbose: (msg: string, ...args: unknown[]): void => emit('debug', msg, args),
      debug: (msg: string, ...args: unknown[]): void => emit('debug', msg, args),
      info: (msg: string, ...args: unknown[]): void => emit('info', msg, args),
      warn: (msg: string, ...args: unknown[]): void => emit('warn', msg, args),
      error: (msg: string, ...args: unknown[]): void => emit('error', msg, args),
    },
    { logLevel: DiagLogLevel.INFO, suppressOverrideMessage },
  )
}
