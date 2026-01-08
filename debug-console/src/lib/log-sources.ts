export interface LogSourceConfig {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  apiKey: string;
  index: string;
  environment?: 'dev' | 'prod' | 'test';
}

export interface LogSourceRegistry {
  [sourceId: string]: LogSourceConfig;
}

function getESConfigForSource(sourceId: string): LogSourceConfig | null {
  const env = process.env;
  const envName = env.ENVIRONMENT_NAME || 'dev';
  const isTestEnv = envName === 'test' || envName === 'dev';

  const sources: LogSourceRegistry = {
    'airo-agents': {
      id: 'airo-agents',
      name: 'Airo Agents',
      description: 'Logs from the Airo Agents service',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-agents-dev' : 'airo-agents-prod',
      environment: isTestEnv ? 'dev' : 'prod'
    },
    'airo-app': {
      id: 'airo-app',
      name: 'Airo App Builder',
      description: 'Logs from the Airo App Builder application',
      endpoint: env.AIRO_BUILDER_ES_ENDPOINT || '',
      apiKey: env.AIRO_BUILDER_ES_API_KEY || '',
      index: 'logs-*',
      environment: isTestEnv ? 'dev' : 'prod'
    },
    'control_plane': {
      id: 'control_plane',
      name: 'Control Plane',
      description: 'Logs from the control plane',
      endpoint: env.CONTROL_PLANE_ES_ENDPOINT || '',
      apiKey: env.CONTROL_PLANE_ES_API_KEY || '',
      index: 'pagely-mgmt-worker-hosting-*',
      environment: isTestEnv ? 'dev' : 'prod'
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
      name: 'Airo Agents',
      description: 'Logs from the Airo Agents service',
      endpoint: env.PIONEER_ES_ENDPOINT || '',
      apiKey: env.PIONEER_ES_API_KEY || '',
      index: isTestEnv ? 'airo-agents-dev' : 'airo-agents-prod',
      environment: isTestEnv ? 'dev' : 'prod'
    },
    {
      id: 'airo-app',
      name: 'Airo App Builder',
      description: 'Logs from the Airo App Builder application',
      endpoint: env.AIRO_BUILDER_ES_ENDPOINT || '',
      apiKey: env.AIRO_BUILDER_ES_API_KEY || '',
      index: 'logs-*',
      environment: isTestEnv ? 'dev' : 'prod'
    },
    {
      id: 'control_plane',
      name: 'Control Plane',
      description: 'Logs from the control plane',
      endpoint: env.CONTROL_PLANE_ES_ENDPOINT || '',
      apiKey: env.CONTROL_PLANE_ES_API_KEY || '',
      index: 'pagely-mgmt-worker-hosting-*',
      environment: isTestEnv ? 'dev' : 'prod'
    }
  ];
}
