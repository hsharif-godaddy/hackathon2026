import { generateText } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { LogMasker, DRAIN_DEFAULTS } from './logmine.mjs';
import { extractJson } from './json-extract.mjs';

// ─── Schema ──────────────────────────────────────────────────────────────────
// Matches the analysis.json contract from phase-2-synthesis.md EXACTLY.
// This is the single source of truth for the sidecar shape.

export const VERDICT_SCHEMA = z.object({
  v: z.literal(1),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number().min(0).max(1),
  rootCause: z.string(),
  category: z.string(),
  verdict: z.enum(['agent-bug', 'customer-error', 'platform-bug', 'external', 'no-issue']),
  relatesTo: z.string(),
  verdictConfidence: z.enum(['low', 'medium', 'high']),
  verdictRationale: z.string(),
  fixKind: z.enum(['app-prompt', 'eng-note', 'none']),
  fixPrompt: z.string().nullable(),
  engNote: z.string().nullable(),
  // Hypothesis ledger — the candidate root causes the agent considered and how
  // it resolved each. Optional + defaulted so a model that omits it still
  // validates; the final rootCause should correspond to a 'validated' entry.
  hypotheses: z.array(z.object({
    hypothesis: z.string(),
    status: z.enum(['validated', 'invalidated', 'inconclusive']),
    evidence: z.string().nullable(),
  })).default([]),
}).refine(
  (d) => d.fixKind !== 'app-prompt' || d.fixPrompt !== null,
  { message: 'fixPrompt must be non-null when fixKind is app-prompt', path: ['fixPrompt'] },
).refine(
  (d) => d.fixKind === 'app-prompt' || d.fixPrompt === null,
  { message: 'fixPrompt must be null when fixKind is not app-prompt', path: ['fixPrompt'] },
).refine(
  (d) => d.verdict !== 'platform-bug' || d.engNote !== null,
  { message: 'engNote must be non-null when verdict is platform-bug', path: ['engNote'] },
).refine(
  (d) => d.verdict === 'platform-bug' || d.engNote === null,
  { message: 'engNote must be null when verdict is not platform-bug', path: ['engNote'] },
);

// ─── Benign fallback verdict (fail-toward-benign when synthesis fails) ────────
const BENIGN_FALLBACK = {
  v: 1, sentiment: 'neutral', confidence: 0.5,
  rootCause: 'Verdict synthesis failed — insufficient evidence to classify.',
  category: 'no-clear-failure',
  verdict: 'no-issue',
  relatesTo: 'unknown',
  verdictConfidence: 'low',
  verdictRationale: 'Automatic fallback: the verdict model could not produce a valid structured output.',
  fixKind: 'none', fixPrompt: null, engNote: null,
  hypotheses: [],
};

// JSON schema description injected into the synthesis prompt so the model
// knows exactly what to emit — no generateObject / spec version needed.
const VERDICT_JSON_SHAPE = `{
  "v": 1,
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": 0.0-1.0,
  "rootCause": "one sentence",
  "category": "short label",
  "verdict": "agent-bug" | "customer-error" | "platform-bug" | "external" | "no-issue",
  "relatesTo": "short label",
  "verdictConfidence": "low" | "medium" | "high",
  "verdictRationale": "one sentence",
  "fixKind": "app-prompt" | "eng-note" | "none",
  "fixPrompt": "string or null — non-null only when fixKind=app-prompt",
  "engNote": "string or null — non-null only when verdict=platform-bug",
  "hypotheses": [
    { "hypothesis": "candidate root cause considered",
      "status": "validated" | "invalidated" | "inconclusive",
      "evidence": "the log template / file:line that resolved it, or null" }
  ]
}`;

// ─── synthesizeVerdict ────────────────────────────────────────────────────────

/**
 * Produce a schema-valid verdict from the investigation report.
 * Uses generateText + explicit JSON prompt → Zod parse → retry → benign fallback.
 * Avoids generateObject entirely (GoCode proxy triggers AI SDK spec-version
 * compatibility mode which breaks structured output extraction).
 *
 * @param {{ model: any, system: string, report: string, generateTextImpl?: Function }} opts
 * @returns {Promise<z.infer<typeof VERDICT_SCHEMA>>}
 */
export async function synthesizeVerdict({ model, system, report, generateTextImpl = generateText }) {
  const basePrompt = [
    'Based on the investigation report below, produce the final structured verdict.',
    'Output ONLY valid JSON matching this exact shape (no prose, no markdown fences):',
    VERDICT_JSON_SHAPE,
    '',
    'Report:',
    report,
  ].join('\n');

  // On retry, add a corrective nudge so a model that produced unparseable output
  // the first time doesn't deterministically repeat the same mistake.
  const RETRY_NUDGE = '\n\nYour previous response could not be parsed. Respond with ONLY the JSON object — a single { ... } block, no prose, no fences, no shape echo.';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = attempt === 0 ? basePrompt : basePrompt + RETRY_NUDGE;
      const result = await generateTextImpl({ model, system, prompt });
      const raw = extractJson(result.text || '');
      // Enforce cross-field constraints the model sometimes violates:
      // fixPrompt must be null unless fixKind=app-prompt
      // engNote must be null unless verdict=platform-bug
      if (raw.fixKind !== 'app-prompt') raw.fixPrompt = null;
      if (raw.verdict !== 'platform-bug') raw.engNote = null;
      const parsed = VERDICT_SCHEMA.parse(raw);
      return parsed;
    } catch (err) {
      console.error('[investigator] synthesizeVerdict.error', { error: err?.message, attempt });
      // retry once on any error (parse/validation/network)
    }
  }
  return { ...BENIGN_FALLBACK, _synthesisFailed: true };
}

// ─── citation matching ────────────────────────────────────────────────────────

const PARAM_STR = DRAIN_DEFAULTS.paramStr; // '<:*:>' — Drain's variable-position wildcard

function tokenizeMasked(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Does a masked quote appear within ANY mined template, treating the template's
 * Drain wildcard (`<:*:>`) as matching any single quote token? The quote is
 * usually a FRAGMENT of a log line, so we look for it as a contiguous token
 * window inside the (whole-line) template — not an exact whole-string equality.
 * @param {string} maskedQuote
 * @param {string[]} templates
 * @returns {boolean}
 */
export function quoteMatchesTemplate(maskedQuote, templates) {
  const q = tokenizeMasked(maskedQuote);
  if (q.length === 0) return true;
  for (const t of templates) {
    const tt = tokenizeMasked(t);
    if (tt.length < q.length) continue;
    for (let i = 0; i + q.length <= tt.length; i++) {
      let ok = true;
      for (let j = 0; j < q.length; j++) {
        const a = tt[i + j];
        if (a !== PARAM_STR && a !== q[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

// ─── preResolveCitations ──────────────────────────────────────────────────────

/**
 * Deterministic, non-LLM pass: validate citations in the report against evidence.
 * Downgrades verdictConfidence on dangling refs.
 *
 * @param {z.infer<typeof VERDICT_SCHEMA>} verdict
 * @param {string} report  - markdown report text
 * @param {{
 *   logIndex?: { templates: Array<{template:string}> },
 *   appCodeDir?: string,
 *   readFileImpl?: Function,
 * }} evidence
 * @returns {Promise<{ verdict: z.infer<typeof VERDICT_SCHEMA>, dangling: string[] }>}
 */
export async function preResolveCitations(verdict, report, { logIndex = null, appCodeDir = null, readFileImpl = readFile } = {}) {
  const dangling = [];

  // Resolve log-template citations.
  // H2/M3: re-mask quoted strings through the same LogMasker, then match
  // STRUCTURALLY against the mined templates. A plain Set membership test fails
  // for any template Drain generalized (its `<:*:>` paramStr is never produced
  // by LogMasker), so exact matching flags well-grounded citations as dangling.
  // Instead treat the quote's masked tokens as a contiguous window that the
  // template must cover, with the Drain wildcard `<:*:>` matching any one token.
  if (logIndex?.templates?.length) {
    const masker = new LogMasker();
    const templates = logIndex.templates.map((t) => t.template);
    const quotedStrings = [...(report.matchAll(/`([^`]{10,200})`/g) || [])].map((m) => m[1]);
    for (const q of quotedStrings) {
      if (/<:[A-Z]+:>|error|fatal|warn/i.test(q)) {
        const maskedQ = masker.mask(q);
        if (!quoteMatchesTemplate(maskedQ, templates)) {
          dangling.push(`log-template: "${q.slice(0, 80)}"`);
        }
      }
    }
  }

  // Resolve file:line citations — verify the file actually exists in appCodeDir.
  if (appCodeDir) {
    // Match `file.ts:42` or `src/foo/bar.ts:123` patterns inside backticks or bare
    const fileLineRefs = [...(report.matchAll(/`([^`]{3,200}\.[a-zA-Z]{1,6}:\d+)[^`]*`/g) || [])].map((m) => m[1]);
    const uniqueFiles = [...new Set(fileLineRefs.map((r) => r.replace(/:\d+.*$/, '')))];
    for (const file of uniqueFiles) {
      try {
        const abs = resolve(appCodeDir, file);
        // Use relative() (same as tools/retrieval.mjs assertInAppDir) — this
        // correctly rejects absolute paths and resolve-escaped references like
        // /etc/passwd that the old abs.replace() check would miss.
        const rel = relative(appCodeDir, abs);
        if (rel.startsWith('..') || rel.startsWith('/')) {
          dangling.push(`file: "${file}" (path traversal rejected)`);
          continue;
        }
        await readFileImpl(abs, { encoding: 'utf-8' }).then(() => {}).catch(() => {
          dangling.push(`file: "${file}"`);
        });
      } catch {
        dangling.push(`file: "${file}"`);
      }
    }
  }

  if (dangling.length === 0) return { verdict, dangling };

  // Downgrade verdictConfidence one notch (capped at low)
  const levels = ['low', 'medium', 'high'];
  const currentIdx = levels.indexOf(verdict.verdictConfidence);
  const newIdx = Math.max(0, currentIdx - 1);
  const updated = {
    ...verdict,
    verdictConfidence: levels[newIdx],
    verdictRationale: `${verdict.verdictRationale} [Note: ${dangling.length} citation(s) could not be verified in the evidence index]`,
  };

  return { verdict: updated, dangling };
}
