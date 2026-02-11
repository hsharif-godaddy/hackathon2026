import { DockerDeploymentAdapter } from './docker-adapter';
import { logger } from '../request-context';

/**
 * Deployment adapter singleton with lazy initialization
 * Always uses Docker deployment adapter for local development
 * Production deployments use mhp-core Nomad templates (external)
 */
let _deploymentAdapter: DockerDeploymentAdapter | null = null;

function getDeploymentAdapterInstance(): DockerDeploymentAdapter {
  if (!_deploymentAdapter) {
    logger.info('deployment.adapter.init', { message: 'Using Docker deployment adapter' });
    _deploymentAdapter = new DockerDeploymentAdapter();
  }
  return _deploymentAdapter;
}

/**
 * Deployment adapter singleton instance
 * Lazily initialized on first access
 */
export const deploymentAdapter = new Proxy({} as DockerDeploymentAdapter, {
  get(_target, prop) {
    return getDeploymentAdapterInstance()[prop as keyof DockerDeploymentAdapter];
  }
});

/**
 * Get deployment environment info
 */
export function getDeploymentEnvironmentInfo() {
  logger.info('deployment.environment.info', {
    mode: 'docker',
    nodeEnv: process.env.NODE_ENV,
    agentsServiceUrl: process.env.AGENTS_SERVICE_URL || 'http://localhost:4000 (default)'
  });

  return {
    mode: 'docker' as const,
    hasAgentsService: true,
    hasProductionInfrastructure: false,
    hasDatabase: true,
    recommendedForDevelopment: true
  };
}
