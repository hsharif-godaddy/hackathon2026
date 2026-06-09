/**
 * Display-only cleanup for raw scraped page text shown in the "View source" modal.
 *
 * This is PURELY presentational — it must never be called on data that feeds the
 * build pipeline. The stored snapshot and what the agent receives are always the
 * raw, unmodified sanitizedContent.
 *
 * Transforms applied (conservative — when in doubt, keep the text):
 *  1. Strip leading skip-link / a11y boilerplate ("0 Skip to Content", bare "0 ")
 *  2. Remove "Open Menu" / "Close Menu" toggle phrases (accessibility UI chrome)
 *  3. Collapse immediately-repeated word sequences (repeated nav blocks)
 *  4. Normalize whitespace
 */
export function cleanCapturedText(raw: string): string {
  if (!raw) return raw

  let text = raw

  // 1. Strip leading "0 Skip to Content" or just a bare leading "0 "
  text = text.replace(/^\s*0\s+Skip\s+to\s+Content\s*/i, '')
  text = text.replace(/^\s*0\s+/, '')

  // 2. Remove Open/Close Menu toggle phrases (case-insensitive)
  text = text.replace(/\bOpen\s+Menu\b/gi, '')
  text = text.replace(/\bClose\s+Menu\b/gi, '')

  // 3. Collapse repeated word-sequence runs.
  // Strategy: tokenize on whitespace, then use a sliding window to detect when
  // a contiguous sequence of N words repeats immediately. N=4 avoids false
  // positives on short common phrases while catching repeated nav blocks.
  text = collapseRepeatedSequences(text, 4)

  // 4. Normalize whitespace (collapse runs of spaces/newlines to a single space)
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

// Upper bound on tokens we will scan. This is display-only text; a multi-thousand
// token raw dump is already collapsed/scrolled in the modal, so truncating keeps
// the worst case bounded without losing anything a reader would actually scan.
const MAX_INPUT_TOKENS = 5000
// Longest repeated run we attempt to detect. Repeated nav/header blocks are short
// (well under this); without a cap the inner scan tries runs up to half the input
// at every position, which is the O(n^3) blowup the window removes.
const MAX_RUN_WINDOW = 50

/**
 * Given a space-separated string, removes any immediately-repeated run of
 * `minRun` or more tokens.
 *
 * E.g. "A B C D A B C D X" → "A B C D X"
 * Runs one pass until no further changes occur (handles multiple repeats).
 *
 * Complexity is bounded: input is capped at MAX_INPUT_TOKENS and the run window
 * at MAX_RUN_WINDOW, so each pass is O(n · window²) rather than O(n³).
 */
function collapseRepeatedSequences(text: string, minRun: number): string {
  const allTokens = text.split(/\s+/).filter(Boolean)
  if (allTokens.length < minRun * 2) return text
  const tokens =
    allTokens.length > MAX_INPUT_TOKENS ? allTokens.slice(0, MAX_INPUT_TOKENS) : allTokens

  let changed = true
  let current = tokens

  while (changed) {
    changed = false
    const next: string[] = []
    let i = 0

    while (i < current.length) {
      // Try the longest possible run first, capped at the window, down to minRun
      const maxRun = Math.min(MAX_RUN_WINDOW, Math.floor((current.length - i) / 2))
      let found = false

      for (let runLen = maxRun; runLen >= minRun; runLen--) {
        const candidate = current.slice(i, i + runLen)
        const followSlice = current.slice(i + runLen, i + runLen * 2)
        if (followSlice.length === runLen && candidate.join(' ') === followSlice.join(' ')) {
          // Repeated — keep the first occurrence, skip the second
          next.push(...candidate)
          i += runLen * 2
          found = true
          changed = true
          break
        }
      }

      if (!found) {
        next.push(current[i])
        i++
      }
    }

    current = next
  }

  return current.join(' ')
}
