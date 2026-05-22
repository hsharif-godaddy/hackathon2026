import { describe, it, expect } from 'vitest';
import { PatternClassifier } from '../classifiers/PatternClassifier.js';
import type { SanitizedLogEntry } from '../../log-sanitizer.js';

function log(message: string): SanitizedLogEntry {
  return { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message, level: 'error' };
}

const ctx = {
  appId: 'a',
  target: 'preview' as const,
  contextSource: 'none' as const,
  projectContextText: 'No project files were available for this diagnosis.',
  filesIncluded: 0,
};

describe('PatternClassifier', () => {
  const classifier = new PatternClassifier();

  it('matches missing npm package and returns install command', async () => {
    const result = await classifier.classify(
      [log("Error: Cannot find module 'lodash'")],
      ctx
    );

    expect(result.handled).toBe(true);
    expect(result.issues[0]!.recommendation).toContain('npm install lodash');
    expect(result.issues[0]!.actions?.[0]).toEqual({
      type: 'command',
      command: 'npm install lodash',
    });
  });

  it('matches missing local module path', async () => {
    const result = await classifier.classify(
      [log("Error: Cannot find module './routes'")],
      ctx
    );
    expect(result.handled).toBe(true);
    expect(result.issues[0]!.id).toBe('missing-local-module');
    expect(result.issues[0]!.recommendation).toContain('./routes');
  });

  it('matches missing script start', async () => {
    const result = await classifier.classify(
      [log('npm ERR! missing script: start')],
      ctx
    );
    expect(result.handled).toBe(true);
    expect(result.issues[0]!.id).toBe('missing-script-start');
    expect(result.issues[0]!.recommendation).toContain('package.json');
  });

  it('matches hardcoded port / EADDRINUSE', async () => {
    const result = await classifier.classify(
      [log('Error: listen EADDRINUSE: address already in use :::3000')],
      ctx
    );
    expect(result.handled).toBe(true);
    expect(result.issues[0]!.id).toBe('hardcoded-port');
    expect(result.issues[0]!.recommendation).toContain('process.env.PORT');
  });

  it('matches TypeScript compile error with file hint', async () => {
    const result = await classifier.classify(
      [log('error TS2322 in src/app.ts:12:5')],
      ctx
    );
    expect(result.handled).toBe(true);
    expect(result.issues[0]!.id).toBe('typescript-compile-error');
    expect(result.issues[0]!.recommendation).toContain('src/app.ts');
    expect(result.issues[0]!.recommendation).toContain('at line 12');
  });

  it('returns handled=false when no rule matches', async () => {
    const result = await classifier.classify([log('something vague happened')], ctx);
    expect(result.handled).toBe(false);
  });
});
