import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

export interface EvaluatorSpec {
  evaluatorId: string;
  name?: string;
  description?: string;
  type: 'llm' | string;
  scoreType?: 'NUMERIC' | 'CATEGORICAL' | string;
  scoreName?: string;
  scoreConfig?: {
    min?: number;
    max?: number;
  };
  needsVision?: boolean;
  staticContext?: string;
  template: string;
  llmConfig?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  criteriaSchemaFile?: string;
}

interface RawEvaluatorYaml {
  evaluatorId?: string;
  name?: string;
  description?: string;
  type?: string;
  scoreType?: string;
  scoreName?: string;
  scoreConfig?: {
    min?: number;
    max?: number;
  };
  needsVision?: boolean;
  staticContext?: string;
  template?: string;
  llmConfig?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  criteriaSchemaFile?: string;
}

export async function loadEvaluatorSpec(evaluatorPath: string): Promise<EvaluatorSpec> {
  const raw: string = await readFile(evaluatorPath, 'utf8');
  const doc = yaml.load(raw) as RawEvaluatorYaml | null;

  if (!doc || typeof doc !== 'object') {
    throw new Error(`Invalid evaluator YAML (could not parse): ${evaluatorPath}`);
  }

  const evaluatorId: string | undefined = doc.evaluatorId?.trim();
  if (!evaluatorId) {
    throw new Error(`Invalid evaluator YAML (missing evaluatorId): ${evaluatorPath}`);
  }

  const template: string | undefined = typeof doc.template === 'string' ? doc.template.trim() : undefined;
  if (!template) {
    throw new Error(`Invalid evaluator YAML (missing template): ${evaluatorPath}`);
  }

  const scoreConfig = doc.scoreConfig;
  const llmConfig = doc.llmConfig;

  const resolvedCriteriaSchemaFile: string | undefined = doc.criteriaSchemaFile
    ? path.resolve(path.dirname(evaluatorPath), doc.criteriaSchemaFile)
    : undefined;

  return {
    evaluatorId,
    name: doc.name,
    description: doc.description,
    type: (doc.type ?? 'llm') as string,
    scoreType: doc.scoreType,
    scoreName: doc.scoreName,
    scoreConfig: {
      min: Number.isFinite(scoreConfig?.min) ? scoreConfig!.min : undefined,
      max: Number.isFinite(scoreConfig?.max) ? scoreConfig!.max : undefined,
    },
    needsVision: doc.needsVision,
    staticContext: doc.staticContext,
    template,
    llmConfig: {
      model: llmConfig?.model,
      temperature: Number.isFinite(llmConfig?.temperature) ? llmConfig!.temperature : undefined,
      maxTokens: Number.isFinite(llmConfig?.maxTokens) ? llmConfig!.maxTokens : undefined,
    },
    criteriaSchemaFile: resolvedCriteriaSchemaFile,
  };
}
