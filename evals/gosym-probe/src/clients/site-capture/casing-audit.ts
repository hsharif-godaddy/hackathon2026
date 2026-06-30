import type { Page } from 'playwright';

import { computeCasingViolations, type CasingAuditResult, type RawCasingNode } from './casing.js';

/**
 * Capture-time casing audit (AIROBUILD-2976 #2). Mirrors `captureContrastAudit`:
 * an in-page `getComputedStyle` walk collects raw per-text-node casing signals
 * (text-transform, letter-spacing, font size, source text, class), then the pure
 * Node-side `computeCasingViolations` classifies the gratuitous all-caps eyebrow
 * pattern. Browser-side stays "dumb collection" so the heuristic (the logic) is
 * unit-tested without a browser.
 *
 * Best-effort: the caller wraps this in `.catch()` — an audit failure must never
 * fail the capture.
 */
export async function captureCasingAudit(page: Page): Promise<CasingAuditResult> {
  // tsx/esbuild `--keep-names` wraps named in-page helpers with `__name(...)`, a
  // module-scope helper absent in the browser context. Install a no-op shim first
  // (see contrast-audit.ts for the full rationale).
  await page.evaluate('window.__name = window.__name || function (t) { return t; };');

  const rawNodes: RawCasingNode[] = await page.evaluate(() => {
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
      text: string;
      textTransform: string;
      letterSpacingPx: number | null;
      fontPx: number;
      bold: boolean;
    }> = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const raw = (textNode.textContent || '').trim();
      if (!raw) continue;
      const el = textNode.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const fontPx = parseFloat(cs.fontSize) || 16;
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      const ls = cs.letterSpacing;
      const letterSpacingPx = ls && ls !== 'normal' ? parseFloat(ls) : null;
      const className = typeof el.className === 'string' ? el.className : '';
      out.push({
        selector: shortSelector(el),
        className,
        text: raw.slice(0, 80),
        textTransform: cs.textTransform || 'none',
        letterSpacingPx: Number.isFinite(letterSpacingPx as number) ? letterSpacingPx : null,
        fontPx,
        bold,
      });
    }
    return out;
  });

  return computeCasingViolations(rawNodes);
}
