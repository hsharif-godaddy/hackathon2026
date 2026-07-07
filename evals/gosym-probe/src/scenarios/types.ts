import type { Evaluator } from '../evaluators/evaluator.js';
import type { DOMSnapshot, ToolCall } from '../runner/transcript.js';
import type { CapturedSite } from '../clients/site-capture/types.js';
import type { Persona } from '../personas/types.js';
import type { AgentClient } from '../clients/agent-client.js';

export interface SetupContext {
  appId?: string;
  previewUrl?: string;
  [key: string]: unknown;
}

export type StabilityLevel = 'low' | 'medium' | 'high';

/**
 * The develop sub-agent's DISPLAY name, as it appears on toolCall.agentId
 * (the agentId is the display name, not a slug — confirmed from real runs:
 * tool calls carried 'Initial' then 'AI Developer'). Used as the
 * expectedAgent on build scenarios so a UI-facing rename is a single edit
 * here rather than a literal repeated across scenarios.
 */
export const DEVELOP_AGENT_DISPLAY_NAME = 'AI Developer';

export const DEFAULT_STABILITY_LEVEL: StabilityLevel = 'low';

export const STABILITY_TRIALS: Record<StabilityLevel, number> = {
  low: 5,
  medium: 10,
  high: 20,
};

export function resolveStabilityLevel(
  override: StabilityLevel | undefined,
  scenario: Pick<Scenario, 'stabilityLevel'>,
): StabilityLevel {
  return override ?? scenario.stabilityLevel ?? DEFAULT_STABILITY_LEVEL;
}

export interface ScenarioGoal {
  description: string;
  assertion: 'positive' | 'negative';
}

/**
 * Allowed value types for a {@link ToolCallAssertion} `args` matcher. Constrained
 * to primitives because the tool-call-verification evaluator compares with strict
 * `===`: an object/array value could never structurally match a recorded tool
 * input and would silently mis-score (a `called: false` guard always "passes,"
 * a `called: true` always "fails"). Authoring a non-primitive arg is therefore a
 * compile error, not a latent runtime footgun.
 */
export type AssertionArgValue = string | number | boolean | null;

export interface ToolCallAssertion {
  tool: string;
  /** Whether this tool MUST have been called (true) or MUST NOT (false). */
  called: boolean;
  match?: 'exact' | 'prefix';
  toolPattern?: RegExp;
  /**
   * When set, the assertion matches a tool call only if its recorded `input`
   * contains every key/value in `args` (shallow subset, strict equality per
   * key). Lets one assertion target a specific call of a tool — e.g. `handoff`
   * with `{ targetAgent: 'marketing' }` — instead of any call by name alone.
   */
  args?: Record<string, AssertionArgValue>;
}

/**
 * Develop-owned (post-deprecation) assertion: a marketing/social request MUST
 * NOT be handed off to a standalone marketing agent — develop handles marketing
 * (SEO, social, campaigns) directly. `called: false` + the `targetAgent` arg
 * pins the assertion to the *marketing* handoff, so a benign
 * InitialAgent→develop scaffold handoff (a different targetAgent) still
 * satisfies it. Exported so every marketing/social scenario asserts the same
 * invariant from one definition.
 */
export const NO_MARKETING_HANDOFF: ToolCallAssertion = {
  tool: 'handoff',
  called: false,
  args: { targetAgent: 'marketing' },
};

/**
 * Per-request switchboard flags forwarded into the mock JWT a scenario mints
 * (see `resolveAgentAuth` / `makeAgentClient`). Under AUTH_TYPE=mock the agent
 * rebuilds its request context from the token's claims, so a claim-gated skill
 * (e.g. marketing-campaigns) only becomes available to the develop agent when
 * its flag rides here. Extension point for future claim-gated skills.
 */
export interface Claims {
  /** Gates the marketing-campaigns skill (switchboard: appbuilder-marketing-campaigns). */
  marketingCampaignsEnabled?: boolean;
}

/**
 * CheckList behavioral-test category (Ribeiro et al., ACL 2020), narrowed
 * to the two categories that reduce cleanly to a binary pass/fail:
 * - 'capability'  (MFT) — a required behavior must be present.
 *   Failure is a hard fail for the scenario.
 * - 'invariance'  (INV) — a property that must hold regardless of how
 *   the artifact was built (e.g. no module-not-found, publish did not
 *   500). Failure is a hard fail.
 *
 * The third CheckList category, DIR (directional), is intentionally NOT
 * here. A directional signal is a matter of degree ("how much of this did
 * we get"), not a hard yes/no, so folding it into this binary reducer
 * produced a 'partial' verdict that lands in the pass@k denominator but
 * never the numerator — silently deflating the pass rate like a fail
 * without being a clean fail. Directional expectations now live on
 * {@link ExpectedArtifactSpec.directionalItems} and are scored by the
 * score-mode DirectionalSignalEvaluator (gated by TOST / Wilson CI against
 * baseline) instead. See {@link DirectionalItem}.
 */
export type ChecklistCheckType = 'capability' | 'invariance';

/** Identity fields common to every artifact expectation. */
interface MatchableItemBase {
  /** Stable identifier, e.g. 'has-contact-form'. */
  id: string;
  /** Observable behavior/signal in plain language. */
  description: string;
}

type DomMatcher = (site: CapturedSite, snapshots: DOMSnapshot[]) => boolean;
type ToolMatcher = (toolCalls: ToolCall[]) => boolean;
type RouteMatcher = { path: string | RegExp; mustBeReachable: boolean };
type TextMatcher = { source: 'rendered' | 'transcript'; pattern: RegExp };

/**
 * The matcher surface shared by every artifact expectation, binary or
 * directional. Matchers assert *capabilities* over the captured artifact,
 * never string-equality against a golden output — so any valid
 * implementation of the behavior passes.
 *
 * This is a discriminated union over the four matcher kinds: EXACTLY ONE
 * matcher may be set per item (the others are `?: never`), so a two-matcher
 * item — where `matchItem`'s fixed dom > route > tool > text priority would
 * silently drop the extras — is a compile error rather than a latent bug.
 *
 * Both {@link ChecklistItem} and {@link DirectionalItem} build on this, so a
 * new matcher kind added here propagates to both and the shared `matchItem`
 * routine — and an item can be reclassified between binary and directional
 * by moving it between arrays with no matcher rewrite.
 */
export type MatchableItem = MatchableItemBase &
  (
    | { domMatcher: DomMatcher; toolMatcher?: never; routeMatcher?: never; textMatcher?: never }
    | { toolMatcher: ToolMatcher; domMatcher?: never; routeMatcher?: never; textMatcher?: never }
    | { routeMatcher: RouteMatcher; domMatcher?: never; toolMatcher?: never; textMatcher?: never }
    | { textMatcher: TextMatcher; domMatcher?: never; toolMatcher?: never; routeMatcher?: never }
  );

/**
 * A single binary behavioral expectation, checked deterministically
 * against trial data by the expected-artifact-match evaluator. Its
 * capability/invariance `type` hard-gates the scenario (pass/fail).
 */
export type ChecklistItem = MatchableItem & { type: ChecklistCheckType };

/**
 * A "nice to have" directional signal that should be present but isn't
 * required (e.g. the copy mentions the product category). Scored as a
 * degree — the fraction of directional items met per trial — by the
 * score-mode DirectionalSignalEvaluator, and gated statistically (TOST /
 * Wilson CI) against baseline rather than hard-gating the scenario. This
 * is deliberately kept OUT of {@link ChecklistItem} (it carries no `type`)
 * so the binary checklist reducer can never emit a 'partial'.
 */
export type DirectionalItem = MatchableItem;

/**
 * The written-down "expected finished product" for a scenario: the
 * user's intent plus a CheckList of binary behavioral expectations.
 * Consumed by the expected-artifact-match (static) evaluator and the
 * narrow-artifact-judge (LLM) evaluator, which share these items so
 * their per-item verdicts are directly comparable.
 */
export interface ExpectedArtifactSpec {
  /** Human-readable summary of what the user wanted. */
  intent: string;
  /** Binary (capability / invariance) expectations — hard pass/fail. */
  items: ChecklistItem[];
  /**
   * Directional (degree) signals scored by the score-mode
   * DirectionalSignalEvaluator, never hard-gating the scenario. Optional:
   * scenarios with no directional signals omit it.
   */
  directionalItems?: DirectionalItem[];
  /**
   * Bumped whenever an item changes. Surfaces on EvalResult.evalVersion
   * so baseline comparison is skipped when the checklist changes,
   * preventing a tightened check from firing a false regression.
   */
  evalVersion: string;
}

/**
 * A specific instruction the agent is expected to follow when executing
 * a skill. Checked by SkillOutcomeEvaluator via LLM judge.
 */
export interface SkillInstruction {
  /** Stable ID for reporting (e.g. 'uses-react-helmet'). kebab-case. */
  id: string;
  /** The specific instruction to check, in plain language. */
  instruction: string;
  /**
   * 'required' = hard-fails the skill-outcome verdict if not followed.
   * 'advisory' = never gates the verdict; reported as an adherence fraction
   * (details.advisoryAdherence) only.
   */
  priority: 'required' | 'advisory';
}

export interface Scenario {
  name: string;
  suite?: string;
  persona: Persona;
  agentProfile?: string;
  goals: ScenarioGoal[];
  evaluators: Evaluator[];
  trials: number;
  stabilityLevel?: StabilityLevel;
  referenceSolution?: string | DOMSnapshot;
  expectedTools?: ToolCallAssertion[];
  /**
   * The written-down expected finished product for this scenario,
   * consumed by the expected-artifact-match and narrow-artifact-judge
   * evaluators. Typically loaded from a co-located expectation fixture
   * (src/scenarios/<suite>/expectations/<scenario>.expectation.ts).
   */
  expectedArtifact?: ExpectedArtifactSpec;
  /**
   * Skills the agent is expected to load to satisfy this scenario,
   * asserted by the skill-selection evaluator. The skill-load check
   * is only enforced when SKILL_DIAGNOSTICS instrumentation populates
   * Transcript.loadedSkills; otherwise that sub-check returns
   * 'incomplete'.
   */
  expectedSkills?: string[];
  /**
   * The sub-agent expected to handle this scenario's work (e.g.
   * 'develop'). Asserted by skill-selection against toolCall.agentId,
   * which is populated today (no instrumentation gate). When set, at
   * least one tool call must carry this agentId.
   */
  expectedAgent?: string;
  /**
   * Per-request switchboard claims forwarded into this scenario's mock JWT,
   * making a claim-gated skill available to the develop agent for this
   * scenario only. Consumed by `resolveAgentAuth` in `src/clients/agent-auth.ts`
   * (wired in `makeAgentClient`). Absent → default (skill ungated/unavailable).
   */
  contextClaims?: Claims;
  /**
   * Skill-specific instructions the agent is expected to follow.
   * Consumed by SkillOutcomeEvaluator at eval time. Required for
   * skill-eval scenarios (factory enforces non-empty); optional on
   * the Scenario type so non-skill-eval scenarios don't need it.
   */
  skillInstructions?: SkillInstruction[];
  setup?: () => Promise<SetupContext | void>;
  teardown?: (ctx: SetupContext) => Promise<void>;
  /**
   * When true, this scenario's trials MUST run sequentially (concurrency 1).
   * Set by stateful injection, which shares one app workspace across trials:
   * concurrent trials would reset/clobber each other's in-progress build. The
   * runner throws rather than silently corrupting measurements if effective
   * trial concurrency is > 1.
   */
  requiresSerialTrials?: boolean;
  /**
   * When set, the synthetic user sends this text
   * verbatim on the first turn instead of generating a
   * message via the GoCode LLM. Use for scenarios that
   * require a fixed, reproducible prompt.
   *
   * Single-turn only. For multi-turn scripted conversations
   * use {@link scriptedTurns}, which supersedes this field.
   */
  staticFirstMessage?: string;
  /**
   * A fixed, ordered list of verbatim user messages for stateful injection.
   * The {@link ScriptedSyntheticUser} replays entry `n` on the nth user turn
   * with no LLM call, removing synthetic-user variance. Once the script is
   * exhausted it either delegates to the LLM-backed user (free-form
   * continuation) or ends the conversation — see {@link scriptEndsConversation}.
   *
   * Supersedes {@link staticFirstMessage}: when both are set, `scriptedTurns[0]`
   * is used for the first turn and `staticFirstMessage` is ignored.
   */
  scriptedTurns?: string[];
  /**
   * When true, the conversation ends once {@link scriptedTurns} is exhausted
   * (the synthetic user returns null) instead of handing off to the LLM-backed
   * user for free-form continuation. Use for fully-deterministic runs. Ignored
   * when `scriptedTurns` is unset.
   */
  scriptEndsConversation?: boolean;
  /**
   * Called with the agent client immediately before each
   * trial's simulation starts. Use for non-evaluator
   * per-trial hooks. Evaluator hooks should use
   * Evaluator.hookClient() instead (called automatically
   * by SuiteRunner).
   */
  beforeTrial?: (
    client: AgentClient,
    trialIndex: number,
  ) => void;
}
