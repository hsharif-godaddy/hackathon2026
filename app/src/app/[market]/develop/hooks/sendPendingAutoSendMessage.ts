import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import { retrieveAndUploadFiles, type StoredFileEntry } from '@/lib/quick-create'
import { logger } from '@/lib/request-context'

export interface SendPendingAutoSendMessageOptions {
  messageToSend: string
  appId: string
  jobId?: string | null
  templateId: string | null
  uploadedFiles?: Array<{ name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; isImage?: boolean }> | null
  send: (options: SendMessageOptions) => Promise<void>
  setInputValue: (value: string) => void
  markInitialPromptSent: () => void
  markFirstFileEditSeen: () => void
  onSettled: () => void
  onUploadsFailed?: (fileNames: string[]) => void
}

function computeTemplateId(
  uploaded: StoredFileEntry[],
  fallbackTemplateId: string | null,
): string | undefined {
  if (uploaded.length === 0) return fallbackTemplateId ?? undefined
  if (uploaded.some(f => f.isUiKit)) return 'ui-kit-import'
  if (uploaded.some(f => f.isAppImport)) return 'zip-import'
  if (uploaded.some(f => f.isZip)) return 'zip-import'
  if (uploaded.some(f => !f.isDesignMd)) return 'file-upload'
  return fallbackTemplateId ?? undefined
}

function computeContextType(uploaded: StoredFileEntry[]): string {
  if (uploaded.some(f => f.isUiKit)) return 'ui_kit_upload'
  if (uploaded.some(f => f.isAppImport)) return 'app_import_upload'
  if (uploaded.some(f => f.isZip)) return 'zip_upload'
  return 'file_upload'
}

export async function sendPendingAutoSendMessage(
  opts: SendPendingAutoSendMessageOptions,
): Promise<void> {
  const {
    messageToSend,
    appId,
    jobId,
    templateId,
    uploadedFiles,
    send,
    setInputValue,
    markInitialPromptSent,
    markFirstFileEditSeen,
    onSettled,
    onUploadsFailed,
  } = opts

  let outerError: unknown = null
  try {
    let uploaded: StoredFileEntry[] = []
    let failed: string[] = []
    if (uploadedFiles && uploadedFiles.length > 0) {
      const expectedFileNames = uploadedFiles.map(f => f.name)
      try {
        const result = await retrieveAndUploadFiles(appId, jobId, expectedFileNames)
        uploaded = result.uploaded
        failed = result.failed
        if (uploaded.some(f => f.isAppImport)) {
          markFirstFileEditSeen()
        }
      } catch (uploadError) {
        logger.error('develop-page.file-upload.failed', {
          error: uploadError instanceof Error ? uploadError.message : JSON.stringify(uploadError),
          appId,
        })
        // Surface the failure to the user rather than sending silently with no
        // attached context — every expected file is considered failed.
        failed = expectedFileNames
      }
      if (uploaded.length === 0 && uploadedFiles.some(f => f.isAppImport)) {
        markFirstFileEditSeen()
      }
      // Files were attached this turn but nothing came back as uploaded or
      // failed — the binaries weren't found in IndexedDB (record missing / key
      // mismatch). Surface it instead of silently sending with no context.
      if (uploaded.length === 0 && failed.length === 0) {
        failed = expectedFileNames
      }
      if (failed.length > 0) {
        onUploadsFailed?.(failed)
      }
    }

    const effectiveTemplateId = computeTemplateId(uploaded, templateId)
    const contextType = computeContextType(uploaded)

    await send({
      content: messageToSend,
      aiEditContext: null,
      templateId: effectiveTemplateId,
      ...(uploaded.length > 0 && {
        uploadedFileName: uploaded[0].fileName,
        customContext: {
          type: contextType,
          persistence: 'save',
          data: {
            files: uploaded.map(f => ({
              name: f.fileName,
              isDesignMd: f.isDesignMd,
              isZip: f.isZip,
              isUiKit: f.isUiKit,
              isAppImport: f.isAppImport,
              isImage: f.isImage,
            })),
          },
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
