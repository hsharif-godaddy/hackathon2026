const MENTION_CAPTURE_REGEX = /#\d+\s*<([^>]+)>/g

export interface ParsedElementMention {
  tag: string
}

export function parseElementMentions(content: string): {
  mentions: ParsedElementMention[]
  text: string
} {
  const mentions: ParsedElementMention[] = []

  for (const match of content.matchAll(MENTION_CAPTURE_REGEX)) {
    mentions.push({ tag: match[1] })
  }

  // Only normalise whitespace when mentions were removed — avoids collapsing
  // intentional newlines in plain messages that contain no mention tokens.
  const text = mentions.length > 0
    ? content.replace(/\s*#\d+\s*<[^>]+>\s*/g, ' ').trim()
    : content

  return { mentions, text }
}
