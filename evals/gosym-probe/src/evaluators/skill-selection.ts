import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

interface SkillCheck {
  skill: string;
  status: 'pass' | 'fail';
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
 *     assert each expected skill is present.
 *   - PROXY mode — when loadedSkills is absent, the skill-load question
 *     is unanswerable from probe-visible data, so this sub-check yields
 *     'unknown' rather than guessing.
 *
 * Overall verdict: 'fail' if any evaluable sub-check fails; 'pass' if at
 * least one sub-check was evaluable and none failed; 'unknown' only when
 * nothing could be evaluated (no expectations, or skill-load in proxy
 * mode with no routing expectation). 'unknown' is excluded from
 * composites/pass@k, so proxy mode never silently passes/fails.
 */
export class SkillSelectionEvaluator implements Evaluator {
  readonly name = 'skill-selection';

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
        verdict: 'unknown',
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

    // ── Skill-load sub-check (true mode vs proxy mode) ───────────
    const loaded = transcript.loadedSkills;
    let skillMode: 'true' | 'proxy' | 'n/a' = 'n/a';
    let skillChecks: SkillCheck[] = [];
    if (expectedSkills.length > 0) {
      if (loaded === undefined) {
        skillMode = 'proxy';
        reasons.push(
          'skill-load instrumentation absent (SKILL_DIAGNOSTICS off); '
          + 'skill-load not verified',
        );
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
        verdict: 'unknown',
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
        ...(routing && { routing }),
        missingSkills: skillChecks.filter((c) => c.status === 'fail').map((c) => c.skill),
        failures,
      },
    };
  }
}
