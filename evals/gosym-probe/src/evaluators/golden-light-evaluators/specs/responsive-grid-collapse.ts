import type { StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';
import { safeRatio } from '../dom-eval-types.js';

/**
 * AIROBUILD-2756: multi-column grids that never collapse on mobile.
 *
 * The develop agent sometimes emits a grid whose column count is fixed at the
 * BASE (mobile) breakpoint with no responsive override, so the grid keeps N
 * columns down to 320px phones instead of stacking. This spec scans the
 * rendered DOM for that shape across the three ways a grid can be declared:
 *
 *   1. Tailwind classes        — `grid grid-cols-3` (base, no `sm:`/`md:` prefix)
 *   2. Inline `style`          — `style="grid-template-columns: repeat(3, 1fr)"`
 *   3. Raw `<style>` CSS rules  — `.features { grid-template-columns: repeat(3,1fr) }`
 *
 * A grid is treated as RESPONSIVE (not flagged) when it collapses on its own —
 * an `auto-fit`/`auto-fill` track, a single base column that widens at a
 * breakpoint (`grid-cols-1 md:grid-cols-3`), or a `@media (max-width: …)` rule
 * that reduces the column count for that class.
 *
 * Threshold: only grids with >= 3 base columns are flagged. The prompt rule
 * explicitly permits compact decorative 2-up grids (stat counters, icon rows,
 * 2-up logo strips) to keep two columns on mobile, and the `airo-grid-ok`
 * source opt-out comment is stripped from the rendered DOM, so flagging 2-up
 * grids would produce false positives on intentional layouts.
 *
 * Score = share of detected multi-column grids that are responsive.
 * canScore is false when the page declares no multi-column grids.
 */
const MIN_OFFENDING_COLUMNS = 3;

const RESPONSIVE_PREFIXES = ['sm:', 'md:', 'lg:', 'xl:', '2xl:'];

/** Extract the contents of every `class="…"` / `class='…'` attribute. */
function classAttributes(html: string): string[] {
  const out: string[] = [];
  const re: RegExp = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1] ?? m[2] ?? '');
  }
  return out;
}

/**
 * Largest base (mobile) column count declared by a static Tailwind
 * `grid-cols-*` token, or 0 when the class string has no offending base grid.
 *
 * Breakpoint-prefixed tokens (`md:grid-cols-3`) and base single-column /
 * intrinsically-responsive tracks are not offending.
 */
function offendingTailwindColumns(classStr: string): number {
  let worst: number = 0;
  for (const token of classStr.split(/\s+/).filter(Boolean)) {
    if (RESPONSIVE_PREFIXES.some((prefix: string) => token.includes(prefix))) continue;
    const bare: string = token.slice(token.lastIndexOf(':') + 1);
    if (!bare.startsWith('grid-cols-')) continue;
    const value: string = bare.slice('grid-cols-'.length);
    if (value === 'none' || value === 'subgrid' || value === '1') continue;
    if (value.startsWith('[')) {
      if (/auto-fit|auto-fill/i.test(value)) continue;
      // Arbitrary fixed track list at base — treat as a single suspect column
      // group; the exact count is unknown so use the offending threshold.
      worst = Math.max(worst, MIN_OFFENDING_COLUMNS);
      continue;
    }
    const n: number = Number(value);
    if (Number.isInteger(n) && n >= 2) worst = Math.max(worst, n);
  }
  return worst;
}

/** True when a Tailwind class string declares a grid container at all. */
function hasGridCols(classStr: string): boolean {
  return /\bgrid-cols-/.test(classStr);
}

/**
 * Fixed column count of a CSS `grid-template-columns` value, or 0 when the
 * value is intrinsically responsive (`auto-fit`/`auto-fill`) or single-column.
 */
function fixedColumnCount(value: string): number {
  const v: string = value.trim();
  if (/auto-fit|auto-fill/i.test(v)) return 0;
  const rep: RegExpMatchArray | null = v.match(/repeat\(\s*(\d+)\s*,/i);
  if (rep) {
    const n: number = Number(rep[1]);
    return n >= 2 ? n : 0;
  }
  const tokens: string[] = v.split(/\s+/).filter(Boolean);
  return tokens.length >= 2 ? tokens.length : 0;
}

interface GridTally {
  total: number;
  responsive: number;
  offenders: string[];
}

/** Tailwind grid containers declared via `grid-cols-*` class tokens. */
function tallyTailwindGrids(html: string): GridTally {
  const tally: GridTally = { total: 0, responsive: 0, offenders: [] };
  for (const classStr of classAttributes(html)) {
    if (!hasGridCols(classStr)) continue;
    tally.total += 1;
    const cols: number = offendingTailwindColumns(classStr);
    if (cols >= MIN_OFFENDING_COLUMNS) {
      tally.offenders.push(`tailwind: "${classStr.trim()}" (${cols} base columns)`);
    } else {
      tally.responsive += 1;
    }
  }
  return tally;
}

/** Class names declared on the opening tag that owns `style="…"` at `index`. */
function classNamesForInlineStyle(html: string, styleStart: number): string[] {
  let tagStart: number = styleStart;
  while (tagStart > 0 && html[tagStart] !== '<') tagStart--;
  const tagEnd: number = html.indexOf('>', styleStart);
  const tag: string = html.slice(tagStart, tagEnd === -1 ? html.length : tagEnd);
  const out: string[] = [];
  const re: RegExp = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) out.push(m[1] ?? m[2] ?? '');
  return out.join(' ').split(/\s+/).filter(Boolean);
}

/**
 * Column count declared by `grid-template-columns` for the first CSS rule whose
 * selector text contains `selector` (token-bounded), or `null` when no such
 * rule exists. Uses a manual scan rather than a `RegExp` built from `selector`
 * so no regex is constructed from variable input (avoids ReDoS / Semgrep
 * detect-non-literal-regexp).
 */
function selectorGridColumns(css: string, selector: string): number | null {
  const haystack: string = css.toLowerCase();
  const needle: string = selector.toLowerCase();
  let from: number = 0;
  for (;;) {
    const at: number = haystack.indexOf(needle, from);
    if (at === -1) return null;
    from = at + needle.length;
    const nextChar: string | undefined = haystack[from];
    if (nextChar !== undefined && /\w/.test(nextChar)) continue;
    const brace: number = haystack.indexOf('{', from);
    if (brace === -1) continue;
    if (haystack.slice(from, brace).includes('}')) continue;
    const close: number = haystack.indexOf('}', brace);
    const body: string = css.slice(brace + 1, close === -1 ? css.length : close);
    const declAt: number = body.toLowerCase().indexOf('grid-template-columns');
    if (declAt === -1) continue;
    const colon: number = body.indexOf(':', declAt);
    if (colon === -1) continue;
    return fixedColumnCount(body.slice(colon + 1).split(/[;}]/)[0]);
  }
}

/**
 * True when a stylesheet rule sets `grid-template-columns` for `.className`.
 * Because an inline-style grid's base is the inline value, any such rule can
 * only be a responsive override (the generator wraps these in
 * `@media … { .x { … !important } }`).
 */
function cssOverridesClass(html: string, className: string): boolean {
  if (!className) return false;
  return selectorGridColumns(html, `.${className}`) !== null;
}

/** Inline `style="… grid-template-columns: … "` grids with no responsive override. */
function tallyInlineStyleGrids(html: string): GridTally {
  const tally: GridTally = { total: 0, responsive: 0, offenders: [] };
  const re: RegExp = /grid-template-columns\s*:\s*([^;"']+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Only inline-style occurrences (inside a `style="…"` attribute) are handled
    // here; rules inside <style> blocks are tallied separately. Disambiguate by
    // checking that the nearest preceding `style` keyword is an attribute
    // (`style=…`) and that no CSS `{` opens between it and the match — a `{`
    // after the `style=` would mean the match sits inside a <style> block body.
    const before: number = html.lastIndexOf('style', m.index);
    const openBrace: number = html.lastIndexOf('{', m.index);
    const styleAttr: boolean = before !== -1 && html.slice(before, m.index).includes('=');
    if (!styleAttr || openBrace > before) continue;
    const cols: number = fixedColumnCount(m[1]);
    if (cols === 0) continue;
    tally.total += 1;
    const classes: string[] = classNamesForInlineStyle(html, m.index);
    if (cols < MIN_OFFENDING_COLUMNS || classes.some((c) => cssOverridesClass(html, c))) {
      tally.responsive += 1;
    } else {
      tally.offenders.push(`inline: "${m[1].trim()}" (${cols} columns)`);
    }
  }
  return tally;
}

/**
 * Split CSS into the bodies of its `@media` blocks and the remaining base CSS
 * (everything outside any `@media`). A manual brace scan is used instead of a
 * regex because a non-greedy `\{([\s\S]*?\})\s*\}` stops at the first inner
 * `}`, so it mis-handles `@media` queries that wrap multiple rules or nested
 * blocks — leaving their rules in `baseCss` and producing false positives.
 */
function splitMediaBlocks(css: string): { mediaBodies: string[]; baseCss: string } {
  const mediaBodies: string[] = [];
  let baseCss: string = '';
  let i: number = 0;
  while (i < css.length) {
    const at: number = css.indexOf('@media', i);
    if (at === -1) {
      baseCss += css.slice(i);
      break;
    }
    baseCss += css.slice(i, at);
    const braceStart: number = css.indexOf('{', at);
    if (braceStart === -1) {
      // Malformed `@media` with no block body — keep the remainder as base CSS.
      baseCss += css.slice(at);
      break;
    }
    let depth: number = 1;
    let j: number = braceStart + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    mediaBodies.push(css.slice(braceStart + 1, depth === 0 ? j - 1 : j));
    i = j;
  }
  return { mediaBodies, baseCss };
}

/**
 * Grid rules declared inside `<style>` blocks. A rule is responsive when its
 * value is intrinsically responsive or a `@media (max-width …)` block reduces
 * the same selector's column count.
 */
function tallyStylesheetGrids(html: string): GridTally {
  const tally: GridTally = { total: 0, responsive: 0, offenders: [] };
  for (const styleMatch of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const { mediaBodies, baseCss } = splitMediaBlocks(styleMatch[1]);
    for (const rule of baseCss.matchAll(
      /([.#][\w-]+)[^{}]*\{[^}]*grid-template-columns\s*:\s*([^;}]+)/gi,
    )) {
      const selector: string = rule[1];
      const cols: number = fixedColumnCount(rule[2]);
      if (cols === 0) continue;
      tally.total += 1;
      const collapsed: boolean = mediaBodies.some((block: string) => {
        const reduced: number | null = selectorGridColumns(block, selector);
        return reduced !== null && reduced < cols;
      });
      if (cols < MIN_OFFENDING_COLUMNS || collapsed) {
        tally.responsive += 1;
      } else {
        tally.offenders.push(`stylesheet: ${selector} (${cols} columns, no @media collapse)`);
      }
    }
  }
  return tally;
}

export const responsiveGridCollapseSpec: StructuralEvalSpec = {
  name: 'responsive-grid-collapse',
  dimension: 'responsive-grid-collapse',
  description:
    'AIROBUILD-2756: share of multi-column grids (Tailwind, inline style, or ' +
    'stylesheet) that collapse on mobile instead of keeping >= 3 fixed columns.',
  evalVersion: '1.0',
  needsFullDocument: true,

  score(html: string): StructuralScoreResult {
    const tailwind: GridTally = tallyTailwindGrids(html);
    const inline: GridTally = tallyInlineStyleGrids(html);
    const stylesheet: GridTally = tallyStylesheetGrids(html);

    const total: number = tailwind.total + inline.total + stylesheet.total;
    if (total === 0) {
      return {
        score: 0,
        canScore: false,
        reason: 'No multi-column grids found to assess',
        details: {},
      };
    }

    const responsive: number = tailwind.responsive + inline.responsive + stylesheet.responsive;
    const offenders: string[] = [...tailwind.offenders, ...inline.offenders, ...stylesheet.offenders];
    const score: number = safeRatio(responsive, total);

    return {
      score,
      canScore: true,
      reason:
        offenders.length === 0
          ? `All ${total} multi-column grid(s) collapse on mobile`
          : `${offenders.length} of ${total} multi-column grid(s) stay fixed on mobile: ${offenders.join('; ')}`,
      details: {
        totalGrids: total,
        responsiveGrids: responsive,
        offendingGrids: offenders.length,
        offenders,
      },
    };
  },
};
