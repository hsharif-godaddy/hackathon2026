import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

export interface JudgeEnv {
  gocaas: {
    apiKey: string;
    baseUrl: string;
  };
  judges: {
    /**
     * Diverse judge panel. All judges receive the SAME rubric/instructions (no personas);
     * diversity comes from using distinct model families so that disagreement reflects rubric
     * ambiguity rather than an injected stance/model confound.
     */
    models: string[];
    /**
     * Advisory meta-judge. It records rubric-adherence issues and a recommended score but does
     * NOT decide which judges are valid. Defaults to a different family than the judge majority
     * to avoid a model auditing itself.
     */
    metaModel: string;
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadJudgeEnv(): JudgeEnv {
  loadDotenv({ path: resolve(process.cwd(), '.env') });
  loadDotenv({ path: resolve(process.cwd(), '.env.local'), override: true });

  // Preferred: an explicit, comma-separated diverse panel.
  // Add a third distinct family (e.g. a Gemini id) here once confirmed available on GOCAAS_BASE_URL.
  const explicit = splitCsv(process.env['JUDGE_MODELS']);

  // Back-compat: if JUDGE_MODELS is unset, fall back to the older single-family vars but as a
  // panel of DISTINCT families (no duplicate model — a duplicate at temperature 0 is just one vote).
  const gpt = process.env['JUDGE_MODEL_GPT']?.trim() || 'gpt-5.2';
  const sonnet = process.env['JUDGE_MODEL_SONNET']?.trim() || 'claude-sonnet-4-6';
  const fallback = Array.from(new Set([gpt, sonnet]));

  const models = explicit.length ? explicit : fallback;
  if (!models.length) throw new Error('No judge models configured (set JUDGE_MODELS)');

  // Meta-judge defaults to a family that is NOT the first judge, so the auditor differs from the
  // panel majority. Override with JUDGE_META_MODEL.
  const defaultMeta = models.find((m) => m !== models[0]) ?? models[0]!;
  const meta = process.env['JUDGE_META_MODEL']?.trim() || defaultMeta;

  return {
    gocaas: {
      baseUrl: required('GOCAAS_BASE_URL').replace(/\/+$/, ''),
      apiKey: required('GOCAAS_API_KEY'),
    },
    judges: {
      models,
      metaModel: meta,
    },
  };
}
