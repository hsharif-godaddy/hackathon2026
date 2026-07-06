import { retrieveAndUploadFiles, type StoredFileEntry } from '@/lib/quick-create'
import { logger } from '@/lib/request-context'
import type { SendMessageOptions } from '@/services/transport/messageTypes'

export interface SendPendingAutoSendMessageOptions {
  messageToSend: string
  appId: string
  jobId?: string | null
  templateId: string | null
  overrideAgentId?: string | null
  uploadedFiles?: Array<{ name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; isImage?: boolean }> | null
  designKitSlug?: string | null
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
  // Deep Build reuses uploaded docs (brief.md, business-details.md) to seed a
  // session. Attaching a file must NOT downgrade the template to 'file-upload' —
  // the deep-build orchestrator must stay engaged so it can skip seeded stages.
  if (fallbackTemplateId === 'deep-build') return 'deep-build'
  if (uploaded.length === 0) return fallbackTemplateId ?? undefined
  if (uploaded.some(f => f.isUiKit)) return 'ui-kit-import'
  if (uploaded.some(f => f.isAppImport)) return 'zip-import'
  if (uploaded.some(f => f.isZip)) return 'zip-import'
  if (uploaded.some(f => !f.isDesignMd)) return 'file-upload'
  return fallbackTemplateId ?? undefined
}

function computeContextType(uploaded: StoredFileEntry[], templateId: string | null): string {
  // In Deep Build mode, non-image uploads are prior-session docs routed to
  // canonical paths by DeepBuildDocContextRenderer. Images still flow through
  // the adaptive file_upload renderer for vision/classification.
  if (templateId === 'deep-build' && uploaded.some(f => !f.isImage)) return 'deep_build_doc'
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
    overrideAgentId,
    uploadedFiles,
    send,
    setInputValue,
    markInitialPromptSent,
    markFirstFileEditSeen,
    onSettled,
    onUploadsFailed,
    designKitSlug,
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

    // A project restore/import ZIP (app-import or plain zip) was attached but
    // none of them uploaded — the archive was corrupt or its contents weren't a
    // recognizable Airo export, so nothing was written. Route to the zip-import
    // mode with an explicit failure signal so the agent tells the user the file
    // couldn't be used instead of sending them back to re-import the same ZIP.
    const failedZipFiles: NonNullable<typeof uploadedFiles> = (uploadedFiles ?? []).filter(
      f => (f.isAppImport || f.isZip) && failed.includes(f.name),
    )
    const zipImportFailed: boolean = failedZipFiles.length > 0 && !uploaded.some(f => f.isAppImport || f.isZip)

    const effectiveTemplateId = zipImportFailed ? 'zip-import' : computeTemplateId(uploaded, templateId)
    const contextType = computeContextType(uploaded, templateId)

    if (designKitSlug) {
      logger.info('develop-page.auto-send.designKit', { appId, designKitSlug })
    }

    await send({
      content: messageToSend,
      aiEditContext: null,
      templateId: effectiveTemplateId,
      overrideAgentId: overrideAgentId ?? undefined,
      designKitSlug: designKitSlug ?? undefined,
      ...(uploaded.length > 0
        ? {
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
        }
        : zipImportFailed
          ? {
            customContext: {
              type: 'app_import_upload',
              persistence: 'ephemeral',
              data: {
                failed: true,
                files: failedZipFiles.map(f => ({
                  name: f.name,
                  isDesignMd: f.isDesignMd,
                  isZip: f.isZip,
                  isUiKit: f.isUiKit,
                  isAppImport: f.isAppImport,
                  isImage: f.isImage,
                })),
              },
            },
          }
          : {}),
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
