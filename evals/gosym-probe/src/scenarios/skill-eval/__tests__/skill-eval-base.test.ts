import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getSkillEvalBaseInjection,
  SKILL_EVAL_BASE_SUMMARY_TEXT,
  SKILL_EVAL_BASE_PRIOR_TURNS,
} from '../skill-eval-base.js';
import type { Config } from '../../../../config/environments/types.js';

function makeConfig(overrides: Partial<Config['aab']> = {}): Config {
  return {
    env: 'local.dev',
    aab: {
      agentsUrl: 'http://localhost:4000',
      bffUrl: 'http://localhost:3000',
      controlPlaneUrl: 'http://localhost:4100',
      ...overrides,
    },
    gocode: {
      baseUrl: 'http://gocode',
      apiKey: 'key',
      model: 'model',
    },
    eval: {
      defaultTrials: 3,
      maxTurns: 10,
      turnTimeoutMs: 60000,
    },
    playwright: { ignoreHttpsErrors: false },
    regression: {
      thresholds: {},
      defaultThreshold: 0.25,
    },
  } as unknown as Config;
}

const VALID_APP_ID = 'dental-base-app-id';
const VALID_PREVIEW_URL = 'http://preview.example.com';
const VALID_RESET_COMMIT = 'abc123def456';

describe('getSkillEvalBaseInjection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EVAL_SKILL_BASE_APP_ID;
    delete process.env.EVAL_SKILL_BASE_PREVIEW_URL;
    delete process.env.EVAL_SKILL_BASE_RESET_COMMIT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validation boundary tests — env var gating', () => {
    it('returns undefined when all three env vars are absent', () => {
      expect(getSkillEvalBaseInjection(makeConfig())).toBeUndefined();
    });

    it('returns undefined when EVAL_SKILL_BASE_APP_ID is missing', () => {
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
      expect(getSkillEvalBaseInjection(makeConfig())).toBeUndefined();
    });

    it('returns undefined when EVAL_SKILL_BASE_PREVIEW_URL is missing', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
      expect(getSkillEvalBaseInjection(makeConfig())).toBeUndefined();
    });

    it('returns undefined when EVAL_SKILL_BASE_RESET_COMMIT is missing', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      expect(getSkillEvalBaseInjection(makeConfig())).toBeUndefined();
    });

    it('returns undefined when EVAL_SKILL_BASE_APP_ID is empty string', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = '';
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
      expect(getSkillEvalBaseInjection(makeConfig())).toBeUndefined();
    });

    it('returns undefined when EVAL_SKILL_BASE_PREVIEW_URL is empty string', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = '';
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
      expect(getSkillEvalBaseInjection(makeConfig())).toBeUndefined();
    });

    it('returns undefined when EVAL_SKILL_BASE_RESET_COMMIT is empty string', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = '';
      expect(getSkillEvalBaseInjection(makeConfig())).toBeUndefined();
    });

    it('returns a result when all three env vars are set and non-empty', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
      const result = getSkillEvalBaseInjection(makeConfig());
      expect(result).toBeDefined();
    });
  });

  describe('error path tests', () => {
    it('throws when env vars are set but config is undefined', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
      expect(() => getSkillEvalBaseInjection(undefined)).toThrow(
        /agentsUrl/i,
      );
    });

    it('throws when env vars are set but agentsUrl is empty string', () => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
      expect(() =>
        getSkillEvalBaseInjection(makeConfig({ agentsUrl: '' })),
      ).toThrow(/agentsUrl/i);
    });
  });

  describe('shape validation tests', () => {
    beforeEach(() => {
      process.env.EVAL_SKILL_BASE_APP_ID = VALID_APP_ID;
      process.env.EVAL_SKILL_BASE_PREVIEW_URL = VALID_PREVIEW_URL;
      process.env.EVAL_SKILL_BASE_RESET_COMMIT = VALID_RESET_COMMIT;
    });

    it('injection.existingApp carries the env var values', () => {
      const result = getSkillEvalBaseInjection(makeConfig())!;
      expect(result.injection.existingApp).toEqual({
        appId: VALID_APP_ID,
        previewUrl: VALID_PREVIEW_URL,
      });
    });

    it('injection.resetCommit carries EVAL_SKILL_BASE_RESET_COMMIT', () => {
      const result = getSkillEvalBaseInjection(makeConfig())!;
      expect(result.injection.resetCommit).toBe(VALID_RESET_COMMIT);
    });

    it('injection.seededSummary.summaryText is non-empty', () => {
      const result = getSkillEvalBaseInjection(makeConfig())!;
      expect(result.injection.seededSummary?.summaryText.length).toBeGreaterThan(0);
    });

    it('injection.seededSummary.messageCount is a finite positive number', () => {
      const result = getSkillEvalBaseInjection(makeConfig())!;
      const count = result.injection.seededSummary?.messageCount;
      expect(count).toBeDefined();
      expect(Number.isFinite(count)).toBe(true);
      expect(count!).toBeGreaterThan(0);
    });

    it('injection.seededSummary.originalTokenCount is a finite positive number', () => {
      const result = getSkillEvalBaseInjection(makeConfig())!;
      const tokens = result.injection.seededSummary?.originalTokenCount;
      expect(tokens).toBeDefined();
      expect(Number.isFinite(tokens)).toBe(true);
      expect(tokens!).toBeGreaterThan(0);
    });

    it('injection.seededSummary.priorTurns alternates sender/content pairs', () => {
      const result = getSkillEvalBaseInjection(makeConfig())!;
      const turns = result.injection.seededSummary?.priorTurns ?? [];
      expect(turns.length).toBeGreaterThanOrEqual(2);
      expect(turns.length % 2).toBe(0);
      for (let i = 0; i < turns.length; i++) {
        expect(turns[i].content.length).toBeGreaterThan(0);
        expect(['user', 'agent']).toContain(turns[i].sender);
        if (i > 0) {
          expect(turns[i].sender).not.toBe(turns[i - 1].sender);
        }
      }
    });

    it('returns a seedSummary function', () => {
      const result = getSkillEvalBaseInjection(makeConfig())!;
      expect(typeof result.seedSummary).toBe('function');
    });
  });
});

describe('SKILL_EVAL_BASE_SUMMARY_TEXT', () => {
  it('is a non-empty string', () => {
    expect(typeof SKILL_EVAL_BASE_SUMMARY_TEXT).toBe('string');
    expect(SKILL_EVAL_BASE_SUMMARY_TEXT.length).toBeGreaterThan(0);
  });

  it('contains ## State section', () => {
    expect(SKILL_EVAL_BASE_SUMMARY_TEXT).toContain('## State');
  });

  it('contains ## Completed section', () => {
    expect(SKILL_EVAL_BASE_SUMMARY_TEXT).toContain('## Completed');
  });

  it('contains ## Decisions section', () => {
    expect(SKILL_EVAL_BASE_SUMMARY_TEXT).toContain('## Decisions');
  });

  it('contains ## Pending section', () => {
    expect(SKILL_EVAL_BASE_SUMMARY_TEXT).toContain('## Pending');
  });
});

describe('SKILL_EVAL_BASE_PRIOR_TURNS', () => {
  it('has exactly 6 entries', () => {
    expect(SKILL_EVAL_BASE_PRIOR_TURNS).toHaveLength(6);
  });

  it('alternates user and agent senders starting with user', () => {
    expect(SKILL_EVAL_BASE_PRIOR_TURNS[0].sender).toBe('user');
    for (let i = 1; i < SKILL_EVAL_BASE_PRIOR_TURNS.length; i++) {
      expect(SKILL_EVAL_BASE_PRIOR_TURNS[i].sender).not.toBe(
        SKILL_EVAL_BASE_PRIOR_TURNS[i - 1].sender,
      );
    }
  });

  it('all entries have non-empty content', () => {
    for (const turn of SKILL_EVAL_BASE_PRIOR_TURNS) {
      expect(turn.content.length).toBeGreaterThan(0);
    }
  });
});
