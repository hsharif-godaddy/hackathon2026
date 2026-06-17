// Robust JSON extraction from LLM completion text.
//
// The naive `text.indexOf('{')` → `text.lastIndexOf('}')` slice breaks whenever
// a model emits more than one brace block — e.g. it echoes the JSON-shape
// example (which our synthesis/judge prompts literally embed) and THEN emits the
// real object. first-{ → last-} then spans `…} prose {…` and JSON.parse throws,
// systematically forcing the benign/no-opinion fallback and discarding a real
// verdict. This scanner instead walks every top-level {...} block (string/escape
// aware so braces inside strings don't skew the depth counter) and returns the
// FIRST one that actually parses — so an echoed shape with placeholder values
// (`"a" | "b"`, invalid JSON) is skipped and the real object is found.

/**
 * Yield each complete top-level {...} block in source order. String literals and
 * backslash escapes are tracked so `{`/`}` inside strings are ignored. A
 * truncated final block (no matching close) ends iteration.
 * @param {string} text
 * @returns {Generator<string>}
 */
export function* balancedObjects(text) {
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) return;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) return; // unbalanced / truncated tail
    yield text.slice(start, end + 1);
    i = end + 1;
  }
}

/**
 * Extract the first PARSEABLE JSON object from model text.
 * Prefers a fenced ```json ... ``` block, then falls back to the whole text;
 * within each, returns the first balanced {...} that JSON.parses.
 * @param {string} text
 * @returns {any}
 * @throws {Error} when no parseable JSON object is present
 */
export function extractJson(text) {
  const s = String(text ?? '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const sources = fence ? [fence[1], s] : [s];
  for (const src of sources) {
    for (const block of balancedObjects(src)) {
      try {
        return JSON.parse(block);
      } catch {
        // not valid JSON (e.g. an echoed shape with `|` placeholders) — try next
      }
    }
  }
  throw new Error('no JSON object found');
}
