export function formatSSEEvent(type: string, data: Record<string, unknown>, id?: number): string {
  const idLine = id !== undefined ? `id: ${id}\n` : ''
  return `${idLine}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}
