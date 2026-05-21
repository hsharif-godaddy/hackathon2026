export type CommitMessageSegment =
  | { type: 'text'; value: string }
  | { type: 'hex'; value: string; normalized: string }

const HEX_TOKEN =
  /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

function normalizeHexForSwatch(hex: string): string {
  const body = hex.slice(1)
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
  }
  if (body.length === 8) {
    return `#${body.slice(0, 6)}`
  }
  return hex
}

export function parseCommitMessageHex(message: string): CommitMessageSegment[] {
  if (!message) {
    return [{ type: 'text', value: '' }]
  }

  const segments: CommitMessageSegment[] = []
  let lastIndex = 0

  for (const match of message.matchAll(HEX_TOKEN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ type: 'text', value: message.slice(lastIndex, index) })
    }
    const value = match[0]
    segments.push({
      type: 'hex',
      value,
      normalized: normalizeHexForSwatch(value),
    })
    lastIndex = index + value.length
  }

  if (lastIndex < message.length) {
    segments.push({ type: 'text', value: message.slice(lastIndex) })
  }

  return segments
}
