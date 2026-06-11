export interface FieldMapping {
  // Field used to filter by app ID (e.g., 'app_id', 'labels.app_id', 'site_id')
  appIdField: string | null;
  // Query type:
  //   'term' - exact match on keyword field (fastest, recommended for exact IDs)
  //   'prefix' - prefix match, no leading wildcard (efficient for prefix patterns)
  appIdQueryType: 'term' | 'prefix';
  // Field for timestamp
  timestampField: string;
  // Field for log level
  levelField: string;
  // Field for log level keyword (for aggregations)
  levelKeywordField: string;
  // Field for message content
  messageField: string;
  // Aggregatable keyword form of messageField. Leave undefined when the index
  // stores `messageField` as plain text without a `.keyword` subfield — callers
  // must then aggregate error messages in memory.
  messageKeywordField?: string;
  // Field for event type
  eventField: string;
  // Field for event keyword (for aggregations)
  eventKeywordField: string;
  // Field for service name
  serviceField: string;
  // Field for service keyword (for aggregations)
  serviceKeywordField: string;
  // Additional display fields specific to this source
  displayFields: Array<{
    key: string;
    label: string;
    path: string; // JSONPath-like accessor e.g., 'data.userId' or 'kubernetes.pod.name'
  }>;
  logLevelFieldMap?: Record<string, string>;
}

export interface LogSourceConfig {
  id: string;
  name: string;
  description: string;
  backendType: 'elasticsearch' | 'loki';
  // Elasticsearch fields (optional, used when backendType === 'elasticsearch')
  endpoint?: string;
  apiKey?: string;
  index?: string;
  // Loki fields (optional, used when backendType === 'loki')
  lokiEndpoint?: string;
  lokiApiKey?: string;
  lokiLabels?: Record<string, string>;
  // Common fields
  environment?: 'dev' | 'prod' | 'test';
  fieldMapping: FieldMapping;
}

// Field mapping for Airo Agents.
// Nomad job names follow patterns: 'app-{appId}-preview/publish' (legacy) or 'airo-{appId}' (unified)
const airoAgentsFieldMapping: FieldMapping = {
  appIdField: 'com.hashicorp.nomad.job_name',
  appIdQueryType: 'prefix',
  timestampField: '@timestamp',
  levelField: 'level',
  levelKeywordField: 'level',
  messageField: 'message',
  messageKeywordField: 'message.keyword',
  eventField: 'event',
  eventKeywordField: 'event.keyword',
  serviceField: 'service',
  serviceKeywordField: 'service.keyword',
  displayFields: [
    { key: 'conversationId', label: 'Conversation', path: 'conversationId' },
    { key: 'threadId', label: 'Thread', path: 'threadId' }
  ],
  logLevelFieldMap: {
    'debug': 'debug',
    'info': 'info',
    'warn': 'warn',
    'error': 'error',
    'fatal': 'fatal'
  }
};

// Field mapping for Preview/Publish containers (has app_id as direct field)
// These use structured JSON logging with uppercase level values (INFO, WARN, ERROR)
const airoContainerFieldMapping: FieldMapping = {
  appIdField: 'app_id',
  appIdQueryType: 'term',
  timestampField: '@timestamp',
  levelField: 'level',
  levelKeywordField: 'level.keyword',
  messageField: 'msg',
  messageKeywordField: 'msg.keyword',
  eventField: 'type',
  eventKeywordField: 'type.keyword',
  serviceField: 'com.hashicorp.nomad.task_name',
  serviceKeywordField: 'com.hashicorp.nomad.task_name',
  displayFields: [
    { key: 'appId', label: 'App ID', path: 'app_id' },
    { key: 'path', label: 'Path', path: 'path' },
    { key: 'status', label: 'Status', path: 'status' }
  ],
  logLevelFieldMap: {
    'debug': 'DEBUG',
    'info': 'INFO',
    'warn': 'WARN',
    'error': 'ERROR',
    'fatal': 'FATAL'
  }
};

// Field mapping for Airo App Builder
export const airoAppFieldMapping: FieldMapping = {
  appIdField: 'data.appId',
  appIdQueryType: 'term',
  timestampField: '@timestamp',
  levelField: 'level',
  levelKeywordField: 'level',
  messageField: 'message',
  eventField: 'event',
  eventKeywordField: 'event',
  serviceField: 'KATANA_APP',
  serviceKeywordField: 'KATANA_APP',
  displayFields: [
    { key: 'traceId', label: 'Trace ID', path: 'trace.id' },
    { key: 'customerId', label: 'Customer ID', path: 'data.customerId' },
    { key: 'appId', label: 'App ID', path: 'data.appId' }
  ],
  logLevelFieldMap: {
    'debug': 'debug',
    'info': 'info',
    'warn': 'warn',
    'error': 'error',
    'fatal': 'fatal'
  }
};

// Field mapping for Control Plane (searches both hosting-activity and airo-activity indices)
// Pipe-separated appIdField matches on either app_id OR appId_str
export const controlPlaneFieldMapping: FieldMapping = {
  appIdField: 'app_id|appId_str',
  appIdQueryType: 'term',
  timestampField: '@timestamp',
  levelField: 'level',
  levelKeywordField: 'log.level.keyword',
  messageField: 'message',
  messageKeywordField: 'message.keyword',
  eventField: 'event',
  eventKeywordField: 'event.keyword',
  serviceField: 'service',
  serviceKeywordField: 'service.keyword',
  displayFields: [
    { key: 'hostname', label: 'Host', path: 'hostname' },
    { key: 'region', label: 'Region', path: 'region' }
  ],
  logLevelFieldMap: {
    'debug': 'DEBUG',
    'info': 'INFO',
    'warn': 'WARN',
    'error': 'ERROR',
    'fatal': 'FATAL'
  }
};

// Sources that are served exclusively by Loki. LOKI_ENDPOINT is a hard
// requirement (missing config is treated as a fatal error at query time so
// operators notice a misconfigured deploy immediately instead of silently
// returning empty log panes). LOKI_API_KEY is optional — unauthenticated
// Loki backends and Grafana proxies with embedded auth both work without it.
const LOKI_SOURCES: Record<string, { name: string; description: string; labels: (env: 'dev' | 'prod') => Record<string, string>; fieldMapping: FieldMapping }> = {
  'airo-agents': {
    name: 'Agent App',
    description: 'Logs from the Airo Agents service',
    labels: (env) => ({ service_name: 'airo-agents', env }),
    fieldMapping: airoAgentsFieldMapping
  },
  'airo-preview': {
    name: 'Preview App',
    description: 'Logs from the preview application containers',
    labels: (env) => ({ service_name: 'airo-preview-application', env }),
    fieldMapping: airoContainerFieldMapping
  },
  'airo-publish': {
    name: 'Publish App',
    description: 'Logs from the published application containers',
    labels: (env) => ({ service_name: 'airo-publish-application', env }),
    fieldMapping: airoContainerFieldMapping
  },
  // Lifecycle / supporting services — separate Nomad services that share the
  // same `airo-<appId>` job_id and emit during container init or background
  // tasks. Surface them as their own entries so engineers can drill into a
  // specific phase, and include them in the merged "All sources" query so
  // early-lifecycle logs aren't filtered out at the service_name regex.
  'airo-pre-start': {
    name: 'Pre-start',
    description: 'Container init logs that fire before the main service comes up',
    labels: (env) => ({ service_name: 'airo-pre-start', env }),
    fieldMapping: airoContainerFieldMapping
  },
  'airo-db-init': {
    name: 'DB Init',
    description: 'One-shot database initialization service',
    labels: (env) => ({ service_name: 'airo-db-init', env }),
    fieldMapping: airoContainerFieldMapping
  },
  'airo-secrets-worker': {
    name: 'Secrets Worker',
    description: 'Cluster-shared secrets sync worker (job_id is shared, not per-app)',
    labels: (env) => ({ service_name: 'airo-secrets-worker', env }),
    fieldMapping: airoContainerFieldMapping
  }
};

// Sources that remain on Elasticsearch. Each uses its own dedicated ES cluster
// (Katana for `airo-app`, hosting for `control_plane`) so they stay on ES until
// those upstreams publish to Loki as well.
const ES_SOURCES: Record<string, {
  name: string;
  description: string;
  endpointEnv: string;
  apiKeyEnv: string;
  index: (env: 'dev' | 'prod') => string;
  fieldMapping: FieldMapping;
}> = {
  'airo-app': {
    name: 'UI Client App',
    description: 'Logs from the Airo App Builder application',
    endpointEnv: 'AIRO_BUILDER_ES_ENDPOINT',
    apiKeyEnv: 'AIRO_BUILDER_ES_API_KEY',
    index: () => 'logs-*',
    fieldMapping: airoAppFieldMapping
  },
  'control_plane': {
    name: 'Control Plane',
    description: 'Logs from the hosting service',
    endpointEnv: 'CONTROL_PLANE_ES_ENDPOINT',
    apiKeyEnv: 'CONTROL_PLANE_ES_API_KEY',
    index: (env) =>
      env === 'prod'
        ? 'pagely-mgmt-worker-hosting-activity-prod,pagely-mgmt-worker-airo-activity-prod'
        : 'pagely-mgmt-worker-hosting-activity-dev,pagely-mgmt-worker-airo-activity-dev',
    fieldMapping: controlPlaneFieldMapping
  }
};

function resolvedEnv(): 'dev' | 'prod' {
  return (process.env.ENVIRONMENT_NAME || 'dev') === 'prod' ? 'prod' : 'dev';
}

/**
 * Read LOKI_ENDPOINT, throwing a consistent error when it's missing. Shared
 * between log-sources (Logs tab) and the analytics scheduler so operators
 * see the same message regardless of which surface fails first.
 *
 * @param context short description of the caller for the error message
 *   (e.g. `log source 'airo-agents'` or `the analytics scheduler`).
 */
export function requireLokiEndpoint(context: string): string {
  const endpoint = process.env.LOKI_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      `LOKI_ENDPOINT is required for ${context}. ` +
      `Set LOKI_ENDPOINT (and LOKI_API_KEY for authenticated backends) in the environment.`
    );
  }
  return endpoint;
}

/**
 * Build a Loki-backed LogSourceConfig. Throws if LOKI_ENDPOINT is not set so
 * operators can't silently ship a deploy where airo-agents/preview/publish
 * have no log backend.
 */
function buildLokiConfig(sourceId: string): LogSourceConfig {
  const entry = LOKI_SOURCES[sourceId];
  if (!entry) {
    throw new Error(`Unknown Loki log source: ${sourceId}`);
  }

  const lokiEndpoint = requireLokiEndpoint(`log source '${sourceId}'`);

  const env = resolvedEnv();
  return {
    id: sourceId,
    name: entry.name,
    description: entry.description,
    backendType: 'loki',
    lokiEndpoint,
    lokiApiKey: process.env.LOKI_API_KEY || '',
    lokiLabels: entry.labels(env),
    environment: env,
    fieldMapping: entry.fieldMapping
  };
}

// Track which missing-endpoint warnings we've already emitted so a hot path
// (e.g. log poll loop) doesn't spam the same message every request.
const warnedMissingEsEndpoint = new Set<string>();

function buildESConfig(sourceId: string): LogSourceConfig | null {
  // `Object.hasOwn` (not bracket-then-truthy) so prototype keys like
  // `toString`/`__proto__` arriving via a `?source=...` query param don't
  // resolve to inherited methods and trigger a 500 (`entry.index is not a
  // function`). This is the active guard — do not weaken without replacing.
  if (!Object.hasOwn(ES_SOURCES, sourceId)) return null;
  const entry = ES_SOURCES[sourceId];

  const endpoint = process.env[entry.endpointEnv] || '';
  const apiKey = process.env[entry.apiKeyEnv] || '';
  // Surface a missing endpoint loudly. ES sources are legacy and fall back
  // gracefully (callers downstream of streamConfiguredLogSources record the
  // resulting fetch failure), but a blank endpoint reaching the network layer
  // produces an opaque ERR_INVALID_URL — warn here so operators get the
  // actionable env var name instead of debugging a generic URL parse error.
  if (!endpoint && !warnedMissingEsEndpoint.has(sourceId)) {
    warnedMissingEsEndpoint.add(sourceId);
    console.warn(
      `[log-sources] ES source '${sourceId}' is configured but ${entry.endpointEnv} is not set. ` +
      `Queries against this source will fail with a network/URL error until the env var is provided.`
    );
  }

  const env = resolvedEnv();
  return {
    id: sourceId,
    name: entry.name,
    description: entry.description,
    backendType: 'elasticsearch',
    endpoint,
    apiKey,
    index: entry.index(env),
    environment: env,
    fieldMapping: entry.fieldMapping
  };
}

// Default log sources used by app-context summary + error-details aggregation
// when the caller does not pass an explicit `sources` query param. Derived
// from the source tables so new entries are picked up automatically.
export function isLokiLogSource(sourceId: string): boolean {
  return Object.hasOwn(LOKI_SOURCES, sourceId);
}

export const DEFAULT_SUMMARY_SOURCE_IDS: readonly string[] = [
  ...Object.keys(LOKI_SOURCES),
  ...Object.keys(ES_SOURCES),
];

export function getLogSourceConfig(sourceId: string): LogSourceConfig | null {
  // `Object.hasOwn` (not `in`) so prototype keys like `toString`/`__proto__`
  // from a `?source=...` query param don't reach buildLokiConfig and produce
  // a confusing "Unknown Loki log source" throw — return null cleanly instead.
  if (Object.hasOwn(LOKI_SOURCES, sourceId)) {
    return buildLokiConfig(sourceId);
  }
  return buildESConfig(sourceId);
}

export function getAllLogSources(): LogSourceConfig[] {
  const sources: LogSourceConfig[] = [];
  for (const sourceId of Object.keys(LOKI_SOURCES)) {
    sources.push(buildLokiConfig(sourceId));
  }
  for (const sourceId of Object.keys(ES_SOURCES)) {
    const config = buildESConfig(sourceId);
    if (config) sources.push(config);
  }
  return sources;
}

// Helper function to get value from nested path
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current: unknown, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// Helper function to build app ID query clause based on field mapping
export function buildAppIdQuery(
  appId: string,
  fieldMapping: FieldMapping
): Record<string, unknown> | null {
  if (!fieldMapping.appIdField) {
    return null; // This source doesn't support app ID filtering
  }

  // Support pipe-separated fields (e.g. 'app_id|appId_str') — match on any
  const fields = fieldMapping.appIdField.split('|');

  function buildSingleFieldQuery(field: string): Record<string, unknown> {
    if (fieldMapping.appIdQueryType === 'term') {
      return { term: { [field]: appId } };
    }
    if (fieldMapping.appIdQueryType === 'prefix') {
      if (field === 'com.hashicorp.nomad.job_name') {
        return { prefix: { [field]: `airo-${appId}` } };
      }
      return { prefix: { [field]: appId } };
    }
    throw new Error(
      `Unsupported appIdQueryType '${fieldMapping.appIdQueryType}' for field '${field}'. ` +
      `Supported types are 'term' (exact match) or 'prefix' (prefix match).`
    );
  }

  if (fields.length === 1) {
    return buildSingleFieldQuery(fields[0]);
  }

  // Multiple fields: match on any using bool.should
  return {
    bool: {
      should: fields.map(f => buildSingleFieldQuery(f)),
      minimum_should_match: 1
    }
  };
}
