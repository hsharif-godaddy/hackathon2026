import { logger } from '../../request-context';
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { DevDatabase } from '../database/DevDatabase';
import os from "node:os";

const execAsync = promisify(exec);

export interface ContainerInfo {
	appId: string;
	containerId: string;
	port: number;
	status: "building" | "running" | "stopped" | "error";
	imageName: string;
	createdAt: Date;
	hostSocketPath?: string; // Path to dev-supervisor socket on host filesystem
}

/**
 * Docker Container Manager for All Template Apps
 * Manages Docker containers for development apps (v1, v2, v3, etc.)
 */
export class DockerContainerManager {
	private devDb: DevDatabase;
	private containers = new Map<string, ContainerInfo>();
	private initialized = false;
	private activeRebuilds = new Set<string>(); // Track ongoing rebuilds

	constructor(devDb: DevDatabase) {
		this.devDb = devDb;
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
	 * Detect template version from app path
	 */
	private detectTemplateVersion(appPath: string): string {
		try {
			if (existsSync(path.join(appPath, ".version"))) {
				return readFileSync(path.join(appPath, ".version"), "utf8").trim();
			}
			// Check for v3 indicators (Vite config, dev-start.js script)
			if (
				existsSync(path.join(appPath, "vite.config.ts")) ||
				existsSync(path.join(appPath, "vite.config.js")) ||
				existsSync(path.join(appPath, "scripts/dev-start.js"))
			) {
				return "v3";
			}

			// Check for v2 indicators (Next.js with Turbopack)
			const packageJsonPath = path.join(appPath, "package.json");
			if (existsSync(packageJsonPath)) {
				const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
				if (packageJson.scripts?.dev?.includes("--turbopack")) {
					return "v2";
				}
			}

			// Default to v1 (basic Next.js)
			return "v1";
		} catch (error) {
			logger.warn("Could not detect template version, defaulting to v1", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			return "v1";
		}
	}

	/**
	 * Get the current host user's UID and GID for proper file permissions in containers
	 */
	private getHostUserInfo(): { uid: number; gid: number } {
		try {
			// Get current user info
			const userInfo = os.userInfo();
			return {
				uid: userInfo.uid,
				gid: userInfo.gid
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

			throw new Error("Docker is not installed or not available in PATH");
		}
	}

	/**
	 * Ensure a container is completely removed with proper wait time
	 */
	private async ensureContainerRemoved(containerName: string): Promise<void> {
		try {
			// Get all containers (running and stopped) with this exact name
			const { stdout } = await execAsync(
				`docker ps -aq --filter name=^${containerName}$`,
			);
			const containerIds = stdout
				.trim()
				.split("\n")
				.filter((id) => id.length > 0);

			if (containerIds.length > 0) {
				logger.info(`🗑️ Removing existing Docker containers: ${containerName}`);

				await execAsync(`docker rm -f ${containerIds.join(" ")}`);

				logger.info(`⏳ Waiting for Docker daemon to release name: ${containerName}`);

				// Wait for Docker daemon to fully release the name
				await new Promise((resolve) => setTimeout(resolve, 2000));

				// Verify the name is actually free
				const { stdout: verifyStdout } = await execAsync(
					`docker ps -aq --filter name=^${containerName}$`,
				);
				if (verifyStdout.trim()) {
					throw new Error(
						`Container name ${containerName} is still in use after removal`,
					);
				}
			}
		} catch (error: any) {
			if (
				!error.message?.includes("Container name") &&
				!error.message?.includes("No such container")
			) {
				// Only log if it's not a "name still in use" error (which we want to propagate)
				// or "no such container" error (which is expected)
				logger.info(`ℹ️ Container cleanup info for ${containerName}:`, error.message || "completed");
			} else {
				throw error; // Re-throw critical errors
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
	 */
	private async createAndStartContainerInternal(
		appId: string,
		appPath: string,
		port: number,
		skipCleanup: boolean,
	): Promise<ContainerInfo> {
		const startTime = Date.now();
		const templateVersion = this.detectTemplateVersion(appPath);

		// Sanitize appId for Docker names and file paths
		const dockerSafeId = this.sanitizeAppId(appId);

		const imageName = `airo-app-${dockerSafeId}:dev`;
		const containerName = `airo-app-${dockerSafeId}`;

		logger.info(`🏗️ Creating Docker container for app ${appId} (${templateVersion})`);

		try {
			// Ensure dev-supervisor image is available before building app image
			await this.ensureDevSupervisorImage();

			// Get host user info for proper file permissions
			const { uid, gid } = this.getHostUserInfo();
			logger.info(`📋 Building with host user mapping: UID=${uid}, GID=${gid}`);

			// Build the Docker image
			logger.info(`📦 Building Docker image: ${imageName}`);

			const buildCommand = `docker build -f Dockerfile.dev --build-arg HOST_UID=${uid} --build-arg HOST_GID=${gid} -t ${imageName} .`;

			const buildProcess = execAsync(buildCommand, {
				cwd: appPath,
				maxBuffer: 1024 * 1024 * 10, // 10MB buffer for build output
			});

			// Show build progress (keep minimal logging during build)
			buildProcess.child.stdout?.on("data", (data) => {
				logger.info(`[BUILD ${appId}] ${data.toString().trim().substring(0, 200)}`);
			});

			await buildProcess;
			logger.info(`✅ Docker image built successfully: ${imageName}`);

			// Ensure any existing container is properly removed (unless skipping cleanup)
			if (!skipCleanup) {
				await this.ensureContainerRemoved(containerName);
			}

			// Create and start the container with volume mounting for live development
			logger.info(`🚀 Starting Docker container: ${containerName} on port ${port}`);

			// Create unique socket directory for this app on the host using sanitized ID
			const hostSocketDir = `/tmp/dev-supervisor-${dockerSafeId}`;
			const hostSocketPath = `${hostSocketDir}/dev-supervisor.sock`;

			// Ensure socket directory exists and has correct permissions using safe fs operations
			// Use 777 permissions to allow container processes to write socket files
			try {
				mkdirSync(hostSocketDir, { recursive: true, mode: 0o777 });
			} catch (error) {
				logger.warn(`⚠️ Failed to create socket directory ${hostSocketDir}:`, error);
			}

			const templateSpecific = [];
			switch (templateVersion) {
				case "v2":
					templateSpecific.push(
						"-e NEXT_TELEMETRY_DISABLED=1",
						`-v /app/.next`, // anonymous volume for Next.js .next directory
						`-p ${port}:3000`,
					);
					break;
				case "v3":
					templateSpecific.push(
						`-e PREFERRED_FRONTEND_PORT=${port}`,
						`-e VITE_HOST=0.0.0.0`, // Make Vite accessible from outside container
						`-e RUNNING_IN_DOCKER=true`, // Flag for v3 template to detect Docker environment
						`-e VITE_PARENT_ORIGIN=http://localhost:3000`, // Set secure parent origin for postMessage
						`-v /app/dist`,
						`-p ${port}:${port}`
					);
					break;
				case "v7":
					templateSpecific.push(
						`-e PORT=${port}`,
						`-e VITE_HOST=0.0.0.0`,
						`-v /app/dist`,
						`-p ${port}:${port}`
					);
					break;
				case "v8":
					templateSpecific.push(
						`-e PORT=${port}`,
						`-e VITE_HOST=0.0.0.0`,
						`-e ALLOWED_ORIGINS=http://localhost:3000,https://localhost:3000`,
						`-v /app/dist`,
						`-p ${port}:${port}`
					);
					break;
			}

			const runCommand = [
				"docker run -d",
				`--name ${containerName}`,
				`-v "${appPath}:/app"`, // Mount app directory for live editing
				`-v /app/node_modules`, // Anonymous volume for node_modules to avoid conflicts
				`-v "${hostSocketDir}:/tmp/supervisor"`, // Mount socket directory for dev-supervisor communication
				...templateSpecific,
				"-e HOST=0.0.0.0",
				"-e NODE_ENV=development",
				"-e DEV_SUPERVISOR_SOCKET_PATH=/tmp/supervisor/dev-supervisor.sock", // Configure dev-supervisor socket path inside container
				"--restart unless-stopped",
				imageName,
			].join(" ");

			const { stdout: containerId } = await execAsync(runCommand);
			const cleanContainerId = containerId.trim();

			const containerInfo: ContainerInfo = {
				appId,
				containerId: cleanContainerId,
				port,
				status: "running",
				imageName,
				createdAt: new Date(),
				hostSocketPath,
			};

			// Store in memory and database
			this.containers.set(appId, containerInfo);
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info(`✅ Docker container created successfully for app ${appId} (${duration}ms)`);

			return containerInfo;
		} catch (error: any) {
			logger.error(`❌ Container creation failed for app ${appId}:`, error);

			throw new Error(`Container creation failed: ${error.message}`);
		}
	}

	/**
	 * Stop a container
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

		logger.info(`🛑 Stopping Docker container for app ${appId}`);

		try {
			await execAsync(`docker stop ${containerInfo.containerId}`);

			containerInfo.status = "stopped";
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info(`✅ Container stopped for app ${appId} (${duration}ms)`);

			return true;
		} catch (error: any) {
			logger.error(`❌ Failed to stop container for app ${appId}:`, error);

			return false;
		}
	}

	/**
	 * Remove container completely
	 */
	async removeContainer(appId: string): Promise<boolean> {
		const startTime = Date.now();
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			logger.warn(`⚠️ Container not found for remove operation: ${appId}`);
			return false;
		}

		logger.info(`🗑️ Removing Docker container for app ${appId}`);

		try {
			// Force remove container (stops if running)
			await execAsync(`docker rm -f ${containerInfo.containerId}`);

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

			logger.info(`✅ Container removed for app ${appId} (${duration}ms)`);

			return true;
		} catch (error: any) {
			logger.error(`❌ Failed to remove container for app ${appId}:`, error);

			return false;
		}
	}

	/**
	 * Get container status
	 */
	async getContainerStatus(appId: string): Promise<ContainerInfo | null> {
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			return null;
		}

		try {
			// Check actual Docker status
			const { stdout } = await execAsync(
				`docker inspect --format='{{.State.Status}}' ${containerInfo.containerId}`,
			);
			const dockerStatus = stdout.trim();

			// Map Docker status to our status
			let status: ContainerInfo["status"];
			switch (dockerStatus) {
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
	 * Get container logs
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
			const { stdout } = await execAsync(
				`docker logs --tail ${tailLines} ${containerInfo.containerId}`,
			);
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
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);

		if (!containerInfo) {
			logger.warn(`⚠️ Container not found for restart operation: ${appId}`);
			return false;
		}

		logger.info(`🔄 Restarting Docker container for app ${appId}`);

		try {
			await execAsync(`docker restart ${containerInfo.containerId}`);

			containerInfo.status = "running";
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info(`✅ Container restarted for app ${appId} (${duration}ms)`);

			return true;
		} catch (error: any) {
			logger.error(`❌ Failed to restart container for app ${appId}:`, error);

			return false;
		}
	}

	/**
	 * List all containers
	 */
	getAllContainers(): ContainerInfo[] {
		// Get all container records from database
		const runningRecords = this.devDb.getRunningProcesses();
		
		return runningRecords.map((record) => ({
			appId: record.appId,
			containerId: `container-${record.appId}`, // Docker containers would have real IDs
			port: record.port,
			status: "running" as const,
			imageName: `airo-app-${record.appId}:dev`,
			hostSocketPath: `/tmp/dev-supervisor-${record.appId}/dev-supervisor.sock`,
			createdAt: new Date(record.startedAt),
		}));
	}

	/**
	 * Recover existing running containers from previous session
	 */
	private async recoverExistingContainers(): Promise<void> {
		const startTime = Date.now();

		logger.info('🔍 Starting container recovery process...');

		try {
		// Get all container records from database
		const containerRecords = this.getAllContainers();

			logger.info(`🔍 Found ${containerRecords.length} container records`);

			let recoveredCount = 0;
			let cleanedCount = 0;

			for (const record of containerRecords) {
				try {
					// Check if container is still running
					const { stdout } = await execAsync(
						`docker inspect ${record.containerId} --format='{{.State.Status}}'`,
					);
					const dockerStatus = stdout.trim();

					if (dockerStatus === "running") {
						// Container is running - recover it
						const safeAppId = this.sanitizeAppId(record.appId);
						const hostSocketPath =
							record.hostSocketPath ||
							`/tmp/dev-supervisor-${safeAppId}/dev-supervisor.sock`;
						const containerInfo: ContainerInfo = {
							appId: record.appId,
							containerId: record.containerId,
							port: record.port,
							status: "running",
							imageName: record.imageName,
							hostSocketPath,
							createdAt: record.createdAt,
						};

						// Add to in-memory tracking
						this.containers.set(record.appId, containerInfo);

						recoveredCount++;
						logger.info(`✅ Recovered running container for app ${record.appId}`);
					} else if (dockerStatus === "exited" || dockerStatus === "dead") {
						// Container exists but stopped - remove it and clean database
						try {
							await execAsync(`docker rm -f ${record.containerId}`);
							this.removeContainerFromDb(record.appId);
							cleanedCount++;
							logger.info(`🧹 Cleaned up stopped container for app ${record.appId}`);
						} catch (cleanupError) {
							logger.warn(`⚠️ Failed to clean up stopped container for app ${record.appId}:`, cleanupError);
						}
					}
				} catch (inspectError) {
					// Container doesn't exist - clean up database record
					this.removeContainerFromDb(record.appId);
					cleanedCount++;
					logger.info(`🧹 Cleaned up orphaned database record for app ${record.appId}`);
				}
			}

			const duration = Date.now() - startTime;

			logger.info(`✅ Container recovery completed: ${recoveredCount} recovered, ${cleanedCount} cleaned (${duration}ms)`);
		} catch (error) {
			logger.error('❌ Container recovery failed:', error);
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
					appPath: `/tmp/apps/${containerInfo.appId}`, // Standard app path
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

		return {
			appId: record.appId,
			containerId: `container-${record.appId}`,
			port: record.port,
			status: "running",
			imageName: `airo-app-${record.appId}:dev`,
			hostSocketPath: `/tmp/dev-supervisor-${record.appId}/dev-supervisor.sock`,
			createdAt: new Date(record.startedAt),
		};
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
				url: `http://localhost:${record.port}`,
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
	 * Get container status for a specific app
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
			// Check actual container status with Docker
			const { stdout } = await execAsync(
				`docker inspect ${containerInfo.containerId} --format='{{.State.Status}}'`,
			);
			const dockerStatus = stdout.trim();

			return {
				status: dockerStatus, // Will be 'running', 'exited', 'dead', etc.
				containerId: containerInfo.containerId,
				port: containerInfo.port,
				imageName: containerInfo.imageName,
				url: `http://localhost:${containerInfo.port}`,
			};
		} catch (error) {
			// Container record exists in DB but Docker container is gone - should rebuild
			logger.warn(`⚠️ Container record exists but Docker container is missing for app ${appId}`);

			// Clean up orphaned database record
			this.removeContainerFromDb(appId);

			return {
				status: "container_missing",
				message:
					"Container record exists but Docker container is missing - needs rebuild",
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
			const { stdout } = await execAsync(
				`docker logs --tail ${lines} ${containerInfo.containerId}`,
			);
			return stdout;
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
			await execAsync(`docker restart ${containerInfo.containerId}`);

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
	 * Clean up container and associated image
	 */
	private async cleanupContainerAndImage(appId: string): Promise<void> {
		const dockerSafeId = this.sanitizeAppId(appId);

		const imageName = `airo-app-${dockerSafeId}:dev`;
		const containerName = `airo-app-${dockerSafeId}`;

		// Remove any existing containers using the robust method
		await this.ensureContainerRemoved(containerName);

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
	 * Get the host socket path for a specific app
	 */
	getHostSocketPath(appId: string): string | null {
		const containerInfo = this.containers.get(appId) || this.getContainerFromDb(appId);
		return containerInfo?.hostSocketPath || null;
	}

	/**
	 * Force cleanup orphaned containers
	 */
	async forceCleanupOrphans(): Promise<number> {
		const startTime = Date.now();
		let cleanedCount = 0;

		logger.info('🧹 Starting force cleanup of orphaned containers...');

		try {
			// Get all containers from database
			const allContainers = this.getAllContainers();

			logger.info(`🔍 Found ${allContainers.length} container records`);

			for (const containerRecord of allContainers) {
				try {
					// Check if container actually exists
					const { stdout } = await execAsync(
						`docker inspect ${containerRecord.containerId} --format='{{.State.Status}}'`,
					);
					const dockerStatus = stdout.trim();

					if (dockerStatus === "exited" || dockerStatus === "dead") {
						// Container exists but is stopped, remove it
						await execAsync(`docker rm -f ${containerRecord.containerId}`);
						this.removeContainerFromDb(containerRecord.appId);
						cleanedCount++;
						logger.info(`🧹 Cleaned up stopped container for app ${containerRecord.appId}`);
					}
				} catch (error) {
					// Container doesn't exist, remove database record
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