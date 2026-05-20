import {
  createAgentFactory,
  type AgentConfig,
  createPromptBuilder
} from '@airo/ai-lib'

import { Logger } from '../logging/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { getAgentModelWithName } from '../utils/model-selection.js'

const logger = Logger.create({ component: 'text-fix-agent' })

/**
 * System prompt is deliberately tight to keep behavior at "proofreader," not
 * "copy editor." Restructuring, tone shifts, and concision changes are out of
 * scope — the inline Fix button is for objective error correction only.
 */
async function buildTextFixSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()

  promptBuilder.text(`# Text Fix Agent

You correct objective errors in user-provided HTML content from an in-progress web app. The input is the inner HTML of a single element. It may be plain text, or it may contain inline HTML tags such as <br>, <span>, <strong>, <em>, <a>, etc.

If the input contains multiple errors, fix ALL of them in a single pass. Never leave a known error in the output. Independent errors (e.g., a duplicate word AND a subject-verb mismatch in the same sentence) must both be corrected — they are not mutually exclusive.

## What to fix (text content only)
- Misspellings
- Grammatical errors (subject-verb agreement, verb tense, articles, pronouns)
- Punctuation
- Duplicate or repeated consecutive words ("the the" → "the", "and and" → "and")

## What NOT to do
- Do not add, remove, rearrange, or modify any HTML tags or attributes.
- Do not change href, class, id, data-*, style, or any other attribute.
- Do not move text across tag boundaries — if "<strong>teh</strong>" appears, the corrected output is exactly "<strong>the</strong>" (not "<strong>the </strong>" and not "the").
- Do not restructure sentences.
- Do not change word choices for style, formality, or concision.
- Do not convert passive voice to active voice (or vice versa).
- Do not rewrite for tone or "improvement."
- Preserve meaning, tone, length, and language.
- If the input has no errors, return it verbatim.

## Output format

Return strict JSON with exactly this shape:

\`\`\`
{"newText": "<corrected HTML>"}
\`\`\`

The "newText" field contains the corrected HTML — same tags and attributes as the input, with only spelling/grammar/punctuation fixes inside text content. No prose, no code fences, no explanations.`)

  return await promptBuilder.build()
}

export async function createTextFixAgent(): Promise<AgentConfig> {
  const systemPrompt = await buildTextFixSystemPrompt()
  const { model, modelName } = await getAgentModelWithName('fast')

  return {
    name: 'Text Fix',
    system: systemPrompt,
    model,
    modelName,
    tools: {},
    // Single-step transform — no tool loop, no follow-ups.
    maxSteps: 1,
    temperature: 0,
    // Sized for the route's MAX_FIX_INPUT_LENGTH=8000 chars cap (~2-3k tokens
    // input). 4000 output tokens leaves comfortable headroom for the JSON
    // envelope so the model can never truncate mid-string and break parsing.
    maxOutputTokens: 4000,
    logger: createAgentTelemetryLogger('text-fix'),
    enablePromptCaching: false,

    metadata: {
      contextPreferences: {
        includeAppContext: false,
        includeVisualContext: false,
        includeConversationHistory: false,
        includeTemplateDescription: false
      }
    }
  }
}

export async function createTextFixAgentFactory() {
  const factory = createAgentFactory()
  const textFixConfig = await createTextFixAgent()

  const agents = factory.defineAgents({
    'text-fix': textFixConfig
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('text-fix')
  }
}

export interface TextFixResult {
  newText: string
  changed: boolean
}

/**
 * TextFixAgent — narrow service-style agent invoked from the
 * `POST /apps/:id/text/fix` route. Mirrors the lifecycle pattern used by
 * SiteAnalyzerAgent and PagePromptAgent: construct → initialize → call →
 * cleanup. Not registered in `ai-lib-agents/index.ts` because it is not
 * routable via `/agent` commands or message context.
 */
export class TextFixAgent {
  private factory: Awaited<ReturnType<typeof createTextFixAgentFactory>> | null = null

  async initialize(): Promise<void> {
    logger.info('text-fix-agent.initialization.start', {})
    this.factory = await createTextFixAgentFactory()
    logger.info('text-fix-agent.initialization.complete', {})
  }

  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.getAgent()
  }

  /**
   * Run the proofread pass over `text`. Returns `{newText, changed}`. When the
   * model returns the input verbatim, `changed: false` lets the caller skip
   * the diff popover and show "Looks good!" instead.
   */
  async correct(text: string): Promise<TextFixResult> {
    if (!text.trim()) {
      return { newText: text, changed: false }
    }

    const agent = this.getAgent()

    const startedAt = Date.now()
    logger.info('text-fix-agent.correct.begin', { textLength: text.length })

    const result = await agent.generate(text)
    const parsedText = parseAgentOutput(result.content)

    // Defense against prompt-injection / non-aligned LLM output: the model
    // is instructed to preserve tags and only fix text content. We reject the
    // response if it introduces any new tag OR adds an attribute name that
    // wasn't already on that tag in the input. Tag-name-only checks are
    // bypassable: an LLM can echo a pre-existing `<a>` and add `onclick`, or
    // an `<img>` and add `onerror`, and the tag set stays unchanged. The
    // committed HTML flows straight into the customer's source via the AST
    // text editor, so a smuggled handler would land as stored XSS in their
    // deployed app. Attribute *values* are not checked here — small value
    // diffs would cause too many false positives, and downstream
    // `attributesToJsx` filters `javascript:` href.
    const violation = findStructuralViolation(text, parsedText)
    if (violation) {
      logger.warn('text-fix-agent.structural-violation.rejected', {
        inputLength: text.length,
        outputLength: parsedText.length,
        violation
      })
      return { newText: text, changed: false }
    }

    const newText = parsedText
    const changed = newText !== text

    logger.info('text-fix-agent.correct.complete', {
      changed,
      durationMs: Date.now() - startedAt,
      inputLength: text.length,
      outputLength: newText.length
    })

    return { newText, changed }
  }

  async cleanup(): Promise<void> {
    logger.info('text-fix-agent.cleanup.complete', {})
    this.factory = null
  }
}

function parseAgentOutput(raw: string): string {
  const stripped = stripJsonFences((raw ?? '').trim())
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    logger.warn('text-fix-agent.parse-failed', { preview: stripped.slice(0, 200) })
    throw new Error('LLM response was not valid JSON')
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'newText' in parsed &&
    typeof (parsed as { newText: unknown }).newText === 'string'
  ) {
    return (parsed as { newText: string }).newText
  }
  logger.warn('text-fix-agent.schema-failed', { preview: stripped.slice(0, 200) })
  throw new Error('LLM response missing string `newText` field')
}

/**
 * Returns true when `output` contains at least one tag name that doesn't
 * appear in `input`. Kept as a thin wrapper over `findStructuralViolation`
 * so existing callers/tests continue to work; new code should prefer
 * `findStructuralViolation` directly for the more complete attribute-aware
 * defense.
 */
export function introducesNewTags(input: string, output: string): boolean {
  const inputMap = extractTagAttributeMap(input)
  const outputMap = extractTagAttributeMap(output)
  for (const tag of outputMap.keys()) {
    if (!inputMap.has(tag)) return true
  }
  return false
}

/**
 * Returns a human-readable description of the first structural violation
 * found in `output` relative to `input`, or `null` when output is structurally
 * a subset of input. We compare both:
 *   1. Tag names — output may not introduce a tag the input didn't have
 *      (no smuggled `<script>`, `<iframe>`, `<img>`, etc.).
 *   2. Attribute *names* per tag — output may not add an attribute name to
 *      a tag that wasn't already on that tag in the input. This blocks
 *      `<a onclick=...>` when the input had only `<a href=...>`, even though
 *      the tag set is unchanged.
 *
 * Attribute *values* are intentionally not compared. Small value diffs (e.g.
 * the model fixing a typo inside `alt`) would generate too many false
 * positives, and downstream `attributesToJsx` already filters `javascript:`
 * href. The risk we're guarding against here is *new attribute names* (event
 * handlers, `srcdoc`, `formaction`) — those land verbatim in customer JSX.
 *
 * Uses a regex rather than DOMParser: the agent runs on Node where DOMParser
 * isn't available without a polyfill, and full HTML parsing is overkill for
 * what we need. The regex consumes quoted attribute values so a `>` inside
 * a value doesn't terminate the tag prematurely, and a name appearing inside
 * a value isn't mistaken for an attribute name.
 */
export function findStructuralViolation(input: string, output: string): string | null {
  const inputMap = extractTagAttributeMap(input)
  const outputMap = extractTagAttributeMap(output)
  for (const [tag, attrs] of outputMap) {
    const allowed = inputMap.get(tag)
    if (!allowed) return `new tag <${tag}>`
    for (const attr of attrs) {
      if (!allowed.has(attr)) return `new attribute "${attr}" on <${tag}>`
    }
  }
  return null
}

function extractTagAttributeMap(html: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  // Capture tag name + the attribute block. The attribute block consumes
  // quoted values fully so `>` inside a value doesn't end the tag, and so
  // we can safely scan the block for attribute *names* without matching
  // identifiers that appear inside values.
  //
  // Attribute separator is `[\s/]+` (not just `\s+`): per HTML5, `/` between
  // attributes is treated as whitespace, so `<a/onclick="evil()">` parses
  // with `onclick` as a real attribute. Without this the regex would fail
  // to match the tag at all and the smuggled handler would slip past the
  // structural-violation check.
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/]+[a-zA-Z_][a-zA-Z0-9_:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const name = tagMatch[1]?.toLowerCase()
    const block = tagMatch[2] ?? ''
    if (!name) continue
    const attrs = map.get(name) ?? new Set<string>()
    const attrRe = /[\s/]+([a-zA-Z_][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g
    let attrMatch: RegExpExecArray | null
    while ((attrMatch = attrRe.exec(block)) !== null) {
      const attrName = attrMatch[1]?.toLowerCase()
      if (attrName) attrs.add(attrName)
    }
    map.set(name, attrs)
  }
  return map
}

function stripJsonFences(text: string): string {
  if (text.startsWith('```')) {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  }
  return text
}
