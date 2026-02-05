export interface FieldMapping {
  // Field used to filter by app ID (e.g., 'app_id', 'labels.app_id', 'site_id')
  appIdField: string | null;
  // Query type: 'match' for analyzed fields, 'term' for exact match
  appIdQueryType: 'match' | 'term';
  // Field for timestamp
  timestampField: string;
  // Field for log level
  levelField: string;
  // Field for log level keyword (for aggregations)
  levelKeywordField: string;
  // Field for message content
  messageField: string;
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
}

export interface LogSourceConfig {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  apiKey: string;
  index: string;
  environment?: 'dev' | 'prod' | 'test';
  fieldMapping: FieldMapping;
}

export interface LogSourceRegistry {
  [sourceId: string]: LogSourceConfig;
}

// Field mapping for Airo Agents (has app_id directly)
const airoAgentsFieldMapping: FieldMapping = {
  appIdField: 'app_id',
  appIdQueryType: 'match',
  timestampField: '@timestamp',
  levelField: 'level',
  levelKeywordField: 'level.keyword',
  messageField: 'message',
  eventField: 'event',
  eventKeywordField: 'event.keyword',
  serviceField: 'service',
  serviceKeywordField: 'service.keyword',
  displayFields: [
    { key: 'conversationId', label: 'Conversation', path: 'conversationId' },
    { key: 'threadId', label: 'Thread', path: 'threadId' }
  ]
};

// Field mapping for Airo App Builder
const airoAppFieldMapping: FieldMapping = {
  appIdField: 'data.appId',
  appIdQueryType: 'match',
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
  ]
};

// Field mapping for Control Plane (filters by app_id)
const controlPlaneFieldMapping: FieldMapping = {
  appIdField: 'app_id', // Apply app ID filter
  appIdQueryType: 'match',
  timestampField: '@timestamp',
  levelField: 'level',
  levelKeywordField: 'level.keyword',
  messageField: 'message',
  eventField: 'event',
  eventKeywordField: 'event.keyword',
  serviceField: 'service',
  serviceKeywordField: 'service.keyword',
  displayFields: [
    { key: 'hostname', label: 'Host', path: 'hostname' },
    { key: 'region', label: 'Region', path: 'region' }
  ]
};

function getESConfigForSource(sourceId: string): LogSourceConfig | null {
  const env = process.env;
  const envName = env.ENVIRONMENT_NAME || 'dev';
  const isTestEnv = envName === 'test' || envName === 'dev';

  const sources: LogSourceRegistry = {
    'airo-agents': {
      id: 'airo-agents',
      name: 'Agent Logs',
      description: 'Logs from the Airo Agents service',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-agents-dev' : 'airo-agents-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAgentsFieldMapping
    },
    'airo-app': {
      id: 'airo-app',
      name: 'UI Logs',
      description: 'Logs from the Airo App Builder application',
      endpoint: env.AIRO_BUILDER_ES_ENDPOINT || '',
      apiKey: env.AIRO_BUILDER_ES_API_KEY || '',
      index: 'logs-*',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAppFieldMapping
    },
    'control_plane': {
      id: 'control_plane',
      name: 'Hosting Logs',
      description: 'Logs from the hosting service',
      endpoint: env.CONTROL_PLANE_ES_ENDPOINT || '',
      apiKey: env.CONTROL_PLANE_ES_API_KEY || '',
      index: 'pagely-mgmt-worker-hosting-*',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: controlPlaneFieldMapping
    }
  };

  return sources[sourceId] || null;
}

export function getLogSourceConfig(sourceId: string): LogSourceConfig | null {
  return getESConfigForSource(sourceId);
}

export function getAllLogSources(): LogSourceConfig[] {
  const env = process.env;
  const envName = env.ENVIRONMENT_NAME || 'dev';
  const isTestEnv = envName === 'test' || envName === 'dev';

  return [
    {
      id: 'airo-agents',
      name: 'Agent Logs',
      description: 'Logs from the Airo Agents service',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-agents-dev' : 'airo-agents-prod',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAgentsFieldMapping
    },
    {
      id: 'airo-app',
      name: 'UI Logs',
      description: 'Logs from the Airo App Builder application',
      endpoint: env.AIRO_BUILDER_ES_ENDPOINT || '',
      apiKey: env.AIRO_BUILDER_ES_API_KEY || '',
      index: 'logs-*',
      environment: isTestEnv ? 'dev' : 'prod',
      fieldMapping: airoAppFieldMapping
    },
    {
      id: 'control_plane',
      name: 'Hosting Logs',
      description: 'Logs from the hosting service',
      endpoint: env.CONTROL_PLANE_ES_ENDPOINT || '',
      apiKey: env.CONTROL_PLANE_ES_API_KEY || '',
      index: 'pagely-mgmt-worker-hosting-*',
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

  if (fieldMapping.appIdQueryType === 'term') {
    return { term: { [fieldMapping.appIdField]: appId } };
  }

  return { match: { [fieldMapping.appIdField]: appId } };
}
