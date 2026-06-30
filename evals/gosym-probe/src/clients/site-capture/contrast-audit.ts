import type { Page } from 'playwright';

import { computeContrastViolations, type ContrastAuditResult, type RawTextNode } from './contrast.js';

/**
 * Capture-time WCAG contrast audit (AIROBUILD-2976). Mirrors `captureRenderedSignals`:
 * an in-page `getComputedStyle` walk collects raw per-text-node colors (effective
 * foreground + effective background, font size/weight, class), then the pure
 * Node-side `computeContrastViolations` scores them. Browser-side stays "dumb
 * collection" so the math/classification (the logic) is unit-tested without a browser.
 *
 * Best-effort: the caller wraps this in `.catch()` — an audit failure must never
 * fail the capture.
 */
export async function captureContrastAudit(page: Page): Promise<ContrastAuditResult> {
  // tsx/esbuild `--keep-names` wraps the named in-page helpers below with calls to
  // `__name(...)` — a module-scope helper that does NOT exist in the browser context,
  // so the serialized `page.evaluate` function throws `ReferenceError: __name is not
  // defined`. Install a no-op shim on the page first. Passed as a string literal so
  // esbuild leaves it untouched; the helpers then resolve `__name` to `window.__name`.
  await page.evaluate('window.__name = window.__name || function (t) { return t; };');

  const rawNodes: RawTextNode[] = await page.evaluate(() => {
    type ParsedColor = { r: number; g: number; b: number; a: number };

    function parseColor(str: string): ParsedColor | null {
      const m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1]!.split(',').map((s) => parseFloat(s.trim()));
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    }

    function composite(fg: ParsedColor, bg: [number, number, number]): [number, number, number] {
      const a = fg.a;
      return [
        Math.round(fg.r * a + bg[0] * (1 - a)),
        Math.round(fg.g * a + bg[1] * (1 - a)),
        Math.round(fg.b * a + bg[2] * (1 - a)),
      ];
    }

    function parseGradientStops(bgImage: string): ParsedColor[] | null {
      if (!/gradient\(/i.test(bgImage)) return null;
      const stops: ParsedColor[] = [];
      const re = /rgba?\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(bgImage))) {
        const parts = m[1]!.split(',').map((s) => parseFloat(s.trim()));
        stops.push({ r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 });
      }
      return stops.length > 0 ? stops : null;
    }

    function effectiveBg(start: Element | null): {
      rgb: [number, number, number];
      indeterminate: boolean;
      candidates?: [number, number, number][];
    } {
      let node: Element | null = start;
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          // CSS gradients are parseable — score against their color stops (worst
          // case). Only raster images (url(...)) are truly indeterminate.
          const stops = parseGradientStops(cs.backgroundImage);
          if (stops) {
            const parent = effectiveBg(node.parentElement);
            const base: [number, number, number] = parent.indeterminate ? [255, 255, 255] : parent.rgb;
            const candidates = stops.map(
              (s): [number, number, number] => (s.a >= 1 ? [s.r, s.g, s.b] : composite(s, base)),
            );
            return { rgb: candidates[0]!, indeterminate: false, candidates };
          }
          return { rgb: [255, 255, 255], indeterminate: true };
        }
        const c = parseColor(cs.backgroundColor);
        if (c && c.a >= 1) return { rgb: [c.r, c.g, c.b], indeterminate: false };
        if (c && c.a > 0) {
          const parent = effectiveBg(node.parentElement);
          if (parent.indeterminate) return parent;
          return { rgb: composite(c, parent.rgb), indeterminate: false };
        }
        node = node.parentElement;
      }
      return { rgb: [255, 255, 255], indeterminate: false };
    }

    function shortSelector(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const cls =
        typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
      return tag + cls;
    }

    const out: Array<{
      selector: string;
      className: string;
      fg: [number, number, number];
      bg: [number, number, number];
      fontPx: number;
      bold: boolean;
      bgIndeterminate: boolean;
      bgCandidates?: [number, number, number][];
    }> = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      if (!(textNode.textContent || '').trim()) continue;
      const el = textNode.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const fg = parseColor(cs.color);
      if (!fg) continue;
      const bg = effectiveBg(el);
      const fontPx = parseFloat(cs.fontSize) || 16;
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      const className = typeof el.className === 'string' ? el.className : '';
      out.push({
        selector: shortSelector(el),
        className,
        fg: fg.a < 1 && !bg.indeterminate ? composite(fg, bg.rgb) : [fg.r, fg.g, fg.b],
        bg: bg.rgb,
        fontPx,
        bold,
        bgIndeterminate: bg.indeterminate,
        bgCandidates: bg.candidates,
      });
    }
    return out;
  });

  return { textNodesScanned: rawNodes.length, violations: computeContrastViolations(rawNodes) };
}
