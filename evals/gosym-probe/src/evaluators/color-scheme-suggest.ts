import type { DOMSnapshot, ToolCall, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { EvalResult, Evaluator } from './evaluator.js';
import { contrastRatio, type Rgb } from '../clients/site-capture/contrast.js';

const EVAL_VERSION = '1.0.0';
const AA_NORMAL = 4.5;

/**
 * AIROBUILD-2976 — "show me more color schemes" use case. Scores the `colorScheme`
 * tool's SUGGEST output (the `color-palette-grid` the customer picks from): every
 * suggested palette is run through `generatePalette`, so each option carries the
 * derived `mutedForeground` + `background`/`card` that the AIROBUILD-2976 fix made
 * AA-safe. This evaluator reads those palettes from the transcript's tool-call
 * outputs (no DOM render needed) and counts how many suggested schemes would render
 * low-emphasis ("muted") text below WCAG AA against their own worst surface — i.e.
 * how many of the options the customer is offered are not contrast-safe.
 *
 * `score` = count of AA-failing suggested palettes (lower is better). If the agent
 * never called `colorScheme` in suggest mode, the suggest path wasn't exercised, so
 * the verdict is `unknown` (not a failure) — tune the scenario prompt rather than
 * letting it false-pass with score 0.
 */
export class ColorSchemeSuggestEvaluator implements Evaluator {
  readonly name = 'color-scheme-suggest-contrast';
  readonly evalVersion = EVAL_VERSION;
  readonly comparisonMode = 'score' as const;
  readonly lowerIsBetter = true;

  async evaluate(transcript: Transcript, _scenario: Scenario, _snapshot?: DOMSnapshot): Promise<EvalResult> {
    const suggested: SuggestedPalette[] = collectSuggestedPalettes(transcript);

    if (suggested.length === 0) {
      return {
        evaluator: this.name,
        evalVersion: EVAL_VERSION,
        score: 0,
        verdict: 'incomplete',
        reason: 'No colorScheme suggest output found in the transcript; the "show more color schemes" path was not exercised.',
      };
    }

    const audited: PaletteAudit[] = suggested.map(auditPalette).filter((a): a is PaletteAudit => a !== null);
    const failures: PaletteAudit[] = audited.filter((a) => !a.passes);
    const distinctPrimaries: number = new Set(audited.map((a) => a.primary)).size;
    const worst: PaletteAudit | undefined = [...audited].sort((a, b) => a.worstRatio - b.worstRatio)[0];

    const score: number = failures.length;
    const reason: string =
      score === 0
        ? `All ${audited.length} suggested color scheme(s) yield AA-safe muted text (worst ${worst?.worstRatio.toFixed(2)}:1); ${distinctPrimaries} distinct primaries.`
        : `${score}/${audited.length} suggested color scheme(s) have muted text below AA against their surface (worst ${worst?.worstRatio.toFixed(2)}:1 on "${worst?.name}").`;

    return {
      evaluator: this.name,
      evalVersion: EVAL_VERSION,
      score,
      verdict: 'directional',
      reason,
      details: {
        palettesSuggested: audited.length,
        aaFailures: score,
        distinctPrimaries,
        worstRatio: worst?.worstRatio ?? null,
        samples: [...audited].sort((a, b) => a.worstRatio - b.worstRatio).slice(0, 10),
      },
    };
  }
}

interface SuggestedPalette {
  name?: string;
  palette?: Record<string, string>;
}

interface PaletteAudit {
  name: string;
  primary: string;
  mutedForeground: string;
  vsBackground: number;
  vsCard: number;
  worstRatio: number;
  passes: boolean;
}

/** Pull every suggested palette out of all `colorScheme` tool-call outputs. */
function collectSuggestedPalettes(transcript: Transcript): SuggestedPalette[] {
  const out: SuggestedPalette[] = [];
  for (const turn of transcript.turns) {
    for (const call of turn.toolCalls) {
      if (!isColorSchemeCall(call)) continue;
      out.push(...extractFromOutput(call.output));
    }
  }
  return out;
}

function isColorSchemeCall(call: ToolCall): boolean {
  return call.name === 'colorScheme' || call.name === 'color_scheme';
}

/**
 * The colorScheme suggest tool returns `{ palettes: [{ name, palette }], widget: {
 * widgetType: 'color-palette-grid', widgetData: { palettes } } }`. Defensively read
 * either shape (and tolerate a serialized-string output).
 */
function extractFromOutput(output: unknown): SuggestedPalette[] {
  const obj: Record<string, unknown> | null = asObject(output);
  if (!obj) return [];
  if (Array.isArray(obj.palettes)) return obj.palettes as SuggestedPalette[];
  const widget: Record<string, unknown> | null = asObject(obj.widget);
  const data: Record<string, unknown> | null = asObject(widget?.widgetData);
  if (data && Array.isArray(data.palettes)) return data.palettes as SuggestedPalette[];
  return [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Audit one suggested palette: muted text vs its worst (lowest-ratio) surface. */
function auditPalette(p: SuggestedPalette): PaletteAudit | null {
  const pal: Record<string, string> | undefined = p.palette;
  if (!pal) return null;
  const mutedRgb: Rgb | null = hexToRgb(pal.mutedForeground);
  const bgRgb: Rgb | null = hexToRgb(pal.background);
  if (!mutedRgb || !bgRgb) return null;
  const cardRgb: Rgb = hexToRgb(pal.card) ?? bgRgb;
  const vsBackground: number = contrastRatio(mutedRgb, bgRgb);
  const vsCard: number = contrastRatio(mutedRgb, cardRgb);
  const worstRatio: number = Math.min(vsBackground, vsCard);
  return {
    name: p.name ?? 'unnamed',
    primary: pal.primary ?? '',
    mutedForeground: pal.mutedForeground ?? '',
    vsBackground,
    vsCard,
    worstRatio,
    passes: worstRatio >= AA_NORMAL,
  };
}

function hexToRgb(hex: string | undefined): Rgb | null {
  if (!hex) return null;
  const match: RegExpExecArray | null = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value: number = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
