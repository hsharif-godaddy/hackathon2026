/**
 * Integration test that loads the real `agents/src/prompts/diagnose/*.md` fragments
 * through LlmClassifier's default prompt resolver. Protects against a rename or missing
 * fragment silently breaking production — unit tests inject fake readers and never touch
 * the filesystem.
 */

import { describe, it, expect } from 'vitest';
import { LlmClassifier } from '../classifiers/LlmClassifier.js';
import type {
  AppContext,
  LlmAnalysisOutput,
  LlmClient,
  LlmGenerateArgs,
} from '../types.js';
import type { SanitizedLogEntry } from '../../log-sanitizer.js';

class CapturingLlmClient implements LlmClient {
  public lastArgs: LlmGenerateArgs<unknown> | null = null;

  async generateStructured<T>(args: LlmGenerateArgs<T>): Promise<T> {
    this.lastArgs = args;
    const stub: LlmAnalysisOutput = {
      status: 'healthy',
      primaryRecommendation: 'ok',
      issues: [
        {
          id: 'noop',
          category: 'Unknown',
          severity: 'warning',
          message: 'noop',
          recommendation: 'noop',
          confidence: 10,
        },
      ],
    };
    return stub as T;
  }
}

function logLine(message: string): SanitizedLogEntry {
  return { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message, level: 'error' };
}

const CTX: AppContext = {
  appId: 'real-app-id',
  target: 'publish',
  contextSource: 'none',
  projectContextText: 'No project files were available for this diagnosis.',
  filesIncluded: 0,
};

describe('LlmClassifier — real prompt files (integration)', () => {
  it('loads system + user templates from disk and resolves all placeholders', async () => {
    const client = new CapturingLlmClient();
    // No promptsRoot / readFile overrides — uses the default walk to agents/src/prompts/.
    const classifier = new LlmClassifier(client);

    await classifier.classify([logLine('boom')], CTX);

    expect(client.lastArgs).not.toBeNull();
    const { system, user } = client.lastArgs!;

    expect(system).toContain('deployment troubleshooter');
    expect(system).toContain('Platform Upload Guidelines');
    expect(system).toContain('package.json');
    expect(system).toContain('Dependencies');
    expect(system).toContain('Runtime');
    expect(system).toContain('Packaging');
    expect(system).toContain('Framework Patterns');
    expect(system).toContain('Log Symptom');
    expect(system).toContain('Output Contract');

    expect(system).toContain('platform-outage');
    expect(system).toContain('insufficient-log-evidence');
    expect(user).toContain('Project context');

    // All placeholders must be resolved — no `{{...}}` markers left anywhere.
    expect(system).not.toMatch(/\{\{[A-Za-z]+\}\}/);
    expect(user).not.toMatch(/\{\{[A-Za-z]+\}\}/);

    // User prompt contains per-request context.
    expect(user).toContain('real-app-id');
    expect(user).toContain('publish');
    expect(user).toContain('boom');
  });
});
