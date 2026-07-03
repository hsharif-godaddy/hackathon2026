import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

interface SkillCheck {
  skill: string;
  status: 'pass' | 'fail';
}

/**
 * How the skill-load sub-check was resolved, surfaced on `details.skillMode`:
 * - 'true' — SKILL_DIAGNOSTICS populated loadedSkills; assertion is authoritative.
 * - 'proxy' — instrumentation off; confirmed passes via explicit skill-load
 *   tool calls, absences stay 'unknown'.
 * - 'missing-instrumentation' — required-diagnostics scenario ran without
 *   instrumentation; a hard fail (broken gate).
 * - 'n/a' — no skill expectation on this scenario.
 */
export type SkillMode = 'true' | 'proxy' | 'missing-instrumentation' | 'n/a';

export interface SkillSelectionOptions {
  /**
   * When true, a scenario that declares `expectedSkills` but runs without
   * skill-load instrumentation (SKILL_DIAGNOSTICS off → transcript.loadedSkills
   * absent) is a hard `fail`, not a silently-dropped `unknown`.
   *
   * Set on scenarios whose PURPOSE is to gate on skill loading (the skill-eval
   * suite): there, the deterministic skill signal must be guaranteed live, so
   * absent instrumentation is a broken gate, not a benign observability gap. A
   * silent `unknown` would be dropped from pass@k and collapse the gate onto
   * the LLM skill-outcome judge alone — the exact dependence these scenarios
   * exist to reduce. Requiring the real instrumentation also means a gating
   * scenario never passes on an invisible auto-load the proxy can't see. Leave
   * false (default) for scenarios that carry `expectedSkills` as a best-effort
   * annotation and legitimately run with diagnostics off (proxy mode).
   */
  requireSkillDiagnostics?: boolean;
}

function agentIds(transcript: Transcript): Set<string> {
  const ids = new Set<string>();
  for (const turn of transcript.turns) {
    for (const call of turn.toolCalls) {
      if (call.agentId) ids.add(call.agentId);
    }
  }
  return ids;
}

interface SkillToolInput {
  action?: unknown;
  skill?: unknown;
}

/**
 * Skills proven loaded via an explicit `skill({ action: 'load', skill })`
 * tool call visible in the transcript. This is the instrumentation-free
 * positive signal: a load call is direct evidence the skill activated.
 *
 * It is deliberately one-directional. ABSENCE from this set is NOT evidence a
 * skill failed to load — skills also activate via auto-load (e.g. media-logo
 * in the initial agent), pinning, and session-start hooks, none of which
 * surface as a top-level `skill` tool call. So this set may only UPGRADE a
 * proxy-mode check to 'pass'; it must never drive a 'fail'.
 */
function skillsLoadedViaToolCall(transcript: Transcript): Set<string> {
  const loaded = new Set<string>();
  for (const turn of transcript.turns) {
    for (const call of turn.toolCalls) {
      if (call.name !== 'skill') continue;
      const input = call.input as SkillToolInput | undefined;
      if (input?.action !== 'load') continue;
      if (typeof input.skill === 'string' && input.skill.length > 0) {
        loaded.add(input.skill);
      }
    }
  }
  return loaded;
}

/**
 * Whether `expected` is confirmed loaded by `loadedViaTool`. Matches exactly
 * first, then tolerantly on the last path segment so a nested load
 * ('payment/stripe') confirms a bare expectation ('stripe') and vice versa.
 * Tolerant matching is safe here because this only ever confirms a pass.
 */
function toolCallConfirmsSkill(
  expected: string,
  loadedViaTool: Set<string>,
): boolean {
  if (loadedViaTool.has(expected)) return true;
  const lastSegment = (name: string): string =>
    name.includes('/') ? name.split('/').at(-1)! : name;
  const target = lastSegment(expected).toLowerCase();
  for (const loaded of loadedViaTool) {
    if (lastSegment(loaded).toLowerCase() === target) return true;
  }
  return false;
}

/**
 * Skill-selection metric (squad 1A taxonomy: "did the agent pick the
 * right skill?"). Checks the agent's execution PATH against a
 * scenario's expectations: which sub-agent handled the work (routing)
 * and whether the requisite skill loaded (skill-load). The two
 * sub-checks have different readiness:
 *
 * - Routing (scenario.expectedAgent) is observable TODAY via
 *   toolCall.agentId — a hard binary assertion, no instrumentation gate.
 * - Skill-load (scenario.expectedSkills) has two modes:
 *   - TRUE mode — when SKILL_DIAGNOSTICS populates transcript.loadedSkills,
 *     assert each expected skill is present (can pass OR fail).
 *   - PROXY mode — when loadedSkills is absent, fall back to explicit
 *     `skill({ action: 'load' })` tool calls in the transcript. These
 *     positively CONFIRM a skill loaded (→ 'pass'), but their absence is not
 *     evidence of non-loading — skills also auto-load, pin, and load via
 *     hooks without a visible tool call — so an unconfirmed skill stays
 *     'incomplete' rather than failing. Proxy mode can therefore upgrade a check
 *     to 'pass' but never to 'fail'.
 *   - REQUIRED mode — when constructed with `requireSkillDiagnostics: true`
 *     and instrumentation is absent, the skill-load check is a hard 'fail'
 *     rather than proxy/'unknown'. For a scenario whose reason for existing is
 *     to gate on skill loading, a missing deterministic signal is a broken
 *     gate that must be loud, not silently dropped from pass@k.
 *
 * Overall verdict: 'fail' if any evaluable sub-check fails; 'pass' if at
 * least one sub-check was evaluable and none failed; 'incomplete' only when
 * nothing could be evaluated (no expectations, or skill-load in proxy
 * mode with no routing expectation). 'incomplete' is excluded from
 * composites/pass@k, so proxy mode never silently passes/fails.
 */
export class SkillSelectionEvaluator implements Evaluator {
  readonly name = 'skill-selection';
  readonly comparisonMode = 'passRate' as const;

  /**
   * A required-diagnostics skill-selection check is the scenario's gate: if it
   * crashes, the aggregator must count the trial as a hard fail, not drop it
   * from pass@k. Without this, a throw inside evaluate() re-opens the exact
   * fail-open `requireSkillDiagnostics` closes for the instrumentation-absent
   * path — the trial silently leaves the denominator instead of failing loud.
   * A best-effort (proxy-mode) check is not a gate, so it does not set this.
   */
  readonly gating: boolean;

  private readonly requireSkillDiagnostics: boolean;

  constructor(options: SkillSelectionOptions = {}) {
    this.requireSkillDiagnostics = options.requireSkillDiagnostics ?? false;
    this.gating = this.requireSkillDiagnostics;
  }

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const expectedSkills = scenario.expectedSkills ?? [];
    const expectedAgent = scenario.expectedAgent;

    if (expectedSkills.length === 0 && expectedAgent === undefined) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No expected skills or agent defined for this scenario',
      };
    }

    const reasons: string[] = [];
    const failures: string[] = [];
    let evaluableChecks = 0;

    // ── Routing sub-check (available today via agentId) ──────────
    let routing: { expected: string; matched: boolean } | undefined;
    if (expectedAgent !== undefined) {
      const matched = agentIds(transcript).has(expectedAgent);
      routing = { expected: expectedAgent, matched };
      evaluableChecks++;
      if (matched) {
        reasons.push(`routed to '${expectedAgent}'`);
      } else {
        failures.push(`expected agent '${expectedAgent}' did not handle any tool call`);
      }
    }

    // ── Skill-load sub-check (true / proxy / required-missing) ───
    const loaded = transcript.loadedSkills;
    let skillMode: SkillMode = 'n/a';
    let skillChecks: SkillCheck[] = [];
    let proxyConfirmed: string[] = [];
    if (expectedSkills.length > 0) {
      if (loaded === undefined && this.requireSkillDiagnostics) {
        // This scenario exists to gate on skill loading, so the deterministic
        // signal must be live. Absent instrumentation is a broken gate — a
        // loud, evaluable failure rather than a silently-dropped 'unknown' or
        // a best-effort proxy that can only ever pass.
        skillMode = 'missing-instrumentation';
        evaluableChecks++;
        failures.push(
          'skill-load instrumentation absent (SKILL_DIAGNOSTICS off) but '
          + 'required for this scenario; cannot verify skill loading',
        );
      } else if (loaded === undefined) {
        skillMode = 'proxy';
        // Instrumentation is off, but an explicit skill({ action: 'load' })
        // tool call is still direct proof the skill activated. Use it to
        // CONFIRM passes only — absence stays 'unknown' (skills also auto-load
        // / pin / load via hooks without a visible tool call), so this never
        // produces a false 'fail'.
        const loadedViaTool = skillsLoadedViaToolCall(transcript);
        proxyConfirmed = expectedSkills.filter((skill) =>
          toolCallConfirmsSkill(skill, loadedViaTool),
        );
        for (const skill of proxyConfirmed) {
          evaluableChecks++;
          reasons.push(`skill '${skill}' loaded (via skill tool call)`);
        }
        const unconfirmed = expectedSkills.filter(
          (skill) => !proxyConfirmed.includes(skill),
        );
        if (unconfirmed.length > 0) {
          reasons.push(
            'skill-load instrumentation absent (SKILL_DIAGNOSTICS off); '
            + `skill-load not verified for: ${unconfirmed.join(', ')}`,
          );
        }
      } else {
        skillMode = 'true';
        const loadedSet = new Set(loaded);
        skillChecks = expectedSkills.map((skill) => ({
          skill,
          status: loadedSet.has(skill) ? 'pass' : 'fail',
        }));
        for (const check of skillChecks) {
          evaluableChecks++;
          if (check.status === 'pass') {
            reasons.push(`skill '${check.skill}' loaded`);
          } else {
            failures.push(`expected skill '${check.skill}' not loaded`);
          }
        }
      }
    }

    if (evaluableChecks === 0) {
      // Only the proxy skill-load check applied and it is unanswerable.
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason:
          'Skill-load instrumentation absent (SKILL_DIAGNOSTICS off); '
          + 'cannot verify skill loading',
        details: { skillMode, expectedSkills, expectedAgent },
      };
    }

    const verdict: EvalResult['verdict'] =
      failures.length === 0 ? 'pass' : 'fail';

    return {
      evaluator: this.name,
      score: (evaluableChecks - failures.length) / evaluableChecks,
      verdict,
      reason:
        failures.length === 0
          ? reasons.join('; ')
          : failures.join('; '),
      details: {
        skillMode,
        expectedSkills,
        expectedAgent,
        ...(loaded !== undefined && { loadedSkills: loaded }),
        ...(proxyConfirmed.length > 0 && { proxyConfirmedSkills: proxyConfirmed }),
        ...(routing && { routing }),
        missingSkills: skillChecks.filter((c) => c.status === 'fail').map((c) => c.skill),
        failures,
      },
    };
  }
}
