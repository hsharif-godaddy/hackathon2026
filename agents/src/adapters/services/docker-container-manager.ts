import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { getDatabase } from '../../database/connection.js';
import { logger } from '../../logging/index.js';
import { dockerContainerEvents } from '../../logging/events/index.js';

const execAsync = promisify(exec);

export interface ContainerInfo {
  appId: string;
  containerId: string;
  port: number;
  status: 'building' | 'running' | 'stopped' | 'error';
  imageName: string;
  createdAt: Date;
}

/**
 * Docker Container Manager for All Template Apps
 * Manages Docker containers for development apps (v1, v2, v3, etc.)
 */
export class DockerContainerManager {
  private db = getDatabase();
  private containers = new Map<string, ContainerInfo>();
  private initialized = false;
  private activeRebuilds = new Set<string>(); // Track ongoing rebuilds

  /**
   * Detect template version from app path
   */
  private detectTemplateVersion(appPath: string): string {
    try {
      // Check for v3 indicators (Vite config, dev-start.js script)
      if (existsSync(path.join(appPath, 'vite.config.ts')) || 
          existsSync(path.join(appPath, 'vite.config.js')) ||
          existsSync(path.join(appPath, 'scripts/dev-start.js'))) {
        return 'v3';
      }
      
      // Check for v2 indicators (Next.js with Turbopack)
      const packageJsonPath = path.join(appPath, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.scripts?.dev?.includes('--turbopack')) {
          return 'v2';
        }
      }
      
      // Default to v1 (basic Next.js)
      return 'v1';
    } catch (error) {
      logger.warn('Could not detect template version, defaulting to v1', {
        component: 'DockerContainerManager',
        appPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return 'v1';
    }
  }

  /**
   * Initialize the container manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();
    
    // Log initialization begin
    dockerContainerEvents.begin(logger, {
      appId: 'system',
      operation: 'initialize'
    });
    
    try {
      // Check if Docker is available
      await execAsync('docker --version');
      logger.info('Docker availability verified', {
        component: 'DockerContainerManager'
      });

      // Initialize database table
      this.initializeDatabase();
      
      // Recover any existing running containers
      await this.recoverExistingContainers();
      
      this.initialized = true;
      
      const duration = Date.now() - startTime;
      
      // Log initialization success
      dockerContainerEvents.success(logger, {
        appId: 'system',
        operation: 'initialize',
        operationStats: {
          success: true,
          duration
        }
      });
      
    } catch (error) {
      // Log initialization failure
      dockerContainerEvents.failure(logger, error as Error, {
        appId: 'system',
        operation: 'initialize'
      });
      
      throw new Error('Docker is not installed or not available in PATH');
    }
  }

  /**
   * Ensure a container is completely removed with proper wait time
   */
  private async ensureContainerRemoved(containerName: string): Promise<void> {
    try {
      // Get all containers (running and stopped) with this exact name
      const { stdout } = await execAsync(`docker ps -aq --filter name=^${containerName}$`);
      const containerIds = stdout.trim().split('\n').filter(id => id.length > 0);
      
      if (containerIds.length > 0) {
        logger.info('Removing existing Docker containers', {
          component: 'DockerContainerManager',
          containerName,
          containerCount: containerIds.length,
          containerIds: containerIds.slice(0, 3) // Log first 3 IDs to avoid spam
        });
        
        await execAsync(`docker rm -f ${containerIds.join(' ')}`);
        
        logger.debug('Docker containers removed, waiting for name release', {
          component: 'DockerContainerManager',
          containerName
        });
        
        // Wait for Docker daemon to fully release the name
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify the name is actually free
        const { stdout: verifyStdout } = await execAsync(`docker ps -aq --filter name=^${containerName}$`);
        if (verifyStdout.trim()) {
          throw new Error(`Container name ${containerName} is still in use after removal`);
        }
      }
    } catch (error: any) {
      if (!error.message?.includes('Container name') && !error.message?.includes('No such container')) {
        // Only log if it's not a "name still in use" error (which we want to propagate) 
        // or "no such container" error (which is expected)
        logger.debug('Container cleanup info', {
          component: 'DockerContainerManager',
          containerName,
          message: error.message || 'completed'
        });
      } else {
        throw error; // Re-throw critical errors
      }
    }
  }

  /**
   * Create and start a container for an app (without cleanup - for internal use during rebuild)
   */
  private async createAndStartContainerSkipCleanup(appId: string, appPath: string, port: number): Promise<ContainerInfo> {
    return this.createAndStartContainerInternal(appId, appPath, port, true);
  }

  /**
   * Create and start a container for an app
   */
  async createAndStartContainer(appId: string, appPath: string, port: number): Promise<ContainerInfo> {
    return this.createAndStartContainerInternal(appId, appPath, port, false);
  }

  /**
   * Internal method to create and start a container with optional cleanup skip
   */
  private async createAndStartContainerInternal(appId: string, appPath: string, port: number, skipCleanup: boolean): Promise<ContainerInfo> {
    const startTime = Date.now();
    const templateVersion = this.detectTemplateVersion(appPath);
    
    // Docker has strict naming requirements: lowercase, alphanumeric, dashes and dots only
    // Remove/replace invalid characters and ensure it doesn't end with special characters
    const dockerSafeId = appId
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '') // Remove invalid chars (including underscores)
      .replace(/^[.-]+|[.-]+$/g, '') // Remove leading/trailing dots or dashes
      .substring(0, 63); // Docker name limit
      
    const imageName = `airo-app-${dockerSafeId}:dev`;
    const containerName = `airo-app-${dockerSafeId}`;
    
    // Log container creation begin
    dockerContainerEvents.begin(logger, {
      appId,
      operation: 'create',
      imageName,
      port,
      templateVersion
    });
    
    try {
      // Build the Docker image
      logger.info('Building Docker image', {
        component: 'DockerContainerManager',
        appId,
        imageName,
        buildCommand: `docker build -f Dockerfile.dev -t ${imageName} .`
      });
      
      const buildCommand = `docker build -f Dockerfile.dev -t ${imageName} .`;
      
      const buildProcess = execAsync(buildCommand, {
        cwd: appPath,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer for build output
      });

      // Show build progress (keep minimal logging during build)
      buildProcess.child.stdout?.on('data', (data) => {
        logger.debug('Docker build output', {
          component: 'DockerContainerManager',
          appId,
          output: data.toString().trim().substring(0, 200) // Limit output size
        });
      });

      await buildProcess;
      logger.info('Docker image built successfully', {
        component: 'DockerContainerManager',
        appId,
        imageName
      });

      // Ensure any existing container is properly removed (unless skipping cleanup)
      if (!skipCleanup) {
        await this.ensureContainerRemoved(containerName);
      }

      // Create and start the container with volume mounting for live development
      logger.info('Starting Docker container', {
        component: 'DockerContainerManager',
        appId,
        containerName,
        port,
        templateVersion
      });
      
      const runCommand = [
        'docker run -d',
        `--name ${containerName}`,
        `-p ${port}:${templateVersion === 'v3' ? port : '3000'}`, // v3 uses dynamic port, v1/v2 use 3000
        `-v "${appPath}:/app"`, // Mount app directory for live editing
        `-v /app/node_modules`, // Anonymous volume for node_modules to avoid conflicts
        ...(templateVersion === 'v3' ? [
          `-v /app/dist`, // Anonymous volume for Vite dist directory
          `-e PREFERRED_FRONTEND_PORT=${port}`, // v3 template uses this for port configuration
          `-e VITE_HOST=0.0.0.0`, // Make Vite accessible from outside container
          `-e RUNNING_IN_DOCKER=true`, // Flag for v3 template to detect Docker environment
          `-e VITE_PARENT_ORIGIN=http://localhost:3000`, // Set secure parent origin for postMessage
        ] : [
          `-v /app/.next`, // Anonymous volume for Next.js .next directory
          '-e NEXT_TELEMETRY_DISABLED=1', // Next.js specific
        ]),
        '-e NODE_ENV=development',
        '--restart unless-stopped',
        imageName
      ].join(' ');

      const { stdout: containerId } = await execAsync(runCommand);
      const cleanContainerId = containerId.trim();

      const containerInfo: ContainerInfo = {
        appId,
        containerId: cleanContainerId,
        port,
        status: 'running',
        imageName,
        createdAt: new Date()
      };

      // Store in memory and database
      this.containers.set(appId, containerInfo);
      this.saveContainerToDb(containerInfo);

      const duration = Date.now() - startTime;
      
      // Log container creation success
      dockerContainerEvents.success(logger, {
        appId,
        operation: 'create',
        containerId: cleanContainerId,
        imageName,
        port,
        templateVersion,
        operationStats: {
          success: true,
          duration,
          containerStatus: 'running'
        }
      });

      return containerInfo;

    } catch (error: any) {
      
      // Log container creation failure
      dockerContainerEvents.failure(logger, error, {
        appId,
        operation: 'create',
        imageName,
        port,
        templateVersion
      });
      
      throw new Error(`Container creation failed: ${error.message}`);
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(appId: string): Promise<boolean> {
    const startTime = Date.now();
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      logger.warn('Container not found for stop operation', {
        component: 'DockerContainerManager',
        appId
      });
      return false;
    }

    // Log stop operation begin
    dockerContainerEvents.begin(logger, {
      appId,
      operation: 'stop',
      containerId: containerInfo.containerId
    });

    try {
      await execAsync(`docker stop ${containerInfo.containerId}`);
      
      containerInfo.status = 'stopped';
      this.saveContainerToDb(containerInfo);
      
      const duration = Date.now() - startTime;
      
      // Log stop success
      dockerContainerEvents.success(logger, {
        appId,
        operation: 'stop',
        containerId: containerInfo.containerId,
        operationStats: {
          success: true,
          duration,
          containerStatus: 'stopped'
        }
      });
      
      return true;
    } catch (error: any) {
      // Log stop failure
      dockerContainerEvents.failure(logger, error, {
        appId,
        operation: 'stop',
        containerId: containerInfo.containerId
      });
      
      return false;
    }
  }

  /**
   * Remove container completely
   */
  async removeContainer(appId: string): Promise<boolean> {
    const startTime = Date.now();
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      logger.warn('Container not found for remove operation', {
        component: 'DockerContainerManager',
        appId
      });
      return false;
    }

    // Log remove operation begin
    dockerContainerEvents.begin(logger, {
      appId,
      operation: 'remove',
      containerId: containerInfo.containerId,
      imageName: containerInfo.imageName
    });

    try {
      // Force remove container (stops if running)
      await execAsync(`docker rm -f ${containerInfo.containerId}`);
      
      // Remove image
      try {
        await execAsync(`docker rmi ${containerInfo.imageName}`);
        logger.debug('Docker image removed', {
          component: 'DockerContainerManager',
          appId,
          imageName: containerInfo.imageName
        });
      } catch (imageError) {
        logger.debug('Docker image may be in use, skipping removal', {
          component: 'DockerContainerManager',
          appId,
          imageName: containerInfo.imageName
        });
      }
      
      // Remove from memory and database
      this.containers.delete(appId);
      this.removeContainerFromDb(appId);
      
      const duration = Date.now() - startTime;
      
      // Log remove success
      dockerContainerEvents.success(logger, {
        appId,
        operation: 'remove',
        containerId: containerInfo.containerId,
        imageName: containerInfo.imageName,
        operationStats: {
          success: true,
          duration
        }
      });
      
      return true;
    } catch (error: any) {
      // Log remove failure
      dockerContainerEvents.failure(logger, error, {
        appId,
        operation: 'remove',
        containerId: containerInfo.containerId
      });
      
      return false;
    }
  }

  /**
   * Get container status
   */
  async getContainerStatus(appId: string): Promise<ContainerInfo | null> {
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      return null;
    }

    try {
      // Check actual Docker status
      const { stdout } = await execAsync(`docker inspect --format='{{.State.Status}}' ${containerInfo.containerId}`);
      const dockerStatus = stdout.trim();
      
      // Map Docker status to our status
      let status: ContainerInfo['status'];
      switch (dockerStatus) {
        case 'running':
          status = 'running';
          break;
        case 'exited':
        case 'stopped':
          status = 'stopped';
          break;
        default:
          status = 'error';
      }
      
      // Update if changed
      if (status !== containerInfo.status) {
        containerInfo.status = status;
        this.saveContainerToDb(containerInfo);
      }
      
      return containerInfo;
    } catch (error) {
      // Container doesn't exist anymore
      containerInfo.status = 'error';
      return containerInfo;
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(appId: string, tailLines: number = 100): Promise<string> {
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      throw new Error(`No container found for app ${appId}`);
    }

    try {
      const { stdout } = await execAsync(`docker logs --tail ${tailLines} ${containerInfo.containerId}`);
      return stdout;
    } catch (error: any) {
      throw new Error(`Failed to get container logs: ${error.message}`);
    }
  }

  /**
   * Restart container
   */
  async restartContainer(appId: string): Promise<boolean> {
    const startTime = Date.now();
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      logger.warn('Container not found for restart operation', {
        component: 'DockerContainerManager',
        appId
      });
      return false;
    }

    // Log restart operation begin
    dockerContainerEvents.begin(logger, {
      appId,
      operation: 'restart',
      containerId: containerInfo.containerId
    });

    try {
      await execAsync(`docker restart ${containerInfo.containerId}`);
      
      containerInfo.status = 'running';
      this.saveContainerToDb(containerInfo);
      
      const duration = Date.now() - startTime;
      
      // Log restart success
      dockerContainerEvents.success(logger, {
        appId,
        operation: 'restart',
        containerId: containerInfo.containerId,
        operationStats: {
          success: true,
          duration,
          containerStatus: 'running'
        }
      });
      
      return true;
    } catch (error: any) {
      // Log restart failure
      dockerContainerEvents.failure(logger, error, {
        appId,
        operation: 'restart',
        containerId: containerInfo.containerId
      });
      
      return false;
    }
  }

  /**
   * List all containers
   */
  getAllContainers(): ContainerInfo[] {
    const stmt = this.db.prepare(`
      SELECT app_id, container_id, port, status, image_name, created_at 
      FROM docker_containers 
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as any[];
    
    return rows.map(row => ({
      appId: row.app_id,
      containerId: row.container_id,
      port: row.port,
      status: row.status,
      imageName: row.image_name,
      createdAt: new Date(row.created_at)
    }));
  }

  /**
   * Recover existing running containers from previous session
   */
  private async recoverExistingContainers(): Promise<void> {
    const startTime = Date.now();
    
    // Log recovery begin
    dockerContainerEvents.begin(logger, {
      appId: 'system',
      operation: 'recover'
    });
    
    try {
      // Get all container records from database
      const stmt = this.db.prepare('SELECT * FROM docker_containers');
      const containerRecords = stmt.all() as any[];
      
      logger.info('Starting container recovery process', {
        component: 'DockerContainerManager',
        containerRecordsFound: containerRecords.length
      });
      
      let recoveredCount = 0;
      let cleanedCount = 0;
      
      for (const record of containerRecords) {
        try {
          // Check if container is still running
          const { stdout } = await execAsync(`docker inspect ${record.container_id} --format='{{.State.Status}}'`);
          const dockerStatus = stdout.trim();
          
          if (dockerStatus === 'running') {
            // Container is running - recover it
            const containerInfo: ContainerInfo = {
              appId: record.app_id,
              containerId: record.container_id,
              port: record.port,
              status: 'running',
              imageName: record.image_name,
              createdAt: new Date(record.created_at)
            };
            
            // Add to in-memory tracking
            this.containers.set(record.app_id, containerInfo);
            
            // Update database status to running
            const updateStmt = this.db.prepare('UPDATE docker_containers SET status = ? WHERE app_id = ?');
            updateStmt.run('running', record.app_id);
            
            recoveredCount++;
            logger.info('Recovered running container', {
              component: 'DockerContainerManager',
              appId: record.app_id,
              containerId: record.container_id,
              port: record.port
            });
            
          } else if (dockerStatus === 'exited' || dockerStatus === 'dead') {
            // Container exists but stopped - remove it and clean database
            try {
              await execAsync(`docker rm -f ${record.container_id}`);
              this.removeContainerFromDb(record.app_id);
              cleanedCount++;
              logger.info('Cleaned up stopped container', {
                component: 'DockerContainerManager',
                appId: record.app_id,
                containerId: record.container_id,
                status: dockerStatus
              });
            } catch (cleanupError) {
              logger.warn('Failed to clean up stopped container', {
                component: 'DockerContainerManager',
                containerId: record.container_id,
                error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
              });
            }
          }
          
        } catch (inspectError) {
          // Container doesn't exist - clean up database record
          this.removeContainerFromDb(record.app_id);
          cleanedCount++;
          logger.info('Cleaned up orphaned database record', {
            component: 'DockerContainerManager',
            appId: record.app_id
          });
        }
      }
      
      const duration = Date.now() - startTime;
      
      // Log recovery success
      dockerContainerEvents.success(logger, {
        appId: 'system',
        operation: 'recover',
        operationStats: {
          success: true,
          duration,
          containersRecovered: recoveredCount,
          containersCleanedUp: cleanedCount
        }
      });
      
    } catch (error) {
      // Log recovery failure
      dockerContainerEvents.failure(logger, error as Error, {
        appId: 'system',
        operation: 'recover'
      });
    }
  }

  /**
   * Initialize database table for container tracking
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docker_containers (
        app_id TEXT PRIMARY KEY,
        container_id TEXT NOT NULL,
        port INTEGER NOT NULL,
        status TEXT NOT NULL,
        image_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
      )
    `);
  }

  /**
   * Save container info to database
   */
  private saveContainerToDb(containerInfo: ContainerInfo): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO docker_containers 
      (app_id, container_id, port, status, image_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      containerInfo.appId,
      containerInfo.containerId,
      containerInfo.port,
      containerInfo.status,
      containerInfo.imageName,
      containerInfo.createdAt.toISOString()
    );
  }

  /**
   * Get container from database
   */
  private getContainerFromDb(appId: string): ContainerInfo | null {
    const stmt = this.db.prepare(`
      SELECT * FROM docker_containers WHERE app_id = ?
    `);
    const row = stmt.get(appId) as any;
    
    if (!row) return null;
    
    return {
      appId: row.app_id,
      containerId: row.container_id,
      port: row.port,
      status: row.status,
      imageName: row.image_name,
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Remove container from database
   */
  private removeContainerFromDb(appId: string): void {
    const stmt = this.db.prepare('DELETE FROM docker_containers WHERE app_id = ?');
    stmt.run(appId);
  }

  /**
   * Get running containers as server info
   */
  getRunningServers(): Array<{ appId: string; port: number; url: string; status: string; containerId: string; imageName: string }> {
    const runningServers: Array<{ appId: string; port: number; url: string; status: string; containerId: string; imageName: string }> = [];
    
    // Get running containers from database
    const stmt = this.db.prepare('SELECT app_id, port, status, container_id, image_name FROM docker_containers WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    
    for (const record of runningRecords) {
      runningServers.push({
        appId: record.app_id,
        port: record.port,
        url: `http://localhost:${record.port}`,
        status: record.status,
        containerId: record.container_id,
        imageName: record.image_name
      });
    }
    
    return runningServers;
  }

  /**
   * Stop all running containers
   */
  async stopAllServers(): Promise<number> {
    let stoppedCount = 0;
    
    // Get all running containers
    const stmt = this.db.prepare('SELECT app_id FROM docker_containers WHERE status = ?');
    const runningRecords = stmt.all('running') as any[];
    
    logger.info('Stopping all running containers', {
      component: 'DockerContainerManager',
      runningContainers: runningRecords.length
    });
    
    for (const record of runningRecords) {
      try {
        const success = await this.stopContainer(record.app_id);
        if (success) {
          stoppedCount++;
          logger.debug('Successfully stopped container', {
            component: 'DockerContainerManager',
            appId: record.app_id
          });
        }
      } catch (error) {
        logger.warn('Failed to stop container during bulk stop', {
          component: 'DockerContainerManager',
          appId: record.app_id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    logger.info('Bulk container stop completed', {
      component: 'DockerContainerManager',
      totalContainers: runningRecords.length,
      successfullyStopped: stoppedCount
    });
    
    return stoppedCount;
  }

  /**
   * Get container status for a specific app
   */
  async getAppContainerStatus(appId: string) {
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      return { status: 'not_found', message: 'No container found for this app' };
    }

    try {
      // Check actual container status with Docker
      const { stdout } = await execAsync(`docker inspect ${containerInfo.containerId} --format='{{.State.Status}}'`);
      const dockerStatus = stdout.trim();
      
      return {
        status: dockerStatus, // Will be 'running', 'exited', 'dead', etc.
        containerId: containerInfo.containerId,
        port: containerInfo.port,
        imageName: containerInfo.imageName,
        url: `http://localhost:${containerInfo.port}`
      };
    } catch (error) {
      // Container record exists in DB but Docker container is gone - should rebuild
      logger.warn('Container record exists but Docker container is missing', {
        component: 'DockerContainerManager',
        appId,
        containerId: containerInfo.containerId
      });
      
      // Clean up orphaned database record
      this.removeContainerFromDb(appId);
      
      return { 
        status: 'container_missing', 
        message: 'Container record exists but Docker container is missing - needs rebuild',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get container logs for a specific app
   */
  async getAppContainerLogs(appId: string, lines: number = 100): Promise<string> {
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      throw new Error('No container found for this app');
    }

    try {
      const { stdout } = await execAsync(`docker logs --tail ${lines} ${containerInfo.containerId}`);
      return stdout;
    } catch (error) {
      throw new Error(`Failed to get container logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Restart container for a specific app
   */
  async restartAppContainer(appId: string): Promise<boolean> {
    const startTime = Date.now();
    const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
    
    if (!containerInfo) {
      logger.warn('Container not found for app restart', {
        component: 'DockerContainerManager',
        appId
      });
      return false;
    }

    // Log restart begin
    dockerContainerEvents.begin(logger, {
      appId,
      operation: 'restart',
      containerId: containerInfo.containerId
    });

    try {
      await execAsync(`docker restart ${containerInfo.containerId}`);
      
      // Update status in database
      const stmt = this.db.prepare('UPDATE docker_containers SET status = ? WHERE app_id = ?');
      stmt.run('running', appId);
      
      const duration = Date.now() - startTime;
      
      // Log restart success
      dockerContainerEvents.success(logger, {
        appId,
        operation: 'restart',
        containerId: containerInfo.containerId,
        operationStats: {
          success: true,
          duration,
          containerStatus: 'running'
        }
      });
      
      return true;
    } catch (error) {
      // Log restart failure
      dockerContainerEvents.failure(logger, error as Error, {
        appId,
        operation: 'restart',
        containerId: containerInfo.containerId
      });
      
      return false;
    }
  }

  /**
   * Stop container for a specific app
   */
  async stopAppContainer(appId: string): Promise<boolean> {
    return await this.stopContainer(appId);
  }

  /**
   * Rebuild container from scratch using local app files
   * Used when container doesn't exist but app files are available
   */
  async rebuildAndStartContainer(appId: string, appPath: string, port: number): Promise<ContainerInfo | null> {
    const startTime = Date.now();
    
    // Check if rebuild is already in progress for this app
    if (this.activeRebuilds.has(appId)) {
      logger.warn('Rebuild already in progress, skipping duplicate request', {
        component: 'DockerContainerManager',
        appId
      });
      return null;
    }

    // Log rebuild begin
    dockerContainerEvents.begin(logger, {
      appId,
      operation: 'rebuild',
      port
    });
    
    // Mark rebuild as in progress
    this.activeRebuilds.add(appId);
    
    try {
      // Validate that app path exists
      if (!existsSync(appPath)) {
        const pathError = new Error(`App directory not found: ${appPath}`);
        logger.error('App path validation failed', {
          component: 'DockerContainerManager',
          appId,
          appPath,
          error: pathError.message
        });
        throw pathError;
      }

      // Check for Dockerfile
      const dockerfilePath = path.join(appPath, 'Dockerfile.dev');
      if (!existsSync(dockerfilePath)) {
        const dockerfileError = new Error(`Dockerfile.dev not found in app directory: ${appPath}`);
        logger.error('Dockerfile validation failed', {
          component: 'DockerContainerManager',
          appId,
          dockerfilePath,
          error: dockerfileError.message
        });
        throw dockerfileError;
      }

      // Clean up any existing container/image first
      await this.cleanupContainerAndImage(appId);
      
      // Create new container - skip cleanup since we just did it
      const containerInfo = await this.createAndStartContainerSkipCleanup(appId, appPath, port);
      
      const duration = Date.now() - startTime;
      
      // Log rebuild success
      dockerContainerEvents.success(logger, {
        appId,
        operation: 'rebuild',
        containerId: containerInfo.containerId,
        imageName: containerInfo.imageName,
        port,
        operationStats: {
          success: true,
          duration,
          containerStatus: 'running'
        }
      });
      
      return containerInfo;
      
    } catch (error) {
      // Log rebuild failure
      dockerContainerEvents.failure(logger, error as Error, {
        appId,
        operation: 'rebuild',
        port
      });
      
      throw error;
    } finally {
      // Always remove the rebuild lock
      this.activeRebuilds.delete(appId);
    }
  }

  /**
   * Clean up container and associated image
   */
  private async cleanupContainerAndImage(appId: string): Promise<void> {
    const dockerSafeId = appId
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '')
      .replace(/^[.-]+|[.-]+$/g, '')
      .substring(0, 63);
      
    const imageName = `airo-app-${dockerSafeId}:dev`;
    const containerName = `airo-app-${dockerSafeId}`;
    
    // Remove any existing containers using the robust method
    await this.ensureContainerRemoved(containerName);

    try {
      // Remove image if it exists to force rebuild
      await execAsync(`docker rmi -f ${imageName}`);
      logger.debug('Removed existing image for rebuild', {
        component: 'DockerContainerManager',
        appId,
        imageName
      });
    } catch (error) {
      // Image doesn't exist, that's fine
      logger.debug('Image removal skipped, likely did not exist', {
        component: 'DockerContainerManager',
        appId,
        imageName
      });
    }

    // Clean database record
    this.removeContainerFromDb(appId);
  }

  /**
   * Force cleanup orphaned containers
   */
  async forceCleanupOrphans(): Promise<number> {
    const startTime = Date.now();
    let cleanedCount = 0;
    
    // Log cleanup begin
    dockerContainerEvents.begin(logger, {
      appId: 'system',
      operation: 'cleanup'
    });
    
    try {
      // Get all containers from database
      const stmt = this.db.prepare('SELECT * FROM docker_containers');
      const allContainers = stmt.all() as any[];
      
      logger.info('Starting force cleanup of orphaned containers', {
        component: 'DockerContainerManager',
        containerRecordsFound: allContainers.length
      });
      
      for (const containerRecord of allContainers) {
        try {
          // Check if container actually exists
          const { stdout } = await execAsync(`docker inspect ${containerRecord.container_id} --format='{{.State.Status}}'`);
          const dockerStatus = stdout.trim();
          
          if (dockerStatus === 'exited' || dockerStatus === 'dead') {
            // Container exists but is stopped, remove it
            await execAsync(`docker rm -f ${containerRecord.container_id}`);
            this.removeContainerFromDb(containerRecord.app_id);
            cleanedCount++;
            logger.debug('Cleaned up stopped container during force cleanup', {
              component: 'DockerContainerManager',
              appId: containerRecord.app_id,
              containerId: containerRecord.container_id,
              status: dockerStatus
            });
          }
        } catch (error) {
          // Container doesn't exist, remove database record
          this.removeContainerFromDb(containerRecord.app_id);
          cleanedCount++;
          logger.debug('Cleaned up orphaned database record during force cleanup', {
            component: 'DockerContainerManager',
            appId: containerRecord.app_id,
            containerId: containerRecord.container_id
          });
        }
      }
      
      const duration = Date.now() - startTime;
      
      // Log cleanup success
      dockerContainerEvents.success(logger, {
        appId: 'system',
        operation: 'cleanup',
        operationStats: {
          success: true,
          duration,
          containersCleanedUp: cleanedCount
        }
      });
      
      return cleanedCount;
      
    } catch (error) {
      // Log cleanup failure
      dockerContainerEvents.failure(logger, error as Error, {
        appId: 'system',
        operation: 'cleanup'
      });
      
      return cleanedCount;
    }
  }
}
