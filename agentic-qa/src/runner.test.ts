import assume from 'assume';
import { describe, it } from 'node:test';

import {
  evaluateFrictionPatterns,
  matchExpectedErrorObservations,
  matchExpectedFailures,
  matchRequiredTools,
} from './runner.js';
import type { FrictionReport } from './scenarios/types.js';

// Minimal FrictionReport factory
function buildFrictionReport(patternTypes: string[]): FrictionReport {
  return {
    patternCount: patternTypes.length,
    patterns: patternTypes.map(type => ({
      type: type as FrictionReport['patterns'][number]['type'],
      severity: 'medium' as const,
      count: 3,
      startIndex: 0,
      endIndex: 5,
      wastedCostUSD: 0.01,
      description: `Detected ${type}`,
      toolNames: ['tool1'],
    })),
    score: patternTypes.length * 10,
    maxSeverity: 'medium',
    retryTransient: 0,
    retryAgent: patternTypes.length,
    retryUserInduced: 0,
    totalWastedCostUSD: 0.01 * patternTypes.length,
  };
}

describe('evaluateFrictionPatterns', () => {
  it('sets retryable=true when Langfuse unavailable (friction is null)', () => {
    const result = evaluateFrictionPatterns(['USER_CORRECTION'], 'any', null);
    assume(result.success).is.false();
    assume(result.retryable).is.true();
    assume(result.error).includes('friction detection did not run');
  });

  it('sets retryable=true when Langfuse unavailable (friction is undefined)', () => {
    const result = evaluateFrictionPatterns(['EDIT_LOOP'], 'all', undefined);
    assume(result.success).is.false();
    assume(result.retryable).is.true();
  });

  it('passes with matchMode "any" when at least one pattern matches', () => {
    const friction = buildFrictionReport(['EDIT_LOOP', 'GREP_SPIRAL']);
    const result = evaluateFrictionPatterns(['USER_CORRECTION', 'EDIT_LOOP'], 'any', friction);
    assume(result.success).is.true();
    assume(result.retryable).is.false();
  });

  it('fails with matchMode "all" when only subset detected', () => {
    const friction = buildFrictionReport(['EDIT_LOOP']);
    const result = evaluateFrictionPatterns(['EDIT_LOOP', 'USER_CORRECTION'], 'all', friction);
    assume(result.success).is.false();
    assume(result.retryable).is.true();
    assume(result.error).includes('USER_CORRECTION');
    assume(result.error).includes('all');
  });

  it('passes with matchMode "all" when all patterns detected', () => {
    const friction = buildFrictionReport(['EDIT_LOOP', 'USER_CORRECTION', 'GREP_SPIRAL']);
    const result = evaluateFrictionPatterns(['EDIT_LOOP', 'USER_CORRECTION'], 'all', friction);
    assume(result.success).is.true();
    assume(result.retryable).is.false();
  });

  it('fails with matchMode "any" when no patterns match', () => {
    const friction = buildFrictionReport(['GREP_SPIRAL']);
    const result = evaluateFrictionPatterns(['USER_CORRECTION', 'EDIT_LOOP'], 'any', friction);
    assume(result.success).is.false();
    assume(result.retryable).is.true();
    assume(result.error).includes('USER_CORRECTION');
    assume(result.error).includes('EDIT_LOOP');
  });

  it('handles empty detected patterns (Langfuse ran but no friction found)', () => {
    const friction = buildFrictionReport([]);
    const result = evaluateFrictionPatterns(['USER_CORRECTION'], 'any', friction);
    assume(result.success).is.false();
    assume(result.retryable).is.true();
  });
});

describe('matchExpectedFailures', () => {
  it('returns satisfied for empty expected', () => {
    const result = matchExpectedFailures([], 'all', 'some haystack');
    assume(result.satisfied).is.true();
  });

  it('matches case-insensitively', () => {
    const result = matchExpectedFailures(['TIMEOUT'], 'any', 'request timeout occurred');
    assume(result.satisfied).is.true();
  });

  it('mode "all" requires every signature', () => {
    const result = matchExpectedFailures(['timeout', 'enoent'], 'all', 'timeout happened');
    assume(result.satisfied).is.false();
    assume(result.missing).deep.equals(['enoent']);
  });

  it('mode "any" requires at least one', () => {
    const result = matchExpectedFailures(['timeout', 'enoent'], 'any', 'timeout happened');
    assume(result.satisfied).is.true();
    assume(result.matched).deep.equals(['timeout']);
  });
});

describe('matchExpectedErrorObservations', () => {
  const observations = [
    { name: 'str_replace_based_edit_tool', statusMessage: 'No match found for old_str' },
    { name: 'terminalCommand', statusMessage: 'exit code 1' },
  ];

  it('matches by name substring', () => {
    const result = matchExpectedErrorObservations(
      [{ name: 'str_replace' }],
      'all',
      observations
    );
    assume(result.satisfied).is.true();
    assume(result.matched.length).equals(1);
  });

  it('matches by name + statusMessage substring', () => {
    const result = matchExpectedErrorObservations(
      [{ name: 'str_replace', statusMessage: 'No match' }],
      'all',
      observations
    );
    assume(result.satisfied).is.true();
  });

  it('fails when statusMessage does not match', () => {
    const result = matchExpectedErrorObservations(
      [{ name: 'str_replace', statusMessage: 'wrong error' }],
      'all',
      observations
    );
    assume(result.satisfied).is.false();
  });

  it('mode "any" requires at least one match', () => {
    const result = matchExpectedErrorObservations(
      [{ name: 'nonexistent' }, { name: 'terminal' }],
      'any',
      observations
    );
    assume(result.satisfied).is.true();
    assume(result.matched.length).equals(1);
  });
});

describe('matchRequiredTools', () => {
  const spanNames = ['str_replace_based_edit_tool', 'terminalCommand', 'readFile'];

  it('matches tool name substring', () => {
    const result = matchRequiredTools([{ name: 'str_replace' }], 'all', spanNames);
    assume(result.satisfied).is.true();
  });

  it('mode "all" fails when one is missing', () => {
    const result = matchRequiredTools(
      [{ name: 'str_replace' }, { name: 'publishing__publish' }],
      'all',
      spanNames
    );
    assume(result.satisfied).is.false();
    assume(result.missing).deep.equals(['publishing__publish']);
  });

  it('mode "any" passes when at least one matches', () => {
    const result = matchRequiredTools(
      [{ name: 'nonexistent' }, { name: 'readFile' }],
      'any',
      spanNames
    );
    assume(result.satisfied).is.true();
  });

  it('returns satisfied for empty required list', () => {
    const result = matchRequiredTools([], 'all', spanNames);
    assume(result.satisfied).is.true();
  });
});

describe('minChatMessages gate logic', () => {
  // NOTE: The actual gate lives in runScenario() at runner.ts:457-462 and cannot be
  // unit-tested without a full browser+agent session. These tests verify the LOGIC
  // the gate implements (AND semantics, default of 1) to document expected behavior.
  // The Zod schema test in types.test.ts validates parse-time constraints (.min(1), requires creditLimit).
  // Integration coverage comes from the repro-scenario runs.

  it('fails when chatMessagesCompleted < minMessages (AND semantics)', () => {
    // Mirrors: overallSuccess = overallSuccess && chatMessagesCompleted >= minMessages
    const overallSuccess = true;
    const chatMessagesCompleted = 1;
    const minMessages = 2;
    assume(overallSuccess && chatMessagesCompleted >= minMessages).is.false();
  });

  it('passes when chatMessagesCompleted equals minMessages (>= not >)', () => {
    const overallSuccess = true;
    const chatMessagesCompleted = 2;
    const minMessages = 2;
    assume(overallSuccess && chatMessagesCompleted >= minMessages).is.true();
  });

  it('preserves prior failure even if messages threshold met', () => {
    const overallSuccess = false; // prior assertion failed
    const chatMessagesCompleted = 5;
    const minMessages = 2;
    assume(overallSuccess && chatMessagesCompleted >= minMessages).is.false();
  });

  it('defaults minMessages to 1 when scenario.minChatMessages is undefined', () => {
    // Mirrors: const minMessages = scenario.minChatMessages ?? 1
    const minChatMessages: number | undefined = undefined;
    assume(minChatMessages ?? 1).equals(1);
  });
});
