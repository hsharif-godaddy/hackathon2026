import { logger } from '../../request-context';
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { DevDatabase } from '../database/DevDatabase';
import { devSupervisor } from '../../features';
import { userInfo } from "node:os";
import { DockerComposeGenerator, type ComposeServiceConfig, type DatabaseConfig } from './docker-compose-generator';
import { DockerComposeManager } from './docker-compose-manager';
import { SharedMySQLService } from './shared-mysql-service';
import * as net from "net";

const execAsync = promisify(exec);

/**
 * Determine if TCP mode should be used for dev-supervisor
 * Uses centralized features module and ensures development-only usage
 */
function shouldUseTcpMode(): boolean {
	return devSupervisor.shouldUseTcp();
}

/**
 * Get TCP port for dev-supervisor
 */
function getTcpPort(): string {
	return devSupervisor.getTcpPort();
}


export interface ContainerInfo {
	appId: string;
	containerId: string;
	appPath: string; // Path to app directory (needed for compose operations)
	port: number;
	status: "building" | "running" | "stopped" | "error";
	imageName: string;
	createdAt: Date;
	socketPath: string; // Unified: Either Unix socket path or tcp://localhost:PORT
}

/**
 * Docker Container Manager for All Template Apps
 * Manages Docker containers for development apps (v1, v2, v3, etc.)
 */
export class DockerContainerManager {
	private devDb: DevDatabase;
	private composeGenerator: DockerComposeGenerator;
	private composeManager: DockerComposeManager;
	private sharedMySQLService: SharedMySQLService;
	private containers = new Map<string, ContainerInfo>();
	private initialized = false;
	private activeRebuilds = new Set<string>(); // Track ongoing rebuilds

	constructor(devDb: DevDatabase) {
		this.devDb = devDb;
		this.composeGenerator = new DockerComposeGenerator();
		this.composeManager = new DockerComposeManager();
		this.sharedMySQLService = new SharedMySQLService();
	}

	/**
	 * Sanitize app ID for safe use in file paths and Docker names
	 * Removes/replaces invalid characters to prevent path traversal and command injection
	 */
	private sanitizeAppId(appId: string): string {
		return appId
			.toLowerCase()
			.replace(/[^a-z0-9.-]/g, "") // Remove invalid chars (including underscores)
			.replace(/^[.-]+|[.-]+$/g, "") // Remove leading/trailing dots or dashes
			.substring(0, 63); // Limit length
	}



	/**
	 * Get the current host user's UID and GID for proper file permissions in containers
	 */
	private getHostUserInfo(): { uid: number; gid: number } {
		try {
			// Get current user info
			const user = userInfo();
			return {
				uid: user.uid,
				gid: user.gid
			};
		} catch (error) {
			logger.warn("Could not get host user info, using default UID/GID", {
				error: error instanceof Error ? error.message : String(error),
			});
			// Fallback to default values if we can't get user info
			return { uid: 790, gid: 790 };
		}
	}

	/**
	 * Get the app path for a given appId
	 * Centralizes the logic for constructing app paths
	 */
	private getAppPath(appId: string): string {
		return `/tmp/apps/${appId}`;
	}


	/**
	 * Write database credentials to .env file for host machine access
	 * This allows the agents service (running on host) to read DB credentials
	 */
	private writeDatabaseEnvFile(appPath: string, dbConfig: DatabaseConfig): void {
		try {
			const envPath = path.join(appPath, '.env');
			const envExamplePath = path.join(appPath, 'env.example');

			logger.info("database.env.write.begin", {
				envPath,
			});

			// Read existing env.example if it exists to preserve other variables
			let existingEnvContent = '';
			if (existsSync(envExamplePath)) {
				existingEnvContent = readFileSync(envExamplePath, 'utf-8');
			}

			// Generate env file content
			const envContent = this.composeGenerator.generateEnvFile(dbConfig, existingEnvContent);

			// Write the .env file
			writeFileSync(envPath, envContent, 'utf-8');

			logger.info("database.env.write.success", {
				envPath,
			});
		} catch (error) {
			logger.error("database.env.write.failure", {
				error: error instanceof Error ? error.message : String(error),
			});
			// Don't throw - this is not critical for container operation
			// The container gets env vars via compose file, .env is only for host access
		}
	}

	/**
	 * Initialize the container manager
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		const startTime = Date.now();

		logger.info('🔄 Initializing Docker Container Manager...');

		try {
			// Check if Docker is available
			await execAsync("docker --version");
			logger.info('✅ Docker availability verified');

			// Check if Docker Compose is available
			await execAsync("docker compose version");
			logger.info('✅ Docker Compose availability verified');

			// Initialize shared MySQL service (also ensures network exists and connects MySQL container)
			await this.sharedMySQLService.initialize();
			logger.info('✅ Shared MySQL service initialized');

			// Build dev-supervisor image if needed
			await this.ensureDevSupervisorImage();

			// Initialize database table
			this.initializeDatabase();

			// Recover any existing running containers
			await this.recoverExistingContainers();

			this.initialized = true;

			const duration = Date.now() - startTime;

			logger.info(`✅ Docker Container Manager initialization completed in ${duration}ms`);
		} catch (error) {
			logger.error('❌ Docker Container Manager initialization failed:', error);

			throw new Error("Docker or Docker Compose is not installed or not available in PATH");
		}
	}

	/**
	 * Ensure a compose stack is completely removed with proper cleanup
	 * Replaces the old ensureContainerRemoved method
	 */
	private async ensureComposeStackRemoved(appPath: string): Promise<void> {
		try {
			logger.info(`🗑️ Ensuring compose stack is removed: ${appPath}`);

			await this.composeManager.down(appPath, true);

			logger.info(`✅ Compose stack removed: ${appPath}`);
		} catch (error: any) {
			if (!error.message?.includes("No such file") && !error.message?.includes("not found")) {
				// Only log if it's not a "file not found" error (which is expected)
				logger.info(`ℹ️ Compose stack cleanup info:`, error.message || "completed");
			}
		}
	}

	/**
	 * Create and start a container for an app (without cleanup - for internal use during rebuild)
	 */
	private async createAndStartContainerSkipCleanup(
		appId: string,
		appPath: string,
		port: number,
	): Promise<ContainerInfo> {
		return this.createAndStartContainerInternal(appId, appPath, port, true);
	}

	/**
	 * Create and start a container for an app
	 */
	async createAndStartContainer(
		appId: string,
		appPath: string,
		port: number,
	): Promise<ContainerInfo> {
		return this.createAndStartContainerInternal(appId, appPath, port, false);
	}

	/**
	 * Internal method to create and start a container with optional cleanup skip
	 * Now uses Docker Compose for orchestration
	 */
	private async createAndStartContainerInternal(
		appId: string,
		appPath: string,
		port: number,
		skipCleanup: boolean,
	): Promise<ContainerInfo> {
		const startTime = Date.now();
		const templateVersion = 'v8';

		// Sanitize appId for Docker names and file paths
		const dockerSafeId = this.sanitizeAppId(appId);

		const imageName = `airo-app-${dockerSafeId}:dev`;

		logger.info(`🏗️ Creating Docker Compose stack for app ${appId} (${templateVersion})`);

		try {
			// Ensure dev-supervisor image is available before building app image
			await this.ensureDevSupervisorImage();

			// Get host user info for proper file permissions
			const { uid, gid } = this.getHostUserInfo();
			logger.info(`📋 Building with host user mapping: UID=${uid}, GID=${gid}`);

			// Determine connection mode for dev-supervisor
			const useTcp = shouldUseTcpMode();
			let socketPath: string;

			if (useTcp) {
				// TCP mode - get pre-allocated supervisor port from DevDatabase
				const devApp = this.devDb.findDevAppById(appId);
				if (!devApp?.supervisorPort) {
					throw new Error(`Supervisor port not allocated for app ${appId}. Port should be allocated at app creation time.`);
				}
				socketPath = `tcp://localhost:${devApp.supervisorPort}`;
				logger.info(`📡 Using TCP mode for dev-supervisor: ${socketPath}`);
			} else {
				// Unix socket mode
				const hostSocketDir = `/tmp/dev-supervisor-${dockerSafeId}`;
				socketPath = `${hostSocketDir}/dev-supervisor.sock`;

				// Ensure socket directory exists and has correct permissions using safe fs operations
				// Use 777 permissions to allow container processes to write socket files
				try {
					mkdirSync(hostSocketDir, { recursive: true, mode: 0o777 });
				} catch (error) {
					logger.warn(`⚠️ Failed to create socket directory ${hostSocketDir}:`, error);
				}
				logger.info(`🔌 Using Unix socket mode for dev-supervisor: ${socketPath}`);
			}

			// Provision database in shared MySQL instance
			logger.info(`🗄️ Provisioning database for app ${appId} in shared MySQL`);
			const dbConfig = await this.sharedMySQLService.provisionDatabase(appId);

			// Write database credentials to .env file for host machine access
			this.writeDatabaseEnvFile(appPath, dbConfig);

			logger.info(`✅ Database provisioned for app ${appId}`);

			// Generate compose configuration
			const composeConfig: ComposeServiceConfig = {
				appId,
				appPort: port,
				templateVersion,
				appPath,
				imageName,
				uid,
				gid,
				useTcp,
				socketPath,
			};

			// Generate docker-compose.yml
			const composeContent = this.composeGenerator.generateComposeFile(composeConfig, dbConfig);

			// Write docker-compose.yml to app directory
			const composeFilePath = path.join(appPath, 'docker-compose.yml');
			writeFileSync(composeFilePath, composeContent, 'utf-8');

			logger.info(`✅ Generated docker-compose.yml for app ${appId}`);

			// Ensure any existing compose stack is removed (unless skipping cleanup)
			if (!skipCleanup) {
				try {
					await this.composeManager.down(appPath, true);
					logger.info(`🧹 Cleaned up existing compose stack for app ${appId}`);
				} catch (error) {
					// Stack doesn't exist, that's fine
					logger.info(`ℹ️ No existing compose stack to clean up for app ${appId}`);
				}
			}

			// Build the Docker image using Docker Compose
			logger.info(`📦 Building Docker image: ${imageName}`);
			await this.composeManager.build(appPath, false);
			logger.info(`✅ Docker image built successfully: ${imageName}`);

			// Start the compose stack
			logger.info(`🚀 Starting Docker Compose stack for app ${appId}`);
			await this.composeManager.up(appPath, true);

			logger.info(`✅ Docker Compose stack started for app ${appId}`);

			// Get app container ID
			const containerId = await this.composeManager.getContainerId(appPath, 'app');

			if (!containerId) {
				throw new Error('Failed to get container ID from compose stack');
			}

			logger.info(`✅ App container ID: ${containerId}`);

			const containerInfo: ContainerInfo = {
				appId,
				containerId,
				appPath,
				port,
				status: "running",
				imageName,
				createdAt: new Date(),
				socketPath,
			};

			// Store in memory and database
			this.containers.set(appId, containerInfo);
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info(`✅ Docker Compose stack created successfully for app ${appId} (${duration}ms)`);

			return containerInfo;
		} catch (error: any) {
			logger.error(`❌ Container creation failed for app ${appId}:`, error);

			// Clean up provisioned database if container creation failed
			try {
				await this.sharedMySQLService.dropDatabase(appId);
				logger.info(`🧹 Cleaned up database for failed app ${appId}`);
			} catch (dbCleanupError) {
				logger.warn(`⚠️ Failed to cleanup database for app ${appId}:`, dbCleanupError);
			}

			throw new Error(`Container creation failed: ${error.message}`);
		}
	}

	/**
	 * Stop a container (uses Docker Compose)
	 */
	async stopContainer(appId: string): Promise<boolean> {
		const startTime = Date.now();
		let containerInfo = this.containers.get(appId);
		if (!containerInfo) {
			containerInfo = this.getContainerFromDb(appId);
		}

		if (!containerInfo) {
			logger.warn(`⚠️ Container not found for stop operation: ${appId}`);
			return false;
		}

		logger.info(`🛑 Stopping Docker Compose stack for app ${appId}`);

		try {
			const appPath = this.getAppPath(appId);
			await this.composeManager.stop(appPath);

			containerInfo.status = "stopped";
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info(`✅ Compose stack stopped for app ${appId} (${duration}ms)`);

			return true;
		} catch (error: any) {
			logger.error(`❌ Failed to stop compose stack for app ${appId}:`, error);

			return false;
		}
	}

	/**
	 * Remove container completely (uses Docker Compose down)
	 */
	async removeContainer(appId: string): Promise<boolean> {
		const startTime = Date.now();
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			logger.warn(`⚠️ Container not found for remove operation: ${appId}`);
			return false;
		}

		logger.info(`🗑️ Removing Docker Compose stack for app ${appId}`);

		try {
			const appPath = this.getAppPath(appId);

			// Remove compose stack (includes all services, networks, and volumes)
			await this.composeManager.down(appPath, true);

			logger.info(`✅ Docker Compose stack removed for app ${appId}`);

			// Drop database and user from shared MySQL
			try {
				await this.sharedMySQLService.dropDatabase(appId);
				logger.info(`✅ Database dropped for app ${appId}`);
			} catch (dbError) {
				logger.warn(`⚠️ Failed to drop database for app ${appId}:`, dbError);
				// Continue with cleanup even if database drop fails
			}

			// Remove image
			try {
				await execAsync(`docker rmi ${containerInfo.imageName}`);
				logger.info(`🗑️ Docker image removed: ${containerInfo.imageName}`);
			} catch (imageError) {
				logger.info(`ℹ️ Docker image may be in use, skipping removal: ${containerInfo.imageName}`);
			}

			// Remove from memory and database
			this.containers.delete(appId);
			this.removeContainerFromDb(appId);

			const duration = Date.now() - startTime;

			logger.info(`✅ Compose stack removed for app ${appId} (${duration}ms)`);

			return true;
		} catch (error: any) {
			logger.error(`❌ Failed to remove compose stack for app ${appId}:`, error);

			return false;
		}
	}

	/**
	 * Get container status (uses Docker Compose ps)
	 */
	async getContainerStatus(appId: string): Promise<ContainerInfo | null> {
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			return null;
		}

		try {
			const appPath = this.getAppPath(appId);
			const composeStatus = await this.composeManager.ps(appPath);

			// Find app service status
			const appService = composeStatus.services.find(s => s.name === 'app' || s.name.includes('app'));

			if (!appService) {
				containerInfo.status = "error";
				return containerInfo;
			}

			// Map compose status to our status
			let status: ContainerInfo["status"];
			switch (appService.state) {
				case "running":
					status = "running";
					break;
				case "exited":
				case "stopped":
					status = "stopped";
					break;
				default:
					status = "error";
			}

			// Update if changed
			if (status !== containerInfo.status) {
				containerInfo.status = status;
				this.saveContainerToDb(containerInfo);
			}

			return containerInfo;
		} catch (error) {
			// Container doesn't exist anymore
			containerInfo.status = "error";
			return containerInfo;
		}
	}

	/**
	 * Get container logs (uses Docker Compose)
	 */
	async getContainerLogs(
		appId: string,
		tailLines: number = 100,
	): Promise<string> {
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			throw new Error(`No container found for app ${appId}`);
		}

		try {
			const appPath = this.getAppPath(appId);
			const logs = await this.composeManager.logs(appPath, {
				tail: tailLines,
				service: 'app',
			});
			return logs;
		} catch (error: any) {
			throw new Error(`Failed to get container logs: ${error.message}`);
		}
	}

	/**
	 * Restart container (uses Docker Compose)
	 */
	async restartContainer(appId: string): Promise<boolean> {
		const startTime = Date.now();
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			logger.warn(`⚠️ Container not found for restart operation: ${appId}`);
			return false;
		}

		logger.info(`🔄 Restarting Docker Compose stack for app ${appId}`);

		try {
			const appPath = this.getAppPath(appId);
			await this.composeManager.restart(appPath);

			containerInfo.status = "running";
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info(`✅ Compose stack restarted for app ${appId} (${duration}ms)`);

			return true;
		} catch (error: any) {
			logger.error(`❌ Failed to restart compose stack for app ${appId}:`, error);

			return false;
		}
	}

	/**
	 * List all containers
	 */
	getAllContainers(): ContainerInfo[] {
		// Get all container records from database
		const runningRecords = this.devDb.getRunningProcesses();
		const useTcp = shouldUseTcpMode();

		return runningRecords.map((record) => {
			const sanitizedId = this.sanitizeAppId(record.appId);
			let socketPath: string;

			if (useTcp) {
				const devApp = this.devDb.findDevAppById(record.appId);
				if (!devApp?.supervisorPort) {
					logger.warn(`⚠️ Supervisor port not found for app ${record.appId} during container listing`);
					socketPath = `tcp://localhost:8877`; // Use default port as fallback
				} else {
					socketPath = `tcp://localhost:${devApp.supervisorPort}`;
				}
			} else {
				socketPath = `/tmp/dev-supervisor-${sanitizedId}/dev-supervisor.sock`;
			}

			const containerInfo: ContainerInfo = {
				appId: record.appId,
				containerId: `container-${record.appId}`, // Docker containers would have real IDs
				appPath: this.getAppPath(record.appId),
				port: record.port,
				status: "running" as const,
				imageName: `airo-app-${sanitizedId}:dev`,
				createdAt: new Date(record.startedAt),
				socketPath,
			};

			return containerInfo;
		});
	}

	/**
	 * Get dev-supervisor connection path for an app
	 */
	getConnectionPath(appId: string): string | null {
		const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
		if (!containerInfo) {
			return null;
		}

		return containerInfo.socketPath;
	}

	/**
	 * Recover existing running compose stacks from previous session
	 */
	private async recoverExistingContainers(): Promise<void> {
		const startTime = Date.now();

		logger.info('🔍 Starting compose stack recovery process...');

		try {
		// Get all container records from database
		const containerRecords = this.getAllContainers();

			logger.info(`🔍 Found ${containerRecords.length} container records`);

			let recoveredCount = 0;
			let cleanedCount = 0;

			for (const record of containerRecords) {
				try {
					const appPath = this.getAppPath(record.appId);

					// Check if compose stack exists and is running
					const composeStatus = await this.composeManager.ps(appPath);

					if (composeStatus.anyRunning) {
						// Stack is running - recover it
						const safeAppId = this.sanitizeAppId(record.appId);
						const useTcp = shouldUseTcpMode();
						let socketPath: string;

						// Set supervisor connection info
						if (useTcp) {
							const devApp = this.devDb.findDevAppById(record.appId);
							if (!devApp?.supervisorPort) {
								logger.warn(`⚠️ Supervisor port not found for app ${record.appId} during recovery`);
								socketPath = `tcp://localhost:8877`; // Use default port as fallback
							} else {
								socketPath = `tcp://localhost:${devApp.supervisorPort}`;
							}
						} else {
							socketPath = `/tmp/dev-supervisor-${safeAppId}/dev-supervisor.sock`;
						}

						const containerInfo: ContainerInfo = {
							appId: record.appId,
							containerId: record.containerId,
							appPath,
							port: record.port,
							status: "running",
							imageName: record.imageName,
							createdAt: record.createdAt,
							socketPath,
						};

						// Add to in-memory tracking
						this.containers.set(record.appId, containerInfo);

						recoveredCount++;
						logger.info(`✅ Recovered running compose stack for app ${record.appId}`);
					} else {
						// Stack exists but stopped - clean it up
						try {
							await this.composeManager.down(appPath, false);
							this.removeContainerFromDb(record.appId);
							cleanedCount++;
							logger.info(`🧹 Cleaned up stopped compose stack for app ${record.appId}`);
						} catch (cleanupError) {
							logger.warn(`⚠️ Failed to clean up stopped compose stack for app ${record.appId}:`, cleanupError);
						}
					}
				} catch (inspectError) {
					// Compose stack doesn't exist - clean up database record
					this.removeContainerFromDb(record.appId);
					cleanedCount++;
					logger.info(`🧹 Cleaned up orphaned database record for app ${record.appId}`);
				}
			}

			const duration = Date.now() - startTime;

			logger.info(`✅ Compose stack recovery completed: ${recoveredCount} recovered, ${cleanedCount} cleaned (${duration}ms)`);
		} catch (error) {
			logger.error('❌ Compose stack recovery failed:', error);
		}
	}

	/**
	 * Ensure dev-supervisor image is built and available
	 */
	private async ensureDevSupervisorImage(): Promise<void> {
		const imageName = "airo-dev-supervisor:latest";

		try {
			// Check if image already exists
			await execAsync(`docker inspect ${imageName}`);
			logger.info(`✅ Dev-supervisor image already exists: ${imageName}`);
			return;
		} catch (error) {
			// Image doesn't exist, need to build it
			logger.info(`🏗️ Building dev-supervisor image: ${imageName}`);
		}

		try {
			// Build dev-supervisor image from the dev-supervisor directory
			// Need to build from project root so docker can access dev-supervisor/ directory
			// The app service runs from /app but dev-supervisor is in the parent directory
			const projectRoot = path.resolve(process.cwd(), "..");
			const buildCommand = `docker build -t ${imageName} -f dev-supervisor/Dockerfile dev-supervisor/`;

			logger.info(`🔧 Building dev-supervisor from project root: ${projectRoot}`);

			const buildProcess = execAsync(buildCommand, {
				cwd: projectRoot,
				maxBuffer: 1024 * 1024 * 10, // 10MB buffer for build output
			});

			// Show build progress
			buildProcess.child.stdout?.on("data", (data) => {
				logger.info(`[BUILD DEV-SUPERVISOR] ${data.toString().trim().substring(0, 200)}`);
			});

			await buildProcess;

			logger.info(`✅ Dev-supervisor image built successfully: ${imageName}`);
		} catch (error) {
			logger.error(`❌ Failed to build dev-supervisor image: ${imageName}`, error);
			throw new Error(
				`Failed to build dev-supervisor image: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Initialize database table for container tracking
	 */
	private initializeDatabase(): void {
		// Docker containers will use the same dev_apps and running_processes tables
		// The dev database already handles this initialization
		logger.info('✅ Docker database tables already initialized via DevDatabase');
	}

	/**
	 * Save container info to database
	 */
	private async saveContainerToDb(containerInfo: ContainerInfo): Promise<void> {
		// For Docker mode, we'll store container info in the running_processes table
		// with additional metadata
		try {
			// Ensure dev app record exists before adding process record
			const existingApp = this.devDb.findDevAppById(containerInfo.appId);
			if (!existingApp) {
				// Create dev app record if it doesn't exist
				this.devDb.createDevApp({
					appId: containerInfo.appId,
					port: containerInfo.port,
					appPath: this.getAppPath(containerInfo.appId), // Standard app path
					templateVersion: 'v8', // Default to latest template version
					status: 'running'
				});
			}

			this.devDb.addProcessRecord(
				containerInfo.appId,
				0, // Docker containers don't have traditional PIDs
				containerInfo.port
			);
		} catch (error) {
			logger.warn(`⚠️ Failed to save container info to database for app ${containerInfo.appId}:`, error);
		}
	}

	/**
	 * Get container from database
	 */
	private getContainerFromDb(appId: string): ContainerInfo | null {
		const runningRecords = this.devDb.getRunningProcesses();
		const record = runningRecords.find(r => r.appId === appId && r.status === 'running');

		if (!record) return null;

		const sanitizedId = this.sanitizeAppId(record.appId);
		const useTcp = shouldUseTcpMode();
		let socketPath: string;

		if (useTcp) {
			const devApp = this.devDb.findDevAppById(record.appId);
			if (!devApp?.supervisorPort) {
				logger.warn(`⚠️ Supervisor port not found for app ${record.appId} in database`);
				socketPath = `tcp://localhost:8877`; // Use default port as fallback
			} else {
				socketPath = `tcp://localhost:${devApp.supervisorPort}`;
			}
		} else {
			socketPath = `/tmp/dev-supervisor-${sanitizedId}/dev-supervisor.sock`;
		}

		const containerInfo: ContainerInfo = {
			appId: record.appId,
			containerId: `container-${record.appId}`,
			appPath: this.getAppPath(record.appId),
			port: record.port,
			status: "running",
			imageName: `airo-app-${sanitizedId}:dev`,
			createdAt: new Date(record.startedAt),
			socketPath,
		};

		return containerInfo;
	}

	/**
	 * Remove container from database
	 */
	private async removeContainerFromDb(appId: string): Promise<void> {
		this.devDb.removeProcessRecord(appId);
	}

	/**
	 * Get running containers as server info
	 */
	async getRunningServers(): Promise<Array<{
		appId: string;
		port: number;
		url: string;
		status: string;
		containerId: string;
		imageName: string;
	}>> {
		const runningServers: Array<{
			appId: string;
			port: number;
			url: string;
			status: string;
			containerId: string;
			imageName: string;
		}> = [];

		// Get running containers from database
		const runningRecords = this.devDb.getRunningProcesses();

		for (const record of runningRecords) {
			runningServers.push({
				appId: record.appId,
				port: record.port,
				url: `https://localhost:${record.port}`,
				status: record.status,
				containerId: `container-${record.appId}`,
				imageName: `airo-app-${record.appId}:dev`,
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
		const runningRecords = this.devDb.getRunningProcesses();

		logger.info(`🛑 Stopping all running containers: ${runningRecords.length} found`);

		for (const record of runningRecords) {
			try {
				const success = await this.stopContainer(record.appId);
				if (success) {
					stoppedCount++;
					logger.info(`✅ Successfully stopped container for app ${record.appId}`);
				}
			} catch (error) {
				logger.warn(`⚠️ Failed to stop container for app ${record.appId}:`, error);
			}
		}

		logger.info(`✅ Bulk container stop completed: ${stoppedCount}/${runningRecords.length} stopped`);

		return stoppedCount;
	}

	/**
	 * Get container status for a specific app (uses Docker Compose)
	 */
	async getAppContainerStatus(appId: string) {
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			return {
				status: "not_found",
				message: "No container found for this app",
			};
		}

		try {
			const appPath = this.getAppPath(appId);
			const composeStatus = await this.composeManager.ps(appPath);

			// Find app service
			const appService = composeStatus.services.find(s => s.name === 'app' || s.name.includes('app'));

			if (!appService) {
				// Clean up orphaned database record
				this.removeContainerFromDb(appId);

				return {
					status: "container_missing",
					message: "Compose stack record exists but service is missing - needs rebuild",
				};
			}

			return {
				status: appService.state, // Will be 'running', 'exited', 'dead', etc.
				containerId: containerInfo.containerId,
				port: containerInfo.port,
				imageName: containerInfo.imageName,
				url: `https://localhost:${containerInfo.port}`,
			};
		} catch (error) {
			// Container record exists in DB but compose stack is gone - should rebuild
			logger.warn(`⚠️ Container record exists but compose stack is missing for app ${appId}`);

			// Clean up orphaned database record
			this.removeContainerFromDb(appId);

			return {
				status: "container_missing",
				message:
					"Container record exists but compose stack is missing - needs rebuild",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Get container logs for a specific app
	 */
	async getAppContainerLogs(
		appId: string,
		lines: number = 100,
	): Promise<string> {
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			throw new Error("No container found for this app");
		}

		try {
			// Use Docker Compose to get logs for the app service
			return await this.composeManager.logs(containerInfo.appPath, {
				tail: lines,
				service: 'app',
			});
		} catch (error) {
			throw new Error(
				`Failed to get container logs: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Restart container for a specific app
	 */
	async restartAppContainer(appId: string): Promise<boolean> {
		const startTime = Date.now();
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			logger.warn(`⚠️ Container not found for app restart: ${appId}`);
			return false;
		}

		logger.info(`🔄 Restarting container for app ${appId}`);

		try {
			// Use Docker Compose to restart all services (app + db if present)
			await this.composeManager.restart(containerInfo.appPath);

			const duration = Date.now() - startTime;

			logger.info(`✅ Container restarted for app ${appId} (${duration}ms)`);

			return true;
		} catch (error) {
			logger.error(`❌ Container restart failed for app ${appId}:`, error);

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
	async rebuildAndStartContainer(
		appId: string,
		appPath: string,
		port: number,
	): Promise<ContainerInfo | null> {
		const startTime = Date.now();

		// Check if rebuild is already in progress for this app
		if (this.activeRebuilds.has(appId)) {
			logger.warn(`⚠️ Rebuild already in progress for app ${appId}, skipping duplicate request`);
			return null;
		}

		logger.info(`🏗️ Rebuilding container for app ${appId}...`);

		// Mark rebuild as in progress
		this.activeRebuilds.add(appId);

		try {
			// Validate that app path exists
			if (!existsSync(appPath)) {
				const pathError = new Error(`App directory not found: ${appPath}`);
				logger.error(`❌ App path validation failed for ${appId}:`, pathError);
				throw pathError;
			}

			// Check for Dockerfile
			const dockerfilePath = path.join(appPath, "Dockerfile.dev");
			if (!existsSync(dockerfilePath)) {
				const dockerfileError = new Error(
					`Dockerfile.dev not found in app directory: ${appPath}`,
				);
				logger.error(`❌ Dockerfile validation failed for ${appId}:`, dockerfileError);
				throw dockerfileError;
			}

			// Clean up any existing container/image first
			await this.cleanupContainerAndImage(appId);

			// Create new container - skip cleanup since we just did it
			const containerInfo = await this.createAndStartContainerSkipCleanup(
				appId,
				appPath,
				port,
			);

			const duration = Date.now() - startTime;

			logger.info(`✅ Container rebuild completed for app ${appId} (${duration}ms)`);

			return containerInfo;
		} catch (error) {
			logger.error(`❌ Container rebuild failed for app ${appId}:`, error);

			throw error;
		} finally {
			// Always remove the rebuild lock
			this.activeRebuilds.delete(appId);
		}
	}

	/**
	 * Clean up compose stack and associated image
	 */
	private async cleanupContainerAndImage(appId: string): Promise<void> {
		const dockerSafeId = this.sanitizeAppId(appId);
		const appPath = this.getAppPath(appId);

		const imageName = `airo-app-${dockerSafeId}:dev`;

		// Remove any existing compose stack
		await this.ensureComposeStackRemoved(appPath);

		try {
			// Remove image if it exists to force rebuild
			await execAsync(`docker rmi -f ${imageName}`);
			logger.info(`🗑️ Removed existing image for rebuild: ${imageName}`);
		} catch (error) {
			// Image doesn't exist, that's fine
			logger.info(`ℹ️ Image removal skipped, likely did not exist: ${imageName}`);
		}

		// Clean database record
		this.removeContainerFromDb(appId);
	}

	/**
	 * Force cleanup orphaned compose stacks
	 */
	async forceCleanupOrphans(): Promise<number> {
		const startTime = Date.now();
		let cleanedCount = 0;

		logger.info('🧹 Starting force cleanup of orphaned compose stacks...');

		try {
			// Get all containers from database
			const allContainers = this.getAllContainers();

			logger.info(`🔍 Found ${allContainers.length} container records`);

			for (const containerRecord of allContainers) {
				try {
					const appPath = this.getAppPath(containerRecord.appId);
					const composeStatus = await this.composeManager.ps(appPath);

					if (!composeStatus.anyRunning) {
						// Stack exists but is stopped, remove it
						await this.composeManager.down(appPath, true);
						this.removeContainerFromDb(containerRecord.appId);
						cleanedCount++;
						logger.info(`🧹 Cleaned up stopped compose stack for app ${containerRecord.appId}`);
					}
				} catch (error) {
					// Stack doesn't exist, remove database record
					this.removeContainerFromDb(containerRecord.appId);
					cleanedCount++;
					logger.info(`🧹 Cleaned up orphaned database record for app ${containerRecord.appId}`);
				}
			}

			const duration = Date.now() - startTime;

			logger.info(`✅ Force cleanup completed: ${cleanedCount} cleaned (${duration}ms)`);

			return cleanedCount;
		} catch (error) {
			logger.error('❌ Force cleanup failed:', error);

			return cleanedCount;
		}
	}
}
