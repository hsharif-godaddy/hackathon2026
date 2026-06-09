import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readBool(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean value: "${value}" (expected "true" or "false")`);
}

function readInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value: "${value}"`);
  }
  return parsed;
}

export interface EnvConfig {
  langfuse: {
    baseUrl: string;
    publicKey: string;
    secretKey: string;
  };
  dynamodb: {
    region: string;
    evaluations: {
      gsi1Name: string;
      gsi1PkName: string;
      table: string;
    };
    scenarios: {
      pkName: string;
      table: string;
    };
    simulations: {
      agentId: string;
      agentIdName: string;
      completedAtName: string;
      scenarioIdName: string;
      pkName: string;
      statusName: string;
      timeFields: string[];
      table: string;
    };
  };
  capture: {
    ignoreHttpsErrors: boolean;
    maxRoutes: number;
  };
  logging: {
    level: 'silent' | 'info' | 'debug';
  };
}

export function loadEnv(): EnvConfig {
  // Allow usage both with and without `tsx --env-file=.env`.
  loadDotenv({ path: resolve(process.cwd(), '.env') });
  loadDotenv({ path: resolve(process.cwd(), '.env.local'), override: true });

  return {
    langfuse: {
      publicKey: required('LANGFUSE_PUBLIC_KEY'),
      secretKey: required('LANGFUSE_SECRET_KEY'),
      baseUrl:
        (process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST'])?.replace(/\/$/, '') ??
        'https://agentobser-langfuse.int.godaddy.com',
    },
    dynamodb: {
      region: required('DDB_REGION'),
      scenarios: {
        table: required('SYNTHIA_SCENARIOS_TABLE'),
        pkName: process.env['SYNTHIA_SCENARIOS_PK_NAME']?.trim() || 'scenarioId',
      },
      simulations: {
        table: required('SYNTHIA_SIMULATIONS_TABLE'),
        agentId: required('SYNTHIA_SIMULATIONS_AGENT_ID'),
        agentIdName: process.env['SYNTHIA_SIMULATIONS_AGENT_ID_NAME']?.trim() || 'agentId',
        completedAtName: process.env['SYNTHIA_SIMULATIONS_COMPLETED_AT_NAME']?.trim() || 'completedAt',
        scenarioIdName: process.env['SYNTHIA_SIMULATIONS_SCENARIO_ID_NAME']?.trim() || 'scenarioId',
        pkName: process.env['SYNTHIA_SIMULATIONS_PK_NAME']?.trim() || 'taskId',
        statusName: process.env['SYNTHIA_SIMULATIONS_STATUS_NAME']?.trim() || 'status',
        timeFields: (process.env['SYNTHIA_SIMULATIONS_TIME_FIELDS'] ??
          'completedAt,startedAt,queuedAt,timestamp,createdAt,created_at,completedAtMs,startedAtMs,queuedAtMs')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      evaluations: {
        table: required('SYNTHIA_EVALUATIONS_TABLE'),
        gsi1Name: process.env['SYNTHIA_EVALUATIONS_GSI1_NAME']?.trim() || 'GSI1',
        gsi1PkName: process.env['SYNTHIA_EVALUATIONS_GSI1_PK_NAME']?.trim() || 'simulationId',
      },
    },
    capture: {
      ignoreHttpsErrors: readBool(process.env['CAPTURE_IGNORE_HTTPS_ERRORS']) ?? false,
      maxRoutes: readInt(process.env['CAPTURE_MAX_ROUTES']) ?? 20,
    },
    logging: {
      level:
        process.env['CALIBRATION_LOG_LEVEL'] === 'silent' ||
        process.env['CALIBRATION_LOG_LEVEL'] === 'debug'
          ? process.env['CALIBRATION_LOG_LEVEL']
          : 'info',
    },
  };
}

