import type { SanitizedLogEntry } from '../../log-sanitizer.js';
import type { AppContext, Classifier, ClassifierResult, Issue } from '../types.js';

interface PatternRule {
  id: string;
  category: string;
  test: (logText: string) => boolean;
  extract?: (logText: string) => Record<string, string>;
  buildIssue: (extracted: Record<string, string>, relatedLog: string) => Issue;
}

const RULES: PatternRule[] = [
  {
    id: 'missing-script-start',
    category: 'Scripts',
    test: (t) => /missing script:\s*start/i.test(t),
    buildIssue: (_e, log) => ({
      id: 'missing-script-start',
      category: 'Scripts',
      severity: 'error',
      message: 'package.json is missing a scripts.start entry required to boot the app.',
      recommendation:
        'Add a start script to package.json, e.g. `"scripts": { "start": "node dist/server.js" }`, then redeploy.',
      confidence: 95,
      source: 'pattern',
      relatedLogs: [log],
      actions: [
        {
          type: 'file_edit',
          path: 'package.json',
          description: 'Add scripts.start pointing at your server entry file',
        },
      ],
    }),
  },
  {
    id: 'missing-npm-module',
    category: 'Dependencies',
    test: (t) => /Cannot find module ['"]([^'"]+)['"]/i.test(t),
    extract: (t) => {
      const m = t.match(/Cannot find module ['"]([^'"]+)['"]/i);
      return { module: m?.[1] ?? 'unknown' };
    },
    buildIssue: (e, log) => {
      const mod = e.module ?? 'unknown';
      const isRelative = mod.startsWith('.') || mod.startsWith('/');
      if (isRelative) {
        return {
          id: 'missing-local-module',
          category: 'Application Code',
          severity: 'error',
          message: `Module not found: ${mod}`,
          recommendation: `Fix the import path in your source — ensure ${mod} exists and the extension/path is correct for your module system (CommonJS vs ESM).`,
          confidence: 85,
          source: 'pattern',
          relatedLogs: [log],
        };
      }
      return {
        id: `missing-module-${mod.replace(/[^a-z0-9]+/gi, '-')}`,
        category: 'Dependencies',
        severity: 'error',
        message: `Missing npm package: ${mod}`,
        recommendation: `Run npm install ${mod} (or yarn/pnpm add ${mod}), commit package.json and lockfile, then redeploy.`,
        confidence: 92,
        source: 'pattern',
        relatedLogs: [log],
        actions: [{ type: 'command', command: `npm install ${mod}` }],
      };
    },
  },
  {
    id: 'hardcoded-port',
    category: 'Port Binding',
    test: (t) => /EADDRINUSE|listen EACCES/i.test(t) && /:\d{2,5}/.test(t),
    buildIssue: (_e, log) => ({
      id: 'hardcoded-port',
      category: 'Port Binding',
      severity: 'error',
      message: 'The app appears to bind a fixed port instead of process.env.PORT.',
      recommendation:
        'Change your server listen call to use process.env.PORT (e.g. `const port = process.env.PORT || 3000; app.listen(port)`), then redeploy.',
      confidence: 88,
      source: 'pattern',
      relatedLogs: [log],
      actions: [
        {
          type: 'file_edit',
          path: 'src/server entry file',
          description: 'Use process.env.PORT for the listen port',
        },
      ],
    }),
  },
  {
    id: 'typescript-error',
    category: 'Build',
    test: (t) => /error TS\d{4}/i.test(t),
    extract: (t) => {
      const file = t.match(/([^\s(]+\.(?:ts|tsx))[(:](\d+)/i);
      return { file: file?.[1] ?? '', line: file?.[2] ?? '' };
    },
    buildIssue: (e, log) => ({
      id: 'typescript-compile-error',
      category: 'Build',
      severity: 'error',
      message: e.file
        ? `TypeScript compilation failed in ${e.file}${e.line ? `:${e.line}` : ''}.`
        : 'TypeScript compilation failed during build.',
      recommendation: e.file
        ? `Open ${e.file}${e.line ? ` at line ${e.line}` : ''}, fix the type error shown in the logs, run npm run build locally to verify, then redeploy.`
        : 'Fix the TypeScript errors listed in the build logs, run npm run build locally to verify, then redeploy.',
      confidence: 80,
      source: 'pattern',
      relatedLogs: [log],
    }),
  },
];

/**
 * Tier 1: deterministic high-confidence fixes from log patterns.
 * Returns handled=false when no rule matches so the orchestrator falls through to LLM.
 */
export class PatternClassifier implements Classifier {
  readonly source = 'pattern' as const;

  async classify(logs: SanitizedLogEntry[], _context: AppContext): Promise<ClassifierResult> {
    if (logs.length === 0) {
      return { handled: false, issues: [] };
    }

    const logText = logs.map((l) => l.message).join('\n');
    const errorLines = logs.filter((l) => l.level === 'error' || /\b(error|ERR_|TS\d{4})\b/i.test(l.message));

    for (const rule of RULES) {
      if (!rule.test(logText)) continue;

      const relatedLog =
        errorLines.find((l) => rule.test(l.message))?.message ?? logs[logs.length - 1]!.message;
      const extracted = rule.extract?.(logText) ?? {};
      const issue = rule.buildIssue(extracted, relatedLog);

      return {
        handled: true,
        issues: [issue],
        status: 'failing',
        primaryRecommendation: issue.recommendation,
      };
    }

    return { handled: false, issues: [] };
  }
}
