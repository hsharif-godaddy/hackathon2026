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
import { DevSupervisorClient, createDevSupervisorClient } from '../../services/DevSupervisorClient.js';

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
  private devSupervisorClients: Map<string, DevSupervisorClient> = new Map(); // Per-app clients

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.logger.info('docker.service.init.begin', {});
    
    try {
      await this.dockerManager.initialize();
      
      // Health monitoring now uses per-app dev-supervisor clients instead of a global service
      this.logger.info('docker.service.health_monitoring.per_app_mode', {});
      
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
      supportsProcessOperations: true, // We support per-app process operations
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
      
      // Automatically configure health monitoring using per-app dev-supervisor client
      if (containerInfo) {
        // Wait for dev-supervisor to be ready before configuring health monitoring
        this.waitForDevSupervisorAndConfigureHealth(appId, app.port).catch(healthError => {
          // Don't fail app start if health monitoring fails  
          this.logger.warn('docker.health_monitoring.config_failure', {
            appId,
            error: (healthError as Error).message
          });
        });
      }
      
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

      // Try process restart via dev-supervisor first if available
      if (this.shouldUseDevSupervisor(appId)) {
        const devSupervisorClient = this.getDevSupervisorClient(appId);
        if (devSupervisorClient) {
          try {
            const restartResult = await devSupervisorClient.restartProcess({ graceful: true });
            if (restartResult) {
              this.logger.info('docker.dev_supervisor.restart.success', {
                appId
              });
              return true;
            }
          } catch (devSupervisorError) {
            this.logger.warn('docker.dev_supervisor.restart.failure', {
              appId,
              error: (devSupervisorError as Error).message
            });
            // Fall through to container restart
          }
        }
      }

      // Fallback to Docker container restart
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
      
      // Get additional process info from dev-supervisor if available
      let processInfo = null;
      if (this.shouldUseDevSupervisor(appId)) {
        processInfo = await this.getDevSupervisorProcessStatus(appId);
      }

      // Get health monitoring status if available using per-app dev-supervisor client
      let healthStatus = null;
      if (this.shouldUseDevSupervisor(appId)) {
        const devSupervisorClient = this.getDevSupervisorClient(appId);
        if (devSupervisorClient) {
          try {
            healthStatus = await devSupervisorClient.getHealthStatus();
          } catch (error) {
            this.logger.debug('docker.health_monitoring.status.failure', {
              appId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
      
      return {
        status: containerStatus.status as any,
        message: containerStatus.message || `Container is ${containerStatus.status}`,
        metadata: {
          containerId: containerStatus.containerId,
          port: containerStatus.port,
          ...(processInfo && {
            processInfo: {
              pid: processInfo.pid,
              state: processInfo.state,
              command: processInfo.command
            }
          }),
          ...(healthStatus && {
            healthMonitoring: {
              status: healthStatus.status,
              message: healthStatus.message,
              last_check: healthStatus.last_check,
              duration: healthStatus.duration,
              consecutive_failures: healthStatus.consecutive_failures
            }
          })
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
      // Try dev-supervisor logs first if available
      if (this.shouldUseDevSupervisor(appId)) {
        const devSupervisorClient = this.getDevSupervisorClient(appId);
        if (devSupervisorClient) {
          try {
            const devSupervisorLogs = await devSupervisorClient.getLogs({ lines: 100 });
            if (devSupervisorLogs.length > 0) {
              this.logger.info('docker.dev_supervisor.logs.retrieved', {
                appId,
                logCount: devSupervisorLogs.length
              });
              return devSupervisorLogs.map(log => `[${log.timestamp}] ${log.source}: ${log.message}`);
            }
          } catch (devSupervisorError) {
            this.logger.warn('docker.dev_supervisor.logs.failure', {
              appId,
              error: (devSupervisorError as Error).message
            });
            // Fall through to Docker logs
          }
        }
      }

      // Fallback to Docker container logs
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
      
      // Clean up the DevSupervisorClient for this app
      if (this.devSupervisorClients.has(appId)) {
        this.devSupervisorClients.delete(appId);
        this.logger.info('docker.service.dev_supervisor.cleaned', {
          appId
        });
      }
      
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
   * Wait for dev-supervisor to be ready and configure health monitoring
   */
  private async waitForDevSupervisorAndConfigureHealth(appId: string, port: number): Promise<void> {
    const maxAttempts = 12; // 12 attempts = up to 60 seconds
    const delay = 5000; // 5 seconds between attempts
    
    this.logger.info('docker.dev_supervisor.wait.begin', {
      appId,
      maxAttempts,
      delayMs: delay
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Wait before each attempt (except the first)
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const devSupervisorClient = this.getDevSupervisorClient(appId);
        if (!devSupervisorClient) {
          this.logger.debug('docker.dev_supervisor.wait.no_client', {
            appId,
            attempt
          });
          continue;
        }

        // Test if the dev-supervisor is responsive by trying to get its info
        await devSupervisorClient.getInfo();
        
        this.logger.info('docker.dev_supervisor.wait.ready', {
          appId,
          attempt,
          duration: (attempt - 1) * delay
        });

        // Now configure health monitoring
        await devSupervisorClient.configureHealthCheck(
          {
            type: 'http',
            url: `http://localhost:${port}/health`,
            interval: '30s',
            timeout: '10s',
            retries: 3,
            start_period: '0s',
            success_threshold: 1,
            failure_threshold: 3
          },
          {
            enabled: true,
            max_restarts: 5,
            restart_window: '5m',
            backoff_multiplier: 2.0,
            max_backoff: '5m',
            initial_delay: '10s'
          }
        );

        this.logger.info('docker.health_monitoring.configured', {
          appId,
          port,
          attempt,
          duration: (attempt - 1) * delay
        });
        
        return; // Success!
        
      } catch (error) {
        this.logger.debug('docker.dev_supervisor.wait.attempt_failed', {
          appId,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        
        if (attempt === maxAttempts) {
          throw new Error(`Dev-supervisor not ready after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  /**
   * Cleanup
   */

  async cleanup(): Promise<void> {
    try {
      // Clean up all DevSupervisor clients
      this.devSupervisorClients.clear();
      
      // DockerContainerManager handles its own cleanup internally
      this.logger.info('docker.service.cleanup.success', {});
    } catch (error) {
      this.logger.error('docker.service.cleanup.failure', {
        error: (error as Error).message
      });
    }
  }

  /**
   * Get the dev-supervisor socket path for a specific app
   */
  getDevSupervisorSocketPath(appId: string): string | null {
    return this.dockerManager.getHostSocketPath(appId);
  }

  /**
   * Helper Methods
   */

  /**
   * Get or create a DevSupervisorClient for a specific app
   */
  private getDevSupervisorClient(appId: string): DevSupervisorClient | null {
    // Check if we already have a client for this app
    if (this.devSupervisorClients.has(appId)) {
      return this.devSupervisorClients.get(appId)!;
    }

    // Get the socket path for this app
    const hostSocketPath = this.dockerManager.getHostSocketPath(appId);
    if (!hostSocketPath) {
      return null;
    }

    // Create new client for this app
    const client = createDevSupervisorClient(hostSocketPath);
    if (client) {
      this.devSupervisorClients.set(appId, client);
      this.logger.info('docker.service.dev_supervisor.created', {
        appId,
        socketPath: hostSocketPath
      });
    }

    return client;
  }

  /**
   * Check if dev-supervisor should be used for this app
   */
  private shouldUseDevSupervisor(appId: string): boolean {
    const client = this.getDevSupervisorClient(appId);
    return !!client && client.isAvailable();
  }

  /**
   * Get the process status from dev-supervisor for a specific app
   */
  private async getDevSupervisorProcessStatus(appId: string): Promise<any> {
    const devSupervisorClient = this.getDevSupervisorClient(appId);
    if (!devSupervisorClient) return null;
    
    try {
      return await devSupervisorClient.getProcessStatus();
    } catch (error) {
      this.logger.warn('docker.dev_supervisor.status.failure', {
        appId,
        error: (error as Error).message
      });
      return null;
    }
  }

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