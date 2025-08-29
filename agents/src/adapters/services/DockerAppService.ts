import { getDatabase } from '../../database/connection.js';
import { DockerContainerManager } from './docker-container-manager.js';
import type { App } from '../../database/schema.js';
import type { 
  IAppAdapter, 
  ServerInfo, 
  ServerStatus, 
  AppAdapterCapabilities 
} from '../interfaces/IAppAdapter.js';
import { ContainerError } from '../interfaces/common.js';
import { Logger } from '../../logging/index.js';

/**
 * Docker-based App Deployment Service
 * 
 * Handles ONLY deployment operations using Docker containers.
 * App creation, database operations, and file system setup are handled by AppRepository.
 */
export class DockerAppService implements IAppAdapter {
  private db = getDatabase();
  private dockerManager = new DockerContainerManager();
  private initialized = false;
  private logger = Logger.create({ service: 'docker-app-service' });

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.logger.info('docker.service.init.begin', {});
    
    try {
      await this.dockerManager.initialize();
      this.initialized = true;
      this.logger.info('docker.service.init.success', {});
    } catch (error) {
      this.logger.error('docker.service.init.failure', {
        error: (error as Error).message
      });
      throw new ContainerError(`Docker initialization failed: ${(error as Error).message}`);
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
      const app = this.getAppFromDb(appId);
      if (!app) {
        throw new ContainerError(`App not found: ${appId}`, appId);
      }
      
      this.logger.info('docker.container.start.begin', {
        appId
      });
      const containerInfo = await this.dockerManager.createAndStartContainer(appId, app.path, app.port);
      return !!containerInfo;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('docker.container.start.failure', {
        appId,
        error: errorMessage
      });
      throw new ContainerError(`Failed to start app: ${errorMessage}`, appId);
    }
  }

  async stopApp(appId: string): Promise<boolean> {
    try {
      this.logger.info('docker.container.stop.begin', {
        appId
      });
      return await this.dockerManager.stopContainer(appId);
    } catch (error) {
      this.logger.error('docker.container.stop.failure', {
        appId,
        error: (error as Error).message
      });
      throw new ContainerError(`Failed to stop app: ${(error as Error).message}`, appId);
    }
  }

  async restartApp(appId: string): Promise<boolean> {
    try {
      this.logger.info('docker.container.restart.begin', {
        appId
      });
      return await this.dockerManager.restartAppContainer(appId);
    } catch (error) {
      this.logger.error('docker.container.restart.failure', {
        appId,
        error: (error as Error).message
      });
      throw new ContainerError(`Failed to restart app: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Status and Information
   */

  async getRunningServers(): Promise<ServerInfo[]> {
    try {
      const dockerServers = await this.dockerManager.getRunningServers();
      return dockerServers.map(server => ({
        appId: server.appId,
        port: server.port,
        url: server.url,
        status: server.status as any,
        type: 'docker',
        metadata: {
          containerId: server.containerId,
          imageName: server.imageName
        }
      }));
    } catch (error) {
      this.logger.error('docker.servers.list.failure', {
        error: (error as Error).message
      });
      return [];
    }
  }

  async stopAllServers(): Promise<number> {
    try {
      this.logger.info('docker.servers.stopAll.begin', {});
      return await this.dockerManager.stopAllServers();
    } catch (error) {
      this.logger.error('docker.servers.stopAll.failure', {
        error: (error as Error).message
      });
      return 0;
    }
  }

  async getAppStatus(appId: string): Promise<ServerStatus> {
    try {
      const containerStatus = await this.dockerManager.getAppContainerStatus(appId);
      if (!containerStatus) {
        return {
          status: 'not_found',
          message: 'No container record found for this app'
        };
      }
      
      return {
        status: containerStatus.status as any,
        message: containerStatus.message || `Container is ${containerStatus.status}`,
        metadata: {
          containerId: containerStatus.containerId,
          port: containerStatus.port
        }
      };
    } catch (error) {
      this.logger.error('docker.container.status.failure', {
        appId,
        error: (error as Error).message
      });
      return {
        status: 'error',
        message: (error as Error).message
      };
    }
  }

  /**
   * Advanced Operations (Optional)
   */

  async getAppLogs(appId: string): Promise<string[]> {
    try {
      const logs = await this.dockerManager.getAppContainerLogs(appId);
      return logs.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
      this.logger.error('docker.container.logs.failure', {
        appId,
        error: (error as Error).message
      });
      throw new ContainerError(`Failed to get app logs: ${(error as Error).message}`, appId);
    }
  }

  async rebuildApp(appId: string): Promise<boolean> {
    try {
      const app = this.getAppFromDb(appId);
      if (!app) {
        throw new ContainerError(`App not found: ${appId}`, appId);
      }
      
      this.logger.info('docker.container.rebuild.begin', {
        appId
      });
      const containerInfo = await this.dockerManager.rebuildAndStartContainer(appId, app.path, app.port);
      return !!containerInfo;
    } catch (error) {
      this.logger.error('docker.container.rebuild.failure', {
        appId,
        error: (error as Error).message
      });
      throw new ContainerError(`Failed to rebuild app: ${(error as Error).message}`, appId);
    }
  }

  async cleanupOrphans(): Promise<{ message: string; cleaned: number }> {
    try {
      const cleanedCount = await this.dockerManager.forceCleanupOrphans();
      return {
        message: `Docker orphan cleanup completed. Cleaned ${cleanedCount} orphaned containers`,
        cleaned: cleanedCount
      };
    } catch (error) {
      this.logger.error('docker.cleanup.orphan.failure', {
        error: (error as Error).message
      });
      throw new ContainerError(`Cleanup failed: ${(error as Error).message}`);
    }
  }

  async removeApp(appId: string): Promise<boolean> {
    try {
      this.logger.info('docker.container.remove.begin', {
        appId
      });
      const removed = await this.dockerManager.removeContainer(appId);
      if (removed) {
        this.logger.info('docker.container.remove.success', {
          appId
        });
      } else {
        this.logger.warn('docker.container.remove.notFound', {
          appId
        });
      }
      return removed;
    } catch (error) {
      this.logger.error('docker.container.remove.failure', {
        appId,
        error: (error as Error).message
      });
      throw new ContainerError(`Failed to remove Docker artifacts: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Cleanup
   */

  async cleanup(): Promise<void> {
    try {
      // DockerContainerManager handles its own cleanup internally
      this.logger.info('docker.service.cleanup.success', {});
    } catch (error) {
      this.logger.error('docker.service.cleanup.failure', {
        error: (error as Error).message
      });
    }
  }

  /**
   * Helper Methods
   */

  private getAppFromDb(appId: string): App | null {
    const stmt = this.db.prepare('SELECT * FROM apps WHERE id = ?');
    const result = stmt.get(appId) as any;
    
    if (!result) return null;
    
    return {
      id: result.id,
      name: result.name,
      path: result.path,
      port: result.port,
      initialPrompt: result.initial_prompt,
      templateVersion: result.template_version,
      status: result.status,
      createdAt: new Date(result.created_at),
      updatedAt: new Date(result.updated_at)
    };
  }
}