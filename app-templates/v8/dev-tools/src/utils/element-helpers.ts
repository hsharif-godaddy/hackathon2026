export interface DevContext {
  fileName: string;
  componentName: string;
  lineNumber: number;
}

/** Generate a precise nth-child CSS selector for an element */
export function generatePreciseSelector(element: HTMLElement): string {
  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    let selector = current.tagName.toLowerCase();
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-child(${index})`;
    }
    path.unshift(selector);
    current = current.parentElement;
  }

  if (current === document.documentElement) {
    path.unshift("html:nth-child(1)");
  }

  return path.join(" > ");
}

/** Extract dev context from element or its ancestors.
 *  Only `data-dev-file` is required — `data-dev-component` falls back to
 *  'unknown' since the source-mapper Babel plugin does not inject it. */
export function extractDevContext(element: HTMLElement): DevContext | undefined {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const file = current.getAttribute("data-dev-file");
    const line = current.getAttribute("data-dev-line");
    if (file && line) {
      return {
        fileName: file
          .replace(/.*\/src\//, "src/")
          .replace(/.*\/app\//, "app/"),
        componentName: current.getAttribute("data-dev-component") || "unknown",
        lineNumber: parseInt(line, 10),
      };
    }
    current = current.parentElement;
  }
  return undefined;
}
