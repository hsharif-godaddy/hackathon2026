import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import path from 'node:path';

import { loadEnv } from './env.js';
import { loadSuiteScenarioKeys, readArg } from './utils.js';
import { asItems, asKey } from './dynamo.js';

async function resolveScenarioIdsForKeys(params: {
  doc: DynamoDBDocumentClient;
  scenariosTable: string;
  scenariosPkName: string;
  keys: string[];
}): Promise<string[]> {
  const wanted = Array.from(new Set(params.keys.map((k) => k.trim()).filter(Boolean)));
  if (!wanted.length) return [];

  const placeholders: string[] = [];
  const values: Record<string, unknown> = {};
  for (let i = 0; i < wanted.length; i++) {
    const p = `:k${i}`;
    placeholders.push(p);
    values[p] = wanted[i]!;
  }

  const found = new Map<string, string>();
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  for (;;) {
    const res = await params.doc.send(
      new ScanCommand({
        TableName: params.scenariosTable,
        FilterExpression: `#key IN (${placeholders.join(',')})`,
        ExpressionAttributeNames: {
          '#key': 'key',
          '#pk': params.scenariosPkName,
        },
        ExpressionAttributeValues: values,
        ProjectionExpression: '#pk,#key',
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 1_000,
      }),
    );

    for (const item of asItems(res.Items)) {
      const keyRaw = item['key'];
      const pkRaw = item[params.scenariosPkName];
      if (typeof keyRaw === 'string' && typeof pkRaw === 'string') {
        found.set(keyRaw, pkRaw);
      }
    }

    if (found.size >= wanted.length) break;
    if (!res.LastEvaluatedKey) break;
    lastEvaluatedKey = asKey(res.LastEvaluatedKey);
  }

  return wanted.map((k) => found.get(k)!).filter(Boolean);
}

async function scanCount(params: {
  doc: DynamoDBDocumentClient;
  simulationsTable: string;
  agentIdName: string;
  agentId: string;
  statusName: string;
  statuses: string[];
  completedAtName: string;
  sinceIso: string;
  scenarioIdName: string;
  scenarioIds: string[] | null;
}): Promise<number> {
  const statuses = params.statuses.map((s) => s.trim()).filter(Boolean);
  if (!statuses.length) return 0;

  const statusPlaceholders: string[] = [];
  const statusValues: Record<string, unknown> = {};
  for (let i = 0; i < statuses.length; i++) {
    const key = `:s${i}`;
    statusValues[key] = statuses[i]!;
    statusPlaceholders.push(key);
  }

  const scenarioIds = (params.scenarioIds ?? []).map((s) => s.trim()).filter(Boolean);
  const scenarioPlaceholders: string[] = [];
  const scenarioValues: Record<string, unknown> = {};
  for (let i = 0; i < scenarioIds.length; i++) {
    const key = `:sc${i}`;
    scenarioValues[key] = scenarioIds[i]!;
    scenarioPlaceholders.push(key);
  }

  let filter =
    `#agentId = :agentId AND ` +
    `#status IN (${statusPlaceholders.join(',')}) AND ` +
    `attribute_exists(#completedAt) AND #completedAt >= :since` +
    (scenarioPlaceholders.length ? ` AND #scenarioId IN (${scenarioPlaceholders.join(',')})` : '');

  let total = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  for (;;) {
    const res = await params.doc.send(
      new ScanCommand({
        TableName: params.simulationsTable,
        Select: 'COUNT',
        FilterExpression: filter,
        ExpressionAttributeNames: {
          '#agentId': params.agentIdName,
          '#completedAt': params.completedAtName,
          '#scenarioId': params.scenarioIdName,
          '#status': params.statusName,
        },
        ExpressionAttributeValues: {
          ':agentId': params.agentId,
          ':since': params.sinceIso,
          ...scenarioValues,
          ...statusValues,
        },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 1_000,
      }),
    );

    total += res.Count ?? 0;
    if (!res.LastEvaluatedKey) break;
    lastEvaluatedKey = asKey(res.LastEvaluatedKey);
  }

  return total;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const sinceDaysRaw = readArg('--since-days') ?? '5';
  const sinceDays = Number.parseInt(sinceDaysRaw, 10);
  if (!Number.isFinite(sinceDays) || sinceDays <= 0) {
    throw new Error(`Invalid --since-days: "${sinceDaysRaw}"`);
  }

  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const statuses = (readArg('--statuses') ?? 'completed,maxTurns')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const suitePath = path.resolve(process.cwd(), '../goarena/simulation_eval_suite.yaml');
  const suiteKeys = await loadSuiteScenarioKeys(suitePath);

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.dynamodb.region }));
  const suiteScenarioIds = await resolveScenarioIdsForKeys({
    doc,
    scenariosPkName: env.dynamodb.scenarios.pkName,
    scenariosTable: env.dynamodb.scenarios.table,
    keys: suiteKeys,
  });

  const allScenarios = await scanCount({
    doc,
    simulationsTable: env.dynamodb.simulations.table,
    agentIdName: env.dynamodb.simulations.agentIdName,
    agentId: env.dynamodb.simulations.agentId,
    statusName: env.dynamodb.simulations.statusName,
    statuses,
    completedAtName: env.dynamodb.simulations.completedAtName,
    sinceIso,
    scenarioIdName: env.dynamodb.simulations.scenarioIdName,
    scenarioIds: null,
  });

  const suiteScenarios = await scanCount({
    doc,
    simulationsTable: env.dynamodb.simulations.table,
    agentIdName: env.dynamodb.simulations.agentIdName,
    agentId: env.dynamodb.simulations.agentId,
    statusName: env.dynamodb.simulations.statusName,
    statuses,
    completedAtName: env.dynamodb.simulations.completedAtName,
    sinceIso,
    scenarioIdName: env.dynamodb.simulations.scenarioIdName,
    scenarioIds: suiteScenarioIds,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        sinceDays,
        sinceIso,
        agentId: env.dynamodb.simulations.agentId,
        statuses,
        suite: { keys: suiteKeys.length, resolvedScenarioIds: suiteScenarioIds.length },
        counts: { allScenarios, suiteScenarios },
      },
      null,
      2,
    )}\n`,
  );
}

await main();

