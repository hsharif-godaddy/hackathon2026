import { agentFetch } from '@/lib/agent-fetch';
import { resolveAgentsBaseUrl } from '@/lib/agents-base-url';
import type {
  IControlPlaneAdapter,
  SecretOperations,
  SecretUpdate,
  SiteInfo,
} from '@/lib/control-plane/types';
import { logger } from '@/lib/request-context';

interface PublishEnvResponse {
  vars: Record<string, string>;
  updateIfCurrentValueIn?: Record<string, string[]>;
}

export type PublishEnvPromotionOutcome =
  | { status: 'skipped_unavailable' }
  | { status: 'skipped_empty' }
  | { status: 'noop'; skipped: number }
  | { status: 'promoted'; added: number; updated: number; skipped: number };

export interface PromotePublishEnvParams {
  appId: string;
  site: SiteInfo;
  adapter: IControlPlaneAdapter;
  jwt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`Invalid publish env response: ${label} must be an object`);
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid publish env response: invalid env key ${key}`);
    }
    if (typeof rawValue !== 'string') {
      throw new Error(`Invalid publish env response: ${label}.${key} must be a string`);
    }
    result[key] = rawValue;
  }
  return result;
}

function parseUpdatePolicy(value: unknown): Record<string, string[]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error('Invalid publish env response: updateIfCurrentValueIn must be an object');
  }

  const result: Record<string, string[]> = {};
  for (const [key, rawValues] of Object.entries(value)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid publish env response: invalid update policy key ${key}`);
    }
    if (!Array.isArray(rawValues) || rawValues.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Invalid publish env response: updateIfCurrentValueIn.${key} must be a string array`);
    }
    result[key] = rawValues;
  }
  return result;
}

function parsePublishEnvResponse(value: unknown): PublishEnvResponse {
  if (!isRecord(value)) {
    throw new Error('Invalid publish env response: body must be an object');
  }

  return {
    vars: parseStringRecord(value.vars ?? {}, 'vars'),
    updateIfCurrentValueIn: parseUpdatePolicy(value.updateIfCurrentValueIn),
  };
}

async function fetchAgentPublishEnv(appId: string, site: SiteInfo): Promise<PublishEnvResponse | null> {
  const url = `${resolveAgentsBaseUrl(site)}/apps/${appId}/publish-env`;
  let response: Response;
  try {
    response = await agentFetch(url, { siteId: appId });
  } catch (error) {
    logger.error('api.secrets.sync.publish-env.request_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (response.status === 404) {
    logger.warn('api.secrets.sync.publish-env.unavailable', {
      appId,
      status: response.status,
      message: 'Agents publish-env route not available; continuing without env promotion',
    });
    return null;
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    logger.error('api.secrets.sync.publish-env.read_failed', {
      appId,
      status: response.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!response.ok) {
    logger.error('api.secrets.sync.publish-env.fetch_failed', {
      appId,
      status: response.status,
      error: responseText,
    });
    return null;
  }

  try {
    return parsePublishEnvResponse(JSON.parse(responseText));
  } catch (error) {
    logger.error('api.secrets.sync.publish-env.parse_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function canUpdateManagedValue(
  currentValue: string | undefined,
  allowedCurrentValues: string[] | undefined
): boolean {
  return typeof currentValue === 'string'
    && Array.isArray(allowedCurrentValues)
    && allowedCurrentValues.includes(currentValue);
}

export async function promotePublishEnvToPreviewSecrets({
  appId,
  site,
  adapter,
  jwt,
}: PromotePublishEnvParams): Promise<PublishEnvPromotionOutcome> {
  const publishEnv = await fetchAgentPublishEnv(appId, site);
  if (!publishEnv) return { status: 'skipped_unavailable' };
  if (Object.keys(publishEnv.vars).length === 0) return { status: 'skipped_empty' };

  const previewSecrets = await adapter.getSecrets(appId, 'preview', jwt);
  const sharedSecretNames = new Set(
    previewSecrets.secrets
      .filter((secret) => secret.variants.includes('preview') && secret.variants.includes('publish'))
      .map((secret) => secret.name)
  );
  const systemManagedSecretNames = new Set(
    previewSecrets.secrets
      .filter((secret) => secret.systemManaged)
      .map((secret) => secret.name)
  );
  const currentValuesByName = new Map(
    previewSecrets.secrets.map((secret) => [secret.name, secret.value])
  );

  const additions: SecretUpdate[] = [];
  const updates: SecretUpdate[] = [];
  let skipped = 0;

  for (const [name, value] of Object.entries(publishEnv.vars)) {
    if (sharedSecretNames.has(name)) {
      skipped += 1;
      continue;
    }

    if (systemManagedSecretNames.has(name)) {
      skipped += 1;
      continue;
    }

    if (!currentValuesByName.has(name)) {
      additions.push({ name, value });
      continue;
    }

    const currentValue = currentValuesByName.get(name);
    if (currentValue === value) {
      skipped += 1;
      continue;
    }

    if (canUpdateManagedValue(currentValue, publishEnv.updateIfCurrentValueIn?.[name])) {
      updates.push({ name, value });
      continue;
    }

    skipped += 1;
  }

  const operations: SecretOperations = { additions, updates };
  if (additions.length === 0 && updates.length === 0) {
    logger.info('api.secrets.sync.publish-env.noop', {
      appId,
      skipped,
    });
    return { status: 'noop', skipped };
  }

  await adapter.updateSecrets(appId, 'preview', operations, jwt);
  logger.info('api.secrets.sync.publish-env.promoted', {
    appId,
    added: additions.length,
    updated: updates.length,
    skipped,
  });

  return {
    status: 'promoted',
    added: additions.length,
    updated: updates.length,
    skipped,
  };
}
