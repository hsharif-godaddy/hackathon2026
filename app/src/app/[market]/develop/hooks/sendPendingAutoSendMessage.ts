import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import { logger } from '@/lib/request-context'

export interface SendPendingAutoSendMessageOptions {
  messageToSend: string
  appId: string
  templateId: string | null
  send: (options: SendMessageOptions) => Promise<void>
  setInputValue: (value: string) => void
  markInitialPromptSent: () => void
  onSettled: () => void
}

/**
 * Drives the auto-send try/catch/finally for the initial prompt on the develop
 * page. Extracted so the catch (input-restore) and finally (lock-release)
 * branches can be unit-tested without mounting the full page.
 *
 * Behavior contract:
 * - On `send` rejection: logs `develop-page.auto-send.failed` and restores the
 *   prompt to the chat input so the user can retry.
 * - On both success and failure paths: clears caller-owned refs via
 *   `onSettled()` and releases the `isAwaitingStream` lock by calling
 *   `markInitialPromptSent()`.
 * - Both `onSettled()` and `markInitialPromptSent()` are individually wrapped
 *   in try/catch so a throw in either does not prevent the other from running
 *   (refs must always clear; the lock must always release). `markInitialPromptSent`
 *   synchronously touches `sessionStorage` and can throw a `SecurityError` in
 *   privacy-restricted contexts (Safari ITP, sandboxed iframes, restrictive
 *   `cookieBehavior`). `onSettled` today only assigns to refs, but the contract
 *   does not guarantee infallibility — defensive wrapping prevents a future
 *   throw there from permanently locking `isAwaitingStream = true`.
 * - When `markInitialPromptSent()` throws after a `send` rejection, the
 *   `finally-failed` log includes the original send error as `originalError`
 *   so a Loki/Grafana diagnosis can correlate the two failures.
 */
export async function sendPendingAutoSendMessage(
  opts: SendPendingAutoSendMessageOptions,
): Promise<void> {
  const {
    messageToSend,
    appId,
    templateId,
    send,
    setInputValue,
    markInitialPromptSent,
    onSettled,
  } = opts

  let outerError: unknown = null
  try {
    await send({
      content: messageToSend,
      aiEditContext: null,
      templateId: templateId ?? undefined,
    })
  } catch (error) {
    outerError = error
    logger.error('develop-page.auto-send.failed', {
      error: error instanceof Error ? error.message : String(error),
      appId,
    })
    setInputValue(messageToSend)
  } finally {
    try {
      onSettled()
    } catch (settledError) {
      logger.error('develop-page.auto-send.on-settled-failed', {
        error: settledError instanceof Error ? settledError.message : String(settledError),
        appId,
      })
    }
    try {
      markInitialPromptSent()
    } catch (finallyError) {
      logger.error('develop-page.auto-send.finally-failed', {
        error: finallyError instanceof Error ? finallyError.message : String(finallyError),
        appId,
        ...(outerError != null && {
          originalError: outerError instanceof Error ? outerError.message : String(outerError),
        }),
      })
    }
  }
}
