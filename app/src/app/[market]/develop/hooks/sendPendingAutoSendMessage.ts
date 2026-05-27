import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import { retrieveAndUploadFile } from '@/lib/quick-create'
import { logger } from '@/lib/request-context'

export interface SendPendingAutoSendMessageOptions {
  messageToSend: string
  appId: string
  jobId?: string | null
  templateId: string | null
  uploadedFile?: { name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; isImage?: boolean } | null
  send: (options: SendMessageOptions) => Promise<void>
  setInputValue: (value: string) => void
  markInitialPromptSent: () => void
  markFirstFileEditSeen: () => void
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
    jobId,
    templateId,
    uploadedFile,
    send,
    setInputValue,
    markInitialPromptSent,
    markFirstFileEditSeen,
    onSettled,
  } = opts

  const effectiveTemplateId = uploadedFile?.isUiKit
    ? 'ui-kit-import'
    : (uploadedFile?.isAppImport || uploadedFile?.isZip)
      ? 'zip-import'
      : uploadedFile
        ? 'file-upload'
        : (templateId ?? undefined)

  let outerError: unknown = null
  try {
    // Upload file to agent via HTTP (all file types use the same path)
    let fileUploaded = false
    if (uploadedFile) {
      try {
        fileUploaded = await retrieveAndUploadFile(appId, jobId)
        if (fileUploaded && uploadedFile.isAppImport) {
          markFirstFileEditSeen()
        }
      } catch (uploadError) {
        logger.error('develop-page.file-upload.failed', {
          error: uploadError instanceof Error ? uploadError.message : JSON.stringify(uploadError),
          appId,
        })
      }
      if (!fileUploaded && uploadedFile.isAppImport) {
        markFirstFileEditSeen()
      }
    }

    const contextType = uploadedFile?.isUiKit
      ? 'ui_kit_upload'
      : uploadedFile?.isAppImport
        ? 'app_import_upload'
        : uploadedFile?.isZip
          ? 'zip_upload'
          : 'file_upload'

    await send({
      content: messageToSend,
      aiEditContext: null,
      templateId: fileUploaded ? effectiveTemplateId : (templateId ?? undefined),
      ...(fileUploaded && {
        uploadedFileName: uploadedFile!.name,
        customContext: {
          type: contextType,
          persistence: 'save',
          data: { uploaded: true, name: uploadedFile!.name, isDesignMd: uploadedFile!.isDesignMd, isZip: uploadedFile!.isZip, isUiKit: uploadedFile!.isUiKit, isAppImport: uploadedFile!.isAppImport, isImage: uploadedFile!.isImage },
        },
      }),
    })
    setInputValue('')
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
