/**
 * WAF (Web Application Firewall) validation utilities
 *
 * The Builder App has a WAF with an 8KB request body limit.
 * We use a 7,400 byte limit to provide a 600-byte safety margin
 * for JSON structure, headers, and encoding overhead.
 */

export const MAX_PROMPT_BYTES = 7400;

/**
 * Shared TextEncoder instance to avoid repeated allocations.
 * Reusing this reduces GC pressure on hot paths (e.g., keystroke validation).
 */
const textEncoder = new TextEncoder();

/**
 * Calculate the byte length of a string using UTF-8 encoding
 */
export function getByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

/**
 * Truncate text to fit within a byte limit using binary search
 * This is more efficient than iterating character by character
 * Ensures no broken surrogate pairs at the boundary
 */
export function truncateToByteLimit(text: string, maxBytes: number = MAX_PROMPT_BYTES): string {
  if (getByteLength(text) <= maxBytes) {
    return text;
  }

  let left = 0;
  let right = text.length;
  let result = '';

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const candidate = text.substring(0, mid);
    const byteLength = getByteLength(candidate);

    if (byteLength <= maxBytes) {
      result = candidate;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  // Check if result ends with an unpaired high surrogate (0xD800-0xDBFF)
  // This can happen when truncation splits a surrogate pair
  if (result.length > 0) {
    const lastCharCode = result.charCodeAt(result.length - 1);
    if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
      // Remove the unpaired high surrogate
      result = result.slice(0, -1);
    }
  }

  return result;
}

/**
 * Validate and clamp a prompt to the byte limit
 * Returns validation metadata for UI feedback
 */
export function validateAndClampPrompt(text: string) {
  // Check validity of ORIGINAL text before clamping
  const originalByteLength = getByteLength(text);
  const isValid = originalByteLength <= MAX_PROMPT_BYTES;

  const clamped = truncateToByteLimit(text);
  const byteLength = getByteLength(clamped);
  const wasClipped = clamped.length !== text.length;

  return {
    text: clamped,
    byteLength,
    charLength: clamped.length,
    wasClipped,
    isValid, // Based on original text, not clamped
    // Estimate remaining characters assuming average 1.2 bytes per char
    // (ASCII = 1 byte, common Unicode = 2-3 bytes, emojis = 3-4 bytes)
    remainingChars: Math.max(0, Math.floor((MAX_PROMPT_BYTES - byteLength) / 1.2)),
  };
}
