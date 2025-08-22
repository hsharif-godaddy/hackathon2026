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

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🔄 Initializing Docker Deployment Service...');
    
    try {
      await this.dockerManager.initialize();
      this.initialized = true;
      console.log('✅ Docker Deployment Service initialization completed');
    } catch (error) {
      console.error('❌ Docker Deployment Service initialization failed:', error);
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
      
      console.log(`🚀 Starting Docker container for app ${appId}...`);
      const containerInfo = await this.dockerManager.createAndStartContainer(appId, app.path, app.port);
      return !!containerInfo;
    } catch (error) {
      console.error(`❌ Failed to start app ${appId}:`, error);
      throw new ContainerError(`Failed to start app: ${(error as Error).message}`, appId);
    }
  }

  async stopApp(appId: string): Promise<boolean> {
    try {
      console.log(`🛑 Stopping Docker container for app ${appId}...`);
      return await this.dockerManager.stopContainer(appId);
    } catch (error) {
      console.error(`❌ Failed to stop app ${appId}:`, error);
      throw new ContainerError(`Failed to stop app: ${(error as Error).message}`, appId);
    }
  }

  async restartApp(appId: string): Promise<boolean> {
    try {
      console.log(`🔄 Restarting Docker container for app ${appId}...`);
      return await this.dockerManager.restartAppContainer(appId);
    } catch (error) {
      console.error(`❌ Failed to restart app ${appId}:`, error);
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
      console.error('❌ Failed to get running servers:', error);
      return [];
    }
  }

  async stopAllServers(): Promise<number> {
    try {
      console.log('🐳 Stopping all Docker containers...');
      return await this.dockerManager.stopAllServers();
    } catch (error) {
      console.error('❌ Failed to stop all Docker containers:', error);
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
      console.error(`❌ Failed to get app status for ${appId}:`, error);
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
      console.error(`❌ Failed to get logs for app ${appId}:`, error);
      throw new ContainerError(`Failed to get app logs: ${(error as Error).message}`, appId);
    }
  }

  async rebuildApp(appId: string): Promise<boolean> {
    try {
      const app = this.getAppFromDb(appId);
      if (!app) {
        throw new ContainerError(`App not found: ${appId}`, appId);
      }
      
      console.log(`🔄 Rebuilding Docker container for app ${appId}...`);
      const containerInfo = await this.dockerManager.rebuildAndStartContainer(appId, app.path, app.port);
      return !!containerInfo;
    } catch (error) {
      console.error(`❌ Failed to rebuild app ${appId}:`, error);
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
      console.error('❌ Failed to cleanup orphans:', error);
      throw new ContainerError(`Cleanup failed: ${(error as Error).message}`);
    }
  }

  async removeApp(appId: string): Promise<boolean> {
    try {
      console.log(`🗑️ Removing Docker container and image for app ${appId}...`);
      const removed = await this.dockerManager.removeContainer(appId);
      if (removed) {
        console.log(`✅ Docker artifacts removed for app ${appId}`);
      } else {
        console.warn(`⚠️ No Docker artifacts found to remove for app ${appId}`);
      }
      return removed;
    } catch (error) {
      console.error(`❌ Failed to remove Docker artifacts for app ${appId}:`, error);
      throw new ContainerError(`Failed to remove Docker artifacts: ${(error as Error).message}`, appId);
    }
  }

  /**
   * Cleanup
   */

  async cleanup(): Promise<void> {
    try {
      // DockerContainerManager handles its own cleanup internally
      console.log('✅ Docker Deployment Service cleanup completed');
    } catch (error) {
      console.error('❌ Docker Deployment Service cleanup failed:', error);
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