export function todoListIdFromContextAttachments(contextAttachments: unknown): string | undefined {
  if (!Array.isArray(contextAttachments)) {
    return undefined
  }
  for (const raw of contextAttachments) {
    const attachment = raw as { type?: string; data?: { id?: unknown } }
    if (
      attachment?.type === 'todo_list_context' &&
      attachment.data &&
      typeof attachment.data.id === 'string' &&
      attachment.data.id.length > 0
    ) {
      return attachment.data.id
    }
  }
  return undefined
}
