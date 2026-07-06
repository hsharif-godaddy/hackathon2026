import type { Page } from 'playwright';

import { computeEmptyBands, type EmptyBandAuditResult, type RawBandNode } from '@airo/shared/brand-data';

/**
 * Capture-time empty-band audit (AIROBUILD-2976 #4). Mirrors `captureCasingAudit`:
 * an in-page walk collects raw per-band signals (tag, full-bleed, height, whether
 * the band wraps rendered text or foreground media, whether it carries an `<hr>`),
 * then the pure Node-side `computeEmptyBands` classifies the hollow divider /
 * full-bleed "split" pattern. Browser-side stays "dumb collection" so the heuristic
 * (the logic) is unit-tested without a browser.
 *
 * Best-effort: the caller wraps this in `.catch()` — an audit failure must never
 * fail the capture.
 */
export async function captureEmptyBandAudit(page: Page): Promise<EmptyBandAuditResult> {
  // tsx/esbuild `--keep-names` wraps named in-page helpers with `__name(...)`, a
  // module-scope helper absent in the browser context. Install a no-op shim first
  // (see contrast-audit.ts for the full rationale).
  await page.evaluate('window.__name = window.__name || function (t) { return t; };');

  const rawBands: RawBandNode[] = await page.evaluate(() => {
    function shortSelector(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const cls =
        typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
      return tag + cls;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
    const out: Array<{
      selector: string;
      className: string;
      tag: string;
      fullBleed: boolean;
      heightPx: number;
      hasText: boolean;
      hasMedia: boolean;
      hasHr: boolean;
    }> = [];
    const collected: Element[] = [];

    for (const el of Array.from(document.querySelectorAll('section, hr, div'))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) continue;

      const tag = el.tagName.toLowerCase();
      const fullBleed = rect.width >= viewportWidth * 0.99;
      const isHr = tag === 'hr';
      // Only band-like elements: a <section>, a full-bleed block, or an <hr>. A plain
      // non-full-bleed <div> is not a "band" and is skipped.
      if (!(tag === 'section' || fullBleed || isHr)) continue;
      // Count the outer band once: skip a candidate nested inside one already collected.
      if (collected.some((c) => c !== el && c.contains(el))) continue;
      collected.push(el);

      const hasText = (el.textContent || '').replace(/\s+/g, '').length > 0;
      let hasMedia = false;
      for (const m of Array.from(el.querySelectorAll('img, video, picture, svg, canvas'))) {
        const mr = m.getBoundingClientRect();
        if (mr.width > 0 && mr.height > 0) {
          hasMedia = true;
          break;
        }
      }
      const hasHr = isHr || el.querySelector('hr') !== null;
      const className = typeof el.className === 'string' ? el.className : '';
      out.push({
        selector: shortSelector(el),
        className,
        tag,
        fullBleed,
        heightPx: Math.round(rect.height),
        hasText,
        hasMedia,
        hasHr,
      });
    }
    return out;
  });

  return computeEmptyBands(rawBands);
}
