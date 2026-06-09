import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

// ── SDK boundary helpers ──────────────────────────────────────────────────────
// DynamoDBDocumentClient returns `Record<string, any>` (unmarshalled native JS values).
// These helpers narrow to `Record<string, unknown>` at the boundary, forcing consumers
// to validate with typeof checks before using values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asItems(items: Record<string, any>[] | undefined): Record<string, unknown>[] {
  return (items ?? []) as Record<string, unknown>[];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asKey(key: Record<string, any> | undefined): Record<string, unknown> | undefined {
  return key as Record<string, unknown> | undefined;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asItem(item: Record<string, any> | undefined): Record<string, unknown> | null {
  return (item ?? null) as Record<string, unknown> | null;
}

function formatNotFoundContext(config: DynamoConfig): string {
  return (
    `DynamoDB resource not found. Check region/table names.\n` +
    `region=${config.region}\n` +
    `scenarios.table=${config.scenarios.table} (pk=${config.scenarios.pkName})\n` +
    `simulations.table=${config.simulations.table} ` +
    `(pk=${config.simulations.pkName}, status=${config.simulations.statusName}, ` +
    `agentId=${config.simulations.agentIdName})\n` +
    `evaluations.table=${config.evaluations.table} (gsi=${config.evaluations.gsi1Name}, gsiPk=${config.evaluations.gsi1PkName})`
  );
}

function wrapAwsError(err: unknown, config: DynamoConfig): Error {
  const e = (typeof err === 'object' && err !== null) ? err as Record<string, unknown> : undefined;
  const name = String(e?.['name'] ?? e?.['__type'] ?? 'UnknownAwsError');
  const msg = String(e?.['message'] ?? err);
  if (name.includes('ResourceNotFoundException')) {
    return new Error(`${formatNotFoundContext(config)}\n\nAWS error: ${msg}`);
  }
  return new Error(`AWS error (${name}): ${msg}`);
}

export interface DynamoConfig {
  region: string;
  scenarios: {
    table: string;
    pkName: string;
  };
  simulations: {
    table: string;
    agentId: string;
    agentIdName: string;
    completedAtName: string;
    scenarioIdName: string;
    pkName: string;
    statusName: string;
  };
  evaluations: {
    table: string;
    gsi1Name: string;
    gsi1PkName: string;
  };
}

export interface DynamoKey {
  pk: string;
  sk?: string;
}

async function paginateQuery(
  doc: DynamoDBDocumentClient,
  params: {
    TableName: string;
    IndexName?: string;
    KeyConditionExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, unknown>;
  },
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  for (;;) {
    const res = await doc.send(
      new QueryCommand({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    if (res.Items) {
      items.push(...asItems(res.Items));
    }
    if (!res.LastEvaluatedKey) break;
    lastEvaluatedKey = asKey(res.LastEvaluatedKey);
  }
  return items;
}

export async function getSimulation(
  config: DynamoConfig,
  simulationId: string,
): Promise<Record<string, unknown> | null> {
  const client = new DynamoDBClient({ region: config.region });
  const doc = DynamoDBDocumentClient.from(client);

  try {
    try {
      const res = await doc.send(
        new GetCommand({
          TableName: config.simulations.table,
          Key: {
            [config.simulations.pkName]: simulationId,
          },
        }),
      );
      if (!res.Item) return null;
      return asItem(res.Item);
    } catch (err) {
      throw wrapAwsError(err, config);
    }
  } finally {
    await client.destroy();
  }
}

export async function getScenario(
  config: DynamoConfig,
  scenarioId: string,
): Promise<Record<string, unknown> | null> {
  const client = new DynamoDBClient({ region: config.region });
  const doc = DynamoDBDocumentClient.from(client);

  try {
    try {
      const res = await doc.send(
        new GetCommand({
          TableName: config.scenarios.table,
          Key: {
            [config.scenarios.pkName]: scenarioId,
          },
        }),
      );
      if (!res.Item) return null;
      return asItem(res.Item);
    } catch (err) {
      throw wrapAwsError(err, config);
    }
  } finally {
    await client.destroy();
  }
}

export async function listEvaluationsForSimulation(
  config: DynamoConfig,
  simulationId: string,
): Promise<Array<Record<string, unknown>>> {
  const client = new DynamoDBClient({ region: config.region });
  const doc = DynamoDBDocumentClient.from(client);

  try {
    try {
      return await paginateQuery(doc, {
        TableName: config.evaluations.table,
        IndexName: config.evaluations.gsi1Name,
        KeyConditionExpression: '#sid = :sid',
        ExpressionAttributeNames: { '#sid': config.evaluations.gsi1PkName },
        ExpressionAttributeValues: { ':sid': simulationId },
      });
    } catch (err) {
      throw wrapAwsError(err, config);
    }
  } finally {
    await client.destroy();
  }
}

export async function resolveScenarioIdsForKeys(
  config: DynamoConfig,
  keys: string[],
): Promise<string[]> {
  const wanted = Array.from(new Set(keys.map((k) => k.trim()).filter(Boolean)));
  if (!wanted.length) return [];

  const client = new DynamoDBClient({ region: config.region });
  const doc = DynamoDBDocumentClient.from(client);

  try {
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
      const res = await doc.send(
        new ScanCommand({
          TableName: config.scenarios.table,
          FilterExpression: `#key IN (${placeholders.join(',')})`,
          ExpressionAttributeNames: {
            '#key': 'key',
            '#pk': config.scenarios.pkName,
          },
          ExpressionAttributeValues: values,
          ProjectionExpression: '#pk,#key',
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: 1_000,
        }),
      );

      for (const item of asItems(res.Items)) {
        const keyRaw = item['key'];
        const pkRaw = item[config.scenarios.pkName];
        if (typeof keyRaw === 'string' && typeof pkRaw === 'string') {
          found.set(keyRaw, pkRaw);
        }
      }

      if (found.size >= wanted.length) break;
      if (!res.LastEvaluatedKey) break;
      lastEvaluatedKey = asKey(res.LastEvaluatedKey);
    }

    const missing = wanted.filter((k) => !found.has(k));
    if (missing.length) {
      throw new Error(
        `Could not resolve scenarioIds for suite scenario keys. Missing keys: ${missing.join(', ')}. ` +
          `Expected attribute name 'key' in table '${config.scenarios.table}'.`,
      );
    }

    return wanted.map((k) => found.get(k)!).filter(Boolean);
  } catch (err) {
    throw wrapAwsError(err, config);
  } finally {
    await client.destroy();
  }
}

export async function discoverSuccessfulSimulationIds(
  config: DynamoConfig,
  options: {
    scenarioIds?: string[];
    statuses: string[];
    limit: number;
    sinceIso: string;
    timeFields: string[];
  },
): Promise<string[]> {
  const client = new DynamoDBClient({ region: config.region });
  const doc = DynamoDBDocumentClient.from(client);

  const extractMs = function extractMs(item: Record<string, unknown>, fields: string[]): number | null {
    for (const f of fields) {
      const v = item[f];
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v < 10_000_000_000 ? v * 1000 : v;
      }
      if (typeof v === 'string' && v.trim()) {
        const parsed = Date.parse(v);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
    return null;
  };

  try {
    const out: string[] = [];
    const allowedScenarioIds =
      options.scenarioIds && options.scenarioIds.length
        ? new Set(options.scenarioIds.map((s) => s.trim()).filter(Boolean))
        : null;
    const maxPerScenario =
      allowedScenarioIds && allowedScenarioIds.size
        ? Math.max(1, Math.ceil(options.limit / allowedScenarioIds.size))
        : 1;
    const perScenarioCounts = new Map<string, number>();
    const seenScenarioIds = allowedScenarioIds ? null : new Set<string>();
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    const statuses = options.statuses.filter((s) => s.trim());
    if (!statuses.length) return out;

    const statusPlaceholders: string[] = [];
    const statusValues: Record<string, unknown> = {};
    for (let i = 0; i < statuses.length; i++) {
      const key = `:s${i}`;
      statusValues[key] = statuses[i]!;
      statusPlaceholders.push(key);
    }

    // Fast path: server-side time filter via completedAt (same pattern Synthia uses).
    // This avoids client-side timestamp parsing.
    lastEvaluatedKey = undefined;
    try {
      const scenarioPlaceholders: string[] = [];
      const scenarioValues: Record<string, unknown> = {};
      if (allowedScenarioIds) {
        let i = 0;
        for (const sid of allowedScenarioIds) {
          const key = `:sc${i}`;
          scenarioValues[key] = sid;
          scenarioPlaceholders.push(key);
          i++;
        }
      }
      for (;;) {
        const res = await doc.send(
          new ScanCommand({
            TableName: config.simulations.table,
            FilterExpression:
              `#agentId = :agentId AND ` +
              `#status IN (${statusPlaceholders.join(',')}) AND ` +
              `attribute_exists(#completedAt) AND #completedAt >= :since` +
              (scenarioPlaceholders.length
                ? ` AND #scenarioId IN (${scenarioPlaceholders.join(',')})`
                : ''),
            ExpressionAttributeNames: {
              '#agentId': config.simulations.agentIdName,
              '#completedAt': config.simulations.completedAtName,
              '#pk': config.simulations.pkName,
              '#scenarioId': config.simulations.scenarioIdName,
              '#status': config.simulations.statusName,
            },
            ExpressionAttributeValues: {
              ':agentId': config.simulations.agentId,
              ':since': options.sinceIso,
              ...scenarioValues,
              ...statusValues,
            },
            ProjectionExpression: '#pk,#scenarioId,#status,#agentId,#completedAt',
            ExclusiveStartKey: lastEvaluatedKey,
            Limit: 1_000,
          }),
        );

        for (const item of asItems(res.Items)) {
          const scenarioIdRaw = item[config.simulations.scenarioIdName];
          const scenarioId =
            typeof scenarioIdRaw === 'string' && scenarioIdRaw.trim()
              ? scenarioIdRaw.trim()
              : null;
          if (allowedScenarioIds && (!scenarioId || !allowedScenarioIds.has(scenarioId))) continue;
          if (!scenarioId) continue;
          if (seenScenarioIds && seenScenarioIds.has(scenarioId)) continue;
          if (allowedScenarioIds) {
            const count = perScenarioCounts.get(scenarioId) ?? 0;
            if (count >= maxPerScenario) continue;
          }
          const id = item[config.simulations.pkName];
          if (typeof id === 'string' && id.trim()) {
            out.push(id.trim());
            if (seenScenarioIds) seenScenarioIds.add(scenarioId);
            if (allowedScenarioIds) {
              perScenarioCounts.set(scenarioId, (perScenarioCounts.get(scenarioId) ?? 0) + 1);
            }
          }
          if (out.length >= options.limit) return out;
        }

        if (!res.LastEvaluatedKey) return out;
        lastEvaluatedKey = asKey(res.LastEvaluatedKey);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('ValidationException')) {
        throw wrapAwsError(err, config);
      }
      // eslint-disable-next-line no-console
      console.warn(`${new Date().toISOString()} dynamo.fastPath.fallback`, JSON.stringify({ error: msg }));
    }

    // Fallback path: Scan with agentId/status only, filter by time client-side.
    lastEvaluatedKey = undefined;
    const sinceMs = Date.parse(options.sinceIso);
    const timeFields = Array.from(
      new Set(
        options.timeFields
          .map((f) => f.trim())
          .filter(Boolean)
          .filter((f) => f !== config.simulations.pkName)
          .filter((f) => f !== config.simulations.statusName)
          .filter((f) => f !== config.simulations.agentIdName),
      ),
    );

    const ExpressionAttributeNames: Record<string, string> = {
      '#status': config.simulations.statusName,
      '#pk': config.simulations.pkName,
      '#agentId': config.simulations.agentIdName,
      '#scenarioId': config.simulations.scenarioIdName,
    };
    const timePlaceholders: string[] = [];
    for (let i = 0; i < timeFields.length; i++) {
      const nameKey = `#t${i}`;
      ExpressionAttributeNames[nameKey] = timeFields[i]!;
      timePlaceholders.push(nameKey);
    }

    for (;;) {
      const res = await doc.send(
        new ScanCommand({
          TableName: config.simulations.table,
          FilterExpression: `#agentId = :agentId AND #status IN (${statusPlaceholders.join(',')})`,
          ExpressionAttributeNames,
          ExpressionAttributeValues: {
            ':agentId': config.simulations.agentId,
            ...statusValues,
          },
          ProjectionExpression: ['#pk', '#scenarioId', '#status', '#agentId', ...timePlaceholders].join(','),
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: 1_000,
        }),
      );
      for (const item of asItems(res.Items)) {
        const ms = extractMs(item, timeFields);
        if (ms === null || ms < sinceMs) continue;
        const scenarioIdRaw = item[config.simulations.scenarioIdName];
        const scenarioId =
          typeof scenarioIdRaw === 'string' && scenarioIdRaw.trim()
            ? scenarioIdRaw.trim()
            : null;
        if (allowedScenarioIds && (!scenarioId || !allowedScenarioIds.has(scenarioId))) continue;
        if (!scenarioId) continue;
        if (seenScenarioIds && seenScenarioIds.has(scenarioId)) continue;
        if (allowedScenarioIds) {
          const count = perScenarioCounts.get(scenarioId) ?? 0;
          if (count >= maxPerScenario) continue;
        }
        const id = item[config.simulations.pkName];
        if (typeof id === 'string' && id.trim()) {
          out.push(id.trim());
          if (seenScenarioIds) seenScenarioIds.add(scenarioId);
          if (allowedScenarioIds) {
            perScenarioCounts.set(scenarioId, (perScenarioCounts.get(scenarioId) ?? 0) + 1);
          }
        }
        if (out.length >= options.limit) return out;
      }
      if (!res.LastEvaluatedKey) return out;
      lastEvaluatedKey = asKey(res.LastEvaluatedKey);
    }
  } finally {
    await client.destroy();
  }
}

