/**
 * Local development deployment adapter
 * Handles full app lifecycle: filesystem setup, template copying, dependency installation, and dev server management
 */

import { BaseDeploymentAdapter } from './base-adapter';
import { DeploymentConfig, DeploymentResult } from './types';
import { mkdirSync, rmSync, existsSync, cpSync } from 'fs';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import net from 'net';

export class LocalDeploymentAdapter extends BaseDeploymentAdapter {
  private agentsServiceUrl: string;
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private baseAppsDir: string;
  private templateDir: string;

  constructor() {
    super({
      mode: 'local',
      agentsServiceUrl: process.env.AGENTS_SERVICE_URL || 'http://localhost:4000'
    });

    this.agentsServiceUrl = this.environment.agentsServiceUrl!;
    this.baseAppsDir = process.env.LOCAL_APPS_DIR || '/tmp/apps';
    this.templateDir = process.env.APP_TEMPLATE_DIR || path.join(process.cwd(), '..', 'app-templates', 'v8');

    this.log('info', 'Local deployment adapter initialized', {
      agentsServiceUrl: this.agentsServiceUrl,
      baseAppsDir: this.baseAppsDir,
      templateDir: this.templateDir
    });
  }

  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    const { siteId, accountId, prompt, title } = config;

    try {
      this.log('info', 'Starting local deployment', { siteId, accountId });

      // Step 1: Create app directory
      const appPath = path.join(this.baseAppsDir, siteId);
      await this.createAppDirectory(siteId, appPath);

      // Step 2: Copy template
      await this.copyTemplate(siteId, appPath);

      // Step 3: Find available port
      const port = await this.findAvailablePort();

      // Step 4: Install dependencies
      await this.installDependencies(siteId, appPath);

      // Step 5: Create app record in agents service FIRST
      await this.createAgentApp(siteId, title || `App ${siteId}`, prompt, appPath);

      // Step 6: Start development server
      await this.startDevServer(siteId, appPath, port);

      // Generate URLs
      const urls = {
        agent: `${this.agentsServiceUrl}`, // For AI interactions
        backend: `http://localhost:${port}`,
        preview: `http://localhost:${port}`
      };

      this.log('info', 'Local deployment completed successfully', {
        siteId,
        appPath,
        port,
        urls
      });

      return {
        success: true,
        siteId,
        urls,
        infrastructure: {
          appPath,
          port,
          processId: this.runningProcesses.get(siteId)?.pid
        },
        status: 'running'
      };

    } catch (error) {
      this.log('error', 'Local deployment failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Cleanup on failure
      await this.cleanup(siteId);

      return {
        success: false,
        siteId,
        error: error instanceof Error ? error.message : 'Local deployment failed',
        status: 'failed'
      };
    }
  }

  async getStatus(siteId: string): Promise<{ status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error'; message?: string; }> {
    try {
      // Check if process is running
      const process = this.runningProcesses.get(siteId);

      if (!process) {
        // Check if app directory exists
        const appPath = path.join(this.baseAppsDir, siteId);
        if (existsSync(appPath)) {
          return {
            status: 'stopped',
            message: 'App exists but development server is not running'
          };
        } else {
          return {
            status: 'failed',
            message: 'App not found'
          };
        }
      }

      // Process exists, check if it's still alive
      if (process.killed || process.exitCode !== null) {
        this.runningProcesses.delete(siteId);
        return {
          status: 'stopped',
          message: 'Development server process has stopped'
        };
      }

      return {
        status: 'running',
        message: `Development server running (PID: ${process.pid})`
      };

    } catch (error) {
      this.log('error', 'Status check failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        status: 'failed',
        message: `Status check error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async destroy(siteId: string): Promise<{ success: boolean; error?: string; }> {
    try {
      this.log('info', 'Destroying local deployment', { siteId });

      // Cleanup local resources
      await this.cleanup(siteId);

      this.log('info', 'Local deployment destroyed successfully', { siteId });
      return { success: true };

    } catch (error) {
      this.log('error', 'Local deployment destruction failed', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Local destruction failed'
      };
    }
  }

  async getMetadata(siteId: string): Promise<{ [key: string]: any; }> {
    // Local deployments don't need Ceph storage or complex metadata
    return {
      mode: 'local',
      agentsServiceUrl: this.agentsServiceUrl,
      // No cephMountId or cephDirNumber needed for local development
    };
  }

  /**
   * Create app directory
   */
  private async createAppDirectory(siteId: string, appPath: string): Promise<void> {
    this.log('info', 'Creating app directory', { siteId, appPath });

    if (existsSync(appPath)) {
      this.log('warn', 'App directory already exists, removing', { siteId, appPath });
      rmSync(appPath, { recursive: true, force: true });
    }

    mkdirSync(appPath, { recursive: true });
    this.log('info', 'App directory created', { siteId, appPath });
  }

  /**
   * Copy template to app directory
   */
  private async copyTemplate(siteId: string, appPath: string): Promise<void> {
    this.log('info', 'Copying template', { siteId, templateDir: this.templateDir, appPath });

    if (!existsSync(this.templateDir)) {
      throw new Error(`Template directory not found: ${this.templateDir}`);
    }

    // Copy template files
    cpSync(this.templateDir, appPath, {
      recursive: true,
      filter: (src) => {
        // Skip node_modules and other generated directories
        const relativePath = path.relative(this.templateDir, src);
        return !relativePath.includes('node_modules') &&
               !relativePath.includes('.git') &&
               !relativePath.includes('dist') &&
               !relativePath.includes('.next');
      }
    });

    this.log('info', 'Template copied successfully', { siteId, appPath });
  }

  /**
   * Find available port for development server
   */
  private async findAvailablePort(startPort: number = 3001): Promise<number> {
    for (let port = startPort; port < startPort + 100; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available ports found in range ${startPort}-${startPort + 99}`);
  }

  /**
   * Check if port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  }

  /**
   * Install dependencies
   */
  private async installDependencies(siteId: string, appPath: string): Promise<void> {
    this.log('info', 'Installing dependencies', { siteId, appPath });

    return new Promise((resolve, reject) => {
      const process = spawn('npm', ['install'], {
        cwd: appPath,
        stdio: 'pipe'
      });

      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          this.log('info', 'Dependencies installed successfully', { siteId });
          resolve();
        } else {
          this.log('error', 'Failed to install dependencies', {
            siteId,
            code,
            output: output.slice(-500), // Last 500 chars
            error: errorOutput.slice(-500)
          });
          reject(new Error(`npm install failed with code ${code}: ${errorOutput}`));
        }
      });

      process.on('error', (error) => {
        this.log('error', 'npm install process error', { siteId, error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Start development server
   */
  private async startDevServer(siteId: string, appPath: string, port: number): Promise<void> {
    this.log('info', 'Starting development server', { siteId, appPath, port });

    const devProcess = spawn('npm', ['run', 'dev'], {
      cwd: appPath,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: port.toString(),
        NODE_ENV: 'development'
      }
    });

    // Store the process
    this.runningProcesses.set(siteId, devProcess);

    // Set up logging
    devProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('ready') || output.includes('Local:') || output.includes('localhost')) {
        this.log('info', 'Dev server output', { siteId, output: output.trim() });
      }
    });

    devProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      if (!error.includes('Warning') && !error.includes('deprecated')) {
        this.log('warn', 'Dev server stderr', { siteId, error: error.trim() });
      }
    });

    devProcess.on('close', (code) => {
      this.log('info', 'Dev server process closed', { siteId, code });
      this.runningProcesses.delete(siteId);
    });

    devProcess.on('error', (error) => {
      this.log('error', 'Dev server process error', { siteId, error: error.message });
      this.runningProcesses.delete(siteId);
    });

    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify server is responding
    const serverStarted = await this.waitForServer(port, 30000); // 30 second timeout
    if (!serverStarted) {
      throw new Error(`Development server failed to start on port ${port}`);
    }

    this.log('info', 'Development server started successfully', { siteId, port });
  }

  /**
   * Wait for server to be ready
   */
  private async waitForServer(port: number, timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(`http://localhost:${port}`, {
          signal: AbortSignal.timeout(2000)
        });
        if (response.ok || response.status < 500) {
          return true;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return false;
  }

  /**
   * Cleanup app resources
   */
  private async cleanup(siteId: string): Promise<void> {
    this.log('info', 'Cleaning up app resources', { siteId });

    // Stop process if running
    const process = this.runningProcesses.get(siteId);
    if (process) {
      process.kill('SIGTERM');
      this.runningProcesses.delete(siteId);
    }

    // Remove directory
    const appPath = path.join(this.baseAppsDir, siteId);
    if (existsSync(appPath)) {
      rmSync(appPath, { recursive: true, force: true });
      this.log('info', 'App directory removed', { siteId, appPath });
    }
  }

  /**
   * Check if agents service is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.agentsServiceUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      const isHealthy = response.ok;
      this.log(isHealthy ? 'info' : 'warn', 'Agents service health check', {
        available: isHealthy,
        status: response.status
      });

      return isHealthy;
    } catch (error) {
      this.log('warn', 'Agents service health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Create app record in agents service
   */
  private async createAgentApp(siteId: string, name: string, initialPrompt: string, appPath: string): Promise<void> {
    try {
      this.log('info', 'Creating app record in agents service', { siteId, name });

      const response = await fetch(`${this.agentsServiceUrl}/apps/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          initialPrompt,
          siteId
        }),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create app in agents service: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      this.log('info', 'App record created in agents service', {
        siteId,
        agentAppId: result.app?.id,
        success: result.success
      });

    } catch (error) {
      this.log('error', 'Failed to create app record in agents service', {
        siteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - this is not critical for local deployment
      // The app can still run locally even if agents service creation fails
    }
  }
}
