export const MAX_USER_MESSAGE_CONTENT_LENGTH = 4_000;

/**
 * Higher cap for assistant replies and tool results so plans/code survive summarization.
 */
export const MAX_ASSISTANT_TOOL_MESSAGE_CONTENT_LENGTH = 50_000;

/**
 * Truncate content that exceeds maxLength.
 * Returns empty string for falsy input.
 */
export function truncateContent(content: string | undefined | null, maxLength: number): string {
  if (!content) return '';
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '\n[...truncated]';
}
