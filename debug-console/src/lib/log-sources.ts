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

interface LogSourceRegistry {
  [sourceId: string]: LogSourceConfig;
}

// Field mapping for Airo Agents (has app_id directly)
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
const airoAppFieldMapping: FieldMapping = {
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
const controlPlaneFieldMapping: FieldMapping = {
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

function getESConfigForSource(sourceId: string): LogSourceConfig | null {
  const env = process.env;
  const envName = env.ENVIRONMENT_NAME || 'dev';
  const isTestEnv = envName !== 'prod';

  const sources: LogSourceRegistry = {
    'airo-agents': {
      id: 'airo-agents',
      name: 'Agent App',
      description: 'Logs from the Airo Agents service',
      backendType: 'elasticsearch',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-agents-dev' : 'airo-agents-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAgentsFieldMapping
    },
    'airo-app': {
      id: 'airo-app',
      name: 'UI Client App',
      description: 'Logs from the Airo App Builder application',
      backendType: 'elasticsearch',
      endpoint: env.AIRO_BUILDER_ES_ENDPOINT || '',
      apiKey: env.AIRO_BUILDER_ES_API_KEY || '',
      index: 'logs-*',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAppFieldMapping
    },
    'airo-preview': {
      id: 'airo-preview',
      name: 'Preview App',
      description: 'Logs from the preview application containers',
      backendType: 'elasticsearch',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-preview-application-dev' : 'airo-preview-application-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoContainerFieldMapping
    },
    'airo-publish': {
      id: 'airo-publish',
      name: 'Publish App',
      description: 'Logs from the published application containers',
      backendType: 'elasticsearch',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-publish-application-dev' : 'airo-publish-application-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoContainerFieldMapping
    },
    'control_plane': {
      id: 'control_plane',
      name: 'Control Plane',
      description: 'Logs from the hosting service',
      backendType: 'elasticsearch',
      endpoint: env.CONTROL_PLANE_ES_ENDPOINT || '',
      apiKey: env.CONTROL_PLANE_ES_API_KEY || '',
      index: isTestEnv ? 'pagely-mgmt-worker-hosting-activity-dev,pagely-mgmt-worker-airo-activity-dev' : 'pagely-mgmt-worker-hosting-activity-prod,pagely-mgmt-worker-airo-activity-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: controlPlaneFieldMapping
    }
  };

  return sources[sourceId] || null;
}

/**
 * Build Loki labels for a specific source based on actual Loki structure
 * Returns null for unknown sources to prevent scanning all Loki streams
 */
function buildLokiLabelsForSource(sourceId: string, envName: string): Record<string, string> | null {
  const env = envName === 'prod' ? 'prod' : 'dev';  // Map test/dev → dev

  const labels: Record<string, Record<string, string>> = {
    'airo-agents': {
      job: 'airo-agents',
      env: env
    },
    'airo-preview': {
      job: 'airo-preview-application',
      env: env
    },
    'airo-publish': {
      job: 'airo-publish-application',
      env: env
    }
  };

  return labels[sourceId] || null;
}

/**
 * Get Loki config for a specific source
 */
function getLokiConfigForSource(sourceId: string): LogSourceConfig | null {
  const env = process.env;
  const envName = env.ENVIRONMENT_NAME || 'dev';

  const lokiEndpoint = env.LOKI_ENDPOINT || '';
  const lokiApiKey = env.LOKI_API_KEY || '';

  if (!lokiEndpoint) {
    console.warn('[log-sources] LOKI_ENDPOINT not configured for source:', sourceId);
    return null;
  }

  // Get base metadata for this source
  const baseConfig = getESConfigForSource(sourceId);
  if (!baseConfig) {
    return null;
  }

  // Get Loki labels for this source
  const lokiLabels = buildLokiLabelsForSource(sourceId, envName);
  if (!lokiLabels) {
    console.warn('[log-sources] Unknown Loki source ID:', sourceId, '- not mapped in buildLokiLabelsForSource');
    return null;
  }

  return {
    id: baseConfig.id,
    name: baseConfig.name,
    description: baseConfig.description,
    backendType: 'loki',
    lokiEndpoint,
    lokiApiKey,
    lokiLabels,
    environment: envName === 'prod' ? 'prod' : 'dev',
    fieldMapping: baseConfig.fieldMapping
  };
}

// Default log sources used by app-context summary + error-details aggregation
// when the caller does not pass an explicit `sources` query param. Keep in
// sync with the source IDs registered in `getESConfigForSource`.
export const DEFAULT_SUMMARY_SOURCE_IDS: readonly string[] = [
  'airo-agents',
  'airo-app',
  'airo-preview',
  'airo-publish',
  'control_plane',
];

export function getLogSourceConfig(sourceId: string): LogSourceConfig | null {
  // Check if this source should use Loki
  const lokiEnabledSources = (process.env.LOKI_ENABLED_SOURCES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (lokiEnabledSources.includes(sourceId)) {
    return getLokiConfigForSource(sourceId);
  }

  return getESConfigForSource(sourceId);
}

export function getAllLogSources(): LogSourceConfig[] {
  const env = process.env;
  const envName = env.ENVIRONMENT_NAME || 'dev';
  const isTestEnv = envName !== 'prod';

  return [
    {
      id: 'airo-agents',
      name: 'Agent App',
      description: 'Logs from the Airo Agents service',
      backendType: 'elasticsearch',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-agents-dev' : 'airo-agents-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAgentsFieldMapping
    },
    {
      id: 'airo-preview',
      name: 'Preview App',
      description: 'Logs from the preview application containers',
      backendType: 'elasticsearch',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-preview-application-dev' : 'airo-preview-application-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoContainerFieldMapping
    },
    {
      id: 'airo-publish',
      name: 'Publish App',
      description: 'Logs from the published application containers',
      backendType: 'elasticsearch',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-publish-application-dev' : 'airo-publish-application-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoContainerFieldMapping
    },
    {
      id: 'airo-app',
      name: 'UI Client App',
      description: 'Logs from the Airo App Builder application',
      backendType: 'elasticsearch',
      endpoint: env.AIRO_BUILDER_ES_ENDPOINT || '',
      apiKey: env.AIRO_BUILDER_ES_API_KEY || '',
      index: 'logs-*',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAppFieldMapping
    },
    {
      id: 'control_plane',
      name: 'Control Plane',
      description: 'Logs from the hosting service',
      backendType: 'elasticsearch',
      endpoint: env.CONTROL_PLANE_ES_ENDPOINT || '',
      apiKey: env.CONTROL_PLANE_ES_API_KEY || '',
      index: isTestEnv ? 'pagely-mgmt-worker-hosting-activity-dev,pagely-mgmt-worker-airo-activity-dev' : 'pagely-mgmt-worker-hosting-activity-prod,pagely-mgmt-worker-airo-activity-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: controlPlaneFieldMapping
    }
  ];
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
