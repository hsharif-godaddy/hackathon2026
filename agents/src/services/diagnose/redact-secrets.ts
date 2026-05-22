/** Strip common secret patterns before project excerpts are sent to the LLM. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}
