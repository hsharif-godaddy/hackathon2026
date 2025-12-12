import { DockerContainerManager } from '../services/docker-container-manager';
import { DevDatabase } from '../database/DevDatabase';
import { logger } from '../../request-context';
import type {
  IAppAdapter,
  ServerInfo,
  ServerStatus,
  AppAdapterCapabilities
} from './interfaces/IAppAdapter';
import { ContainerError } from './interfaces/common';

/**
 * Docker Container-based App Deployment Service
 *
 * Handles ONLY deployment operations using Docker containers.
 * App creation, database operations, and file system setup are handled by DevEnvironmentManager.
 */
export class DockerAppService implements IAppAdapter {
  private devDb: DevDatabase;
  private containerManager: DockerContainerManager;
  private initialized = false;

  constructor(devDb: DevDatabase) {
    this.devDb = devDb;
    this.containerManager = DockerContainerManager.getInstance(devDb);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.containerManager.initialize();
      this.initialized = true;
    } catch (error) {
      logger.error('docker_app_service.init.failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new ContainerError(`Docker service initialization failed: ${(error as Error).message}`);
    }
  }

  getCapabilities(): AppAdapterCapabilities {
    return {
      supportsContainerOperations: true,
      supportsProcessOperations: false,
      supportsRebuild: true,
      supportsLogs: true
    };
  }

  /**
   * Deployment Operations
   */

  async startApp(appId: string): Promise<boolean> {
    try {
      const devApp = this.devDb.findDevAppById(appId);
      if (!devApp) {
        throw new ContainerError(`Dev app not found: ${appId}`, appId);
      }

      // Check if container already exists
      const existingContainer = await this.containerManager.getContainerStatus(appId);
      if (existingContainer && existingContainer.status === 'running') {
        return true;
      }

      return true;
    } catch (error) {
      logger.error('docker_app_service.start.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new ContainerError(`Failed to start app: ${(error as Error).message}`, appId);
    }
  }

  async stopApp(appId: string): Promise<boolean> {
    try {
      return await this.containerManager.stopContainer(appId);
    } catch (error) {
      logger.error('docker_app_service.stop.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new ContainerError(`Failed to stop app: ${(error as Error).message}`, appId);
    }
  }

  async restartApp(appId: string): Promise<boolean> {
    try {
      return await this.containerManager.restartContainer(appId);
    } catch (error) {
      logger.error('docker_app_service', `❌ Failed to restart container for app ${appId}`, { data: { appId }, error: error as Error });
      throw new ContainerError(`Failed to restart app: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Status and Information
   */

  async getRunningServers(): Promise<ServerInfo[]> {
    const containerServers = await this.containerManager.getRunningServers();

    return containerServers.map(server => ({
      appId: server.appId,
      port: server.port,
      url: server.url,
      status: 'running' as const,
      type: 'docker' as const,
      metadata: {
        containerId: server.containerId,
        imageName: server.imageName
      }
    }));
  }

  async stopAllServers(): Promise<number> {
    try {
      return await this.containerManager.stopAllServers();
    } catch (error) {
      logger.error('docker_app_service.stop-all.failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new ContainerError(`Failed to stop all servers: ${(error as Error).message}`);
    }
  }

  async getAppStatus(appId: string): Promise<ServerStatus> {
    try {
      const containerStatus = await this.containerManager.getAppContainerStatus(appId);

      if (!containerStatus) {
        return {
          status: 'not_found',
          message: 'No container found for this app'
        };
      }

      // Map container status to server status
      let status: ServerStatus['status'];
      switch (containerStatus.status) {
        case 'running':
          status = 'running';
          break;
        case 'exited':
        case 'dead':
          status = 'stopped';
          break;
        case 'not_found':
          status = 'not_found';
          break;
        case 'container_missing':
          status = 'container_missing';
          break;
        default:
          status = 'error';
      }

      return {
        status,
        message: containerStatus.message || `Container status: ${containerStatus.status}`,
        metadata: {
          containerId: containerStatus.containerId,
          imageName: containerStatus.imageName,
          port: containerStatus.port,
          url: containerStatus.url
        }
      };
    } catch (error) {
      logger.error(`❌ Failed to get container status for app ${appId}:`, error);
      return {
        status: 'error',
        message: (error as Error).message
      };
    }
  }

  async getAppLogs(appId: string): Promise<string[]> {
    try {
      const logs = await this.containerManager.getAppContainerLogs(appId, 100);
      return logs.split('\n').filter(line => line.trim());
    } catch (error) {
      logger.error(`❌ Failed to get container logs for app ${appId}:`, error);
      throw new ContainerError(`Failed to get app logs: ${(error as Error).message}`, appId);
    }
  }

  async cleanupOrphans(): Promise<{ message: string; cleaned: number }> {
    try {
      logger.info('🧹 Cleaning up orphaned Docker containers...');
      const cleaned = await this.containerManager.forceCleanupOrphans();

      return {
        message: `Docker orphan cleanup completed. Cleaned ${cleaned} orphaned containers`,
        cleaned
      };
    } catch (error) {
      logger.error('❌ Failed to cleanup orphaned containers:', error);
      throw new ContainerError(`Cleanup failed: ${(error as Error).message}`);
    }
  }

  async removeApp(appId: string): Promise<boolean> {
    try {
      logger.info(`🐳 Removing Docker artifacts for app ${appId}...`);

      // Stop and remove container
      const removed = await this.containerManager.removeContainer(appId);

      if (removed) {
        logger.info(`✅ Docker artifacts removed for app ${appId}`);
      } else {
        logger.info(`ℹ️ No Docker artifacts found for app ${appId}`);
      }

      return removed;
    } catch (error) {
      logger.error(`❌ Failed to remove Docker artifacts for app ${appId}:`, error);
      throw new ContainerError(`Failed to remove Docker artifacts: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Advanced Operations (Docker-specific)
   */

  async rebuildApp(appId: string): Promise<boolean> {
    try {
      const devApp = this.devDb.findDevAppById(appId);
      if (!devApp) {
        throw new ContainerError(`Dev app not found: ${appId}`, appId);
      }

      logger.info(`🏗️ Rebuilding container for app ${appId}...`);

      const containerInfo = await this.containerManager.rebuildAndStartContainer(
        appId,
        devApp.appPath,
        devApp.port
      );

      if (containerInfo) {
        logger.info(`✅ Container rebuilt for app ${appId}: ${containerInfo.containerId}`);
        return true;
      } else {
        logger.warn(`⚠️ Container rebuild skipped for app ${appId} (possibly already in progress)`);
        return false;
      }
    } catch (error) {
      logger.error(`❌ Failed to rebuild container for app ${appId}:`, error);
      throw new ContainerError(`Failed to rebuild app: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Cleanup
   */

  async cleanup(): Promise<void> {
    try {
      logger.info('🧹 Stopping all Docker containers...');

      const stoppedCount = await this.containerManager.stopAllServers();

      logger.info(`✅ Docker Container Deployment Service cleanup completed: ${stoppedCount} containers stopped`);
    } catch (error) {
      logger.error('❌ Docker Container Deployment Service cleanup failed:', error);
    }
  }

  /**
   * Get Docker-specific information
   */
  getContainerManager(): DockerContainerManager {
    return this.containerManager;
  }

  /**
   * Get dev-supervisor connection path (TCP URL or Unix socket path)
   */
  getConnectionPath(appId: string): string | null {
    return this.containerManager.getConnectionPath(appId);
  }
}
