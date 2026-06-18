export interface ComposerAttachmentCounts {
  /** UI-only; transport send guards pass selectedAssets/referencedFiles — ChatPane uploads staged files before sendMessage. */
  stagedFiles?: readonly unknown[] | null
  selectedAssets?: readonly unknown[] | null
  referencedFiles?: readonly unknown[] | null
}

export function hasComposerAttachments(input: ComposerAttachmentCounts): boolean {
  return (input.stagedFiles?.length ?? 0) > 0
    || (input.selectedAssets?.length ?? 0) > 0
    || (input.referencedFiles?.length ?? 0) > 0
}

export function hasComposerSendPayload(
  content: string | undefined | null,
  attachments: ComposerAttachmentCounts,
): boolean {
  return Boolean(content?.trim()) || hasComposerAttachments(attachments)
}
