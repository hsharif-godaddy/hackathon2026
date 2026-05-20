/**
 * Pure helpers for the inline Fix (proofread) flow. Owned here so the
 * useTextFix hook and the TextFixButton both work off the same shared
 * type and display-text extraction rules.
 */

/** Lifecycle of the Fix (proofread) flow. `idle` → user clicks → `loading` →
 *  parent replies → either `preview` (show diff) or `no-change` (brief toast)
 *  or `error`. `no-change` and `error` auto-revert to `idle` after ~2s. */
export type FixState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "preview"; oldHtml: string; newHtml: string }
  | { status: "no-change" }
  | { status: "error" };

/** Walks a node's descendants and produces a plain-text view used for the
 *  Fix diff popover. `<br>` becomes `\n`; every other element is transparent
 *  (its children are recursed into). This way "Arrangements for<br />every
 *  occasion" reads as two visual lines, and "Welome to <strong>teh</strong>
 *  future" reads as "Welome to teh future" — both render cleanly in the
 *  popover without showing raw HTML. */
export function extractDisplayText(node: Node): string {
  let result = "";
  for (const child of Array.from<ChildNode>(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const elt = child as Element;
      if (elt.tagName.toLowerCase() === "br") {
        result += "\n";
      } else {
        result += extractDisplayText(elt);
      }
    }
  }
  return result;
}

/** Parses an HTML string and returns the same display text. Used for the
 *  agent's response, which arrives as a string. */
export function htmlStringToDisplayText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return extractDisplayText(doc.body);
}

/** Wraps inner HTML in the original tag + classes so it can be fed to
 *  `htmlToJsxStructured`, which expects a full element. We don't trust the
 *  LLM to round-trip the wrapper — only the inner content. */
export function wrapInnerHtml(innerHtml: string, originalTag: string, originalClasses: string): string {
  const classAttr = originalClasses ? ` class="${originalClasses.replace(/"/g, "&quot;")}"` : "";
  return `<${originalTag}${classAttr}>${innerHtml}</${originalTag}>`;
}

/** Compares two HTML strings for "meaningful equality" — same display text
 *  with all whitespace runs collapsed to a single space and trimmed. Used
 *  to short-circuit the diff popover when the LLM only normalized
 *  whitespace (e.g. `"foo  bar"` → `"foo bar"`), which renders as an
 *  apparently-identical diff and confuses the user. */
export function isWhitespaceOnlyChange(oldHtml: string, newHtml: string): boolean {
  if (oldHtml === newHtml) return true;
  const a = htmlStringToDisplayText(oldHtml).replace(/\s+/g, " ").trim();
  const b = htmlStringToDisplayText(newHtml).replace(/\s+/g, " ").trim();
  return a === b;
}

/** Generate a unique id per Fix request so the iframe-side listener can
 *  correlate a TEXT_FIX_RESULT reply to the specific in-flight request.
 *  Falls back to time+random if `crypto.randomUUID` is unavailable. */
export function makeFixRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
