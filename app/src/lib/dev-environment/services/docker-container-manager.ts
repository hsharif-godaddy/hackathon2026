import * as fs from "node:fs";
import { userInfo } from "node:os";
import * as path from "node:path";

import { execa } from 'execa';
import { existsSync, mkdirSync, writeFileSync } from "fs";

import { type ComposeServiceConfig, DockerComposeGenerator } from './docker-compose-generator';
import { DockerComposeManager } from './docker-compose-manager';
import { SharedMySQLService } from './shared-mysql-service';
import { auth, devSupervisor } from '../../features';
import { logger } from '../../request-context';
import { DevDatabase } from '../database/DevDatabase';
import { getAllocPath, getAppPath, getBasePath } from '../utils/app-paths';
import { ConfigJsonManager } from '../utils/config-json';

/**
 * Determine if TCP mode should be used for dev-supervisor
 * Uses centralized features module and ensures development-only usage
 */
function shouldUseTcpMode(): boolean {
	return devSupervisor.shouldUseTcp();
}

/**
 * Determine if JWT authentication should be enabled for dev-supervisor
 * Only enabled when AUTH_TYPE is explicitly set to 'jwt'
 */
function shouldEnableJwtAuth(): boolean {
	return auth.isJWT();
}

/**
 * Get TCP port for dev-supervisor
 */
// Commented out - reserved for future use
// function getTcpPort(): string {
// 	return devSupervisor.getTcpPort();
// }


export interface ContainerInfo {
	appId: string;
	containerId: string;
	appPath: string; // Base path /tmp/apps/{appId} (needed for compose operations)
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
	private static instance: DockerContainerManager | null = null;
	private static initializationPromise: Promise<void> | null = null;

	private devDb: DevDatabase;
	private composeGenerator: DockerComposeGenerator;
	private composeManager: DockerComposeManager;
	private sharedMySQLService: SharedMySQLService;
	private containers = new Map<string, ContainerInfo>();
	private initialized = false;
	private activeRebuilds = new Set<string>(); // Track ongoing rebuilds

	private constructor(devDb: DevDatabase) {
		this.devDb = devDb;
		this.composeGenerator = new DockerComposeGenerator();
		this.composeManager = new DockerComposeManager();
		this.sharedMySQLService = new SharedMySQLService();
	}

	/**
	 * Get or create singleton instance
	 */
	static getInstance(devDb: DevDatabase): DockerContainerManager {
		if (!DockerContainerManager.instance) {
			DockerContainerManager.instance = new DockerContainerManager(devDb);
		}
		return DockerContainerManager.instance;
	}

	/**
	 * Sanitize app ID for safe use in file paths and Docker container names
	 *
	 * **Security Critical**: Removes/replaces invalid characters to prevent:
	 * - Path traversal attacks (e.g., `../../../etc/passwd`)
	 * - Command injection via Docker container names
	 * - File system violations and directory escapes
	 *
	 * **Docker Naming Requirements**: Docker container names must follow strict rules:
	 * - Only characters: `[a-z0-9.-]`
	 * - Cannot start or end with `.` or `-`
	 * - Maximum length: 63 characters
	 *
	 * **Transformation Process**:
	 * 1. Convert to lowercase (Docker requirement)
	 * 2. Remove all characters except `[a-z0-9.-]` (including underscores)
	 * 3. Strip leading/trailing dots and dashes
	 * 4. Truncate to 63 characters
	 *
	 * @param appId - Raw application ID from user input or database (potentially unsafe)
	 *
	 * @returns Sanitized app ID safe for use in Docker names and file paths (max 63 chars)
	 *
	 * @example
	 * ```typescript
	 * const safe1 = this.sanitizeAppId('My_App!@#123');
	 * // Returns: 'myapp123'
	 *
	 * const safe2 = this.sanitizeAppId('../../../malicious');
	 * // Returns: 'malicious'
	 *
	 * const safe3 = this.sanitizeAppId('valid-app.name-123');
	 * // Returns: 'valid-app.name-123'
	 * ```
	 *
	 * @remarks
	 * - Used for Docker container names, compose project names, and file paths
	 * - Always call this before using appId in Docker commands or file operations
	 * - Underscores are explicitly removed (not Docker-compliant despite being valid in some contexts)
	 * - Empty or whitespace-only input will result in empty string
	 *
	 * @see {@link https://docs.docker.com/engine/reference/commandline/container_create/} Docker naming rules
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
	 * Initialize the container manager
	 * Runs recovery only once on first initialization
	 */
	async initialize(): Promise<void> {
		// If already initialized, return immediately
		if (this.initialized) return;

		// If initialization is in progress, wait for it
		if (DockerContainerManager.initializationPromise) {
			return DockerContainerManager.initializationPromise;
		}

		// Start initialization
		DockerContainerManager.initializationPromise = this.doInitialize();

		try {
			await DockerContainerManager.initializationPromise;
		} finally {
			// Clear the promise so subsequent calls just check initialized flag
			DockerContainerManager.initializationPromise = null;
		}
	}

	/**
	 * Internal initialization method
	 */
	private async doInitialize(): Promise<void> {
		try {
			// Check if Docker is available
			await execa('docker', ['--version']);

			// Check if Docker Compose is available
			await execa('docker', ['compose', 'version']);

			// Initialize shared MySQL service (also ensures network exists and connects MySQL container)
			await this.sharedMySQLService.initialize();

			// Initialize database table
			this.initializeDatabase();			// Recover any existing running containers (ONLY on first initialization)
			await this.recoverExistingContainers();

			this.initialized = true;
		} catch (error) {
			logger.error('docker-container-manager.init.failed', {
				error: error instanceof Error ? error.message : String(error)
			});

			throw new Error("Docker or Docker Compose is not installed or not available in PATH");
		}
	}

	/**
	 * Ensure a compose stack is completely removed with proper cleanup
	 * Replaces the old ensureContainerRemoved method
	 */
	private async ensureComposeStackRemoved(basePath: string): Promise<void> {
		try {
			logger.info('docker.compose.stack.remove.begin', {
				basePath,
				message: 'Ensuring compose stack is removed'
			});

			await this.composeManager.down(basePath, true);

			logger.info('docker.compose.stack.remove.success', {
				basePath
			});
		} catch (error: any) {
			if (!error.message?.includes("No such file") && !error.message?.includes("not found")) {
				// Only log if it's not a "file not found" error (which is expected)
				logger.info('docker.compose.stack.cleanup.info', {
					error: error.message || "completed",
					basePath
				});
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
	 * Ensure shared template image exists
	 *
	 * **Performance Optimization**: Builds the template image once and reuses it for all apps,
	 * reducing app creation time from ~72s to <5s. This is one of the most critical performance
	 * optimizations in the system.
	 *
	 * **Docker Layer Caching**: Relies on Docker's built-in layer caching to avoid unnecessary
	 * rebuilds. Docker automatically detects changes in COPY operations and only rebuilds layers
	 * that have changed. This means:
	 * - Template dependency changes (package.json/package-lock.json) → rebuild npm install layer
	 * - Dev-supervisor changes (*.go, go.mod, go.sum) → rebuild Go binary layer
	 * - No changes → all layers cached, build completes in <1 second
	 *
	 * @param templateVersion - Template version identifier (e.g., 'v8')
	 * @param appBasePath - Base path for the app (currently unused, reserved for future use)
	 *
	 * @returns Promise that resolves when image is available and ready for use
	 *
	 * @throws {Error} If Docker build fails (daemon issues, Dockerfile errors, etc.)
	 *
	 * @example
	 * ```typescript
	 * await this.ensureTemplateImage('v8', '/tmp/apps/my-app');
	 * // Image 'aab-template-v8:latest' is now available
	 * // Subsequent calls will use Docker's layer cache for fast builds
	 * ```
	 *
	 * @remarks
	 * - Template directory location from `APP_TEMPLATE_DIR` env var or defaults to 'app-templates/v8'
	 * - Build includes dev-supervisor and template in a single multi-stage build
	 * - Docker's content-based layer caching ensures fast rebuilds when nothing changes
	 */
	private async ensureTemplateImage(templateVersion: string, _appBasePath: string): Promise<void> {
		const imageName = `aab-template-${templateVersion}:latest`;

		try {
			const templateDir = process.env.APP_TEMPLATE_DIR || 'app-templates/v8';
			const projectRoot = path.resolve(process.cwd(), '..');
			const templatePath = path.join(projectRoot, templateDir);

			logger.info("template.image.build.begin", {
				imageName,
				templatePath,
			});

			// Get host user info for build args
			const { uid, gid } = this.getHostUserInfo();

			// Build using docker buildx (relies on Docker's layer caching)
			// Docker will automatically use cached layers when source files haven't changed
			// Use array-based arguments to prevent shell injection
			// Build dev-supervisor and template in one go using build contexts
			// --load flag imports the built image into Docker daemon (required for Docker Compose)
			const startTime = Date.now();
		await execa('docker', [
			'buildx', 'build',
			'-t', imageName,
			'--load',
			'--build-arg', `HOST_UID=${uid}`,
			'--build-arg', `HOST_GID=${gid}`,
			'--build-context', `dev-ca=${path.join(projectRoot, '.dev-ca')}`,
			'--build-context', `dev-supervisor=${path.join(projectRoot, 'dev-supervisor')}`,
			'-f', path.join(templatePath, 'Dockerfile.dev'),
			templatePath
		]);
			const duration = Date.now() - startTime;

			logger.info("template.image.build.success", {
				imageName,
				duration,
			});
		} catch (error) {
			logger.error("template.image.build.failure", {
				imageName,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to build template image: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Ensure the publish image exists by always invoking a Docker build
	 * Relies on Docker's layer caching so that unchanged layers are reused efficiently
	 *
	 * The publish image contains only the runtime environment and publish scripts,
	 * with NO app template source code, matching production architecture.
	 *
	 * @returns Promise that resolves when image is available and ready for use
	 * @throws {Error} If Docker build fails
	 */
	private async ensurePublishImage(): Promise<void> {
		const imageName = 'aab-publish:latest';

		try {
			const projectRoot = path.resolve(process.cwd(), '..');
			const publishPath = path.join(projectRoot, 'app-publish');

			logger.info("publish.image.build.begin", {
				imageName,
				publishPath,
			});

			// Get host user info for build args (same as preview image)
			const { uid, gid } = this.getHostUserInfo();

			// Build using docker buildx with layer caching
			// Use --build-context to mount dev-supervisor separately
			// This allows app-publish to be the main context with its own .dockerignore
			const startTime = Date.now();
			await execa('docker', [
				'buildx', 'build',
				'-t', imageName,
				'--load',
				'--build-arg', `HOST_UID=${uid}`,
				'--build-arg', `HOST_GID=${gid}`,
				'--build-context', `dev-supervisor=${path.join(projectRoot, 'dev-supervisor')}`,
				'-f', path.join(publishPath, 'Dockerfile.dev'),
				publishPath
			]);
			const duration = Date.now() - startTime;

			logger.info("publish.image.build.success", {
				imageName,
				duration,
			});
		} catch (error) {
			logger.error("publish.image.build.failure", {
				imageName,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to build publish image: ${error instanceof Error ? error.message : String(error)}`);
		}
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

		// Use shared template image instead of per-app images for faster creation
		const imageName = `aab-template-${templateVersion}:latest`;

		logger.info('docker.compose.stack.create.begin', {
			appId,
			templateVersion,
			message: 'Creating Docker Compose stack for app'
		});

		try {
			// Get host user info for proper file permissions
			const { uid, gid } = this.getHostUserInfo();
			logger.info('docker.build.user_mapping', {
				appId,
				uid,
				gid,
				message: `Building with host user mapping: UID=${uid}, GID=${gid}`
			});

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
				logger.info('dev_supervisor.mode.tcp', {
					appId,
					socketPath,
					message: 'Using TCP mode for dev-supervisor'
				});
			} else {
				// Unix socket mode
				const hostSocketDir = `/tmp/dev-supervisor-${dockerSafeId}`;
				socketPath = `${hostSocketDir}/dev-supervisor.sock`;

				// Ensure socket directory exists and has correct permissions using safe fs operations
				// Use 777 permissions to allow container processes to write socket files
				try {
					mkdirSync(hostSocketDir, { recursive: true, mode: 0o777 });
				} catch (error) {
					logger.warn('dev_supervisor.socket_dir.create.failure', {
						appId,
						hostSocketDir,
						error: error instanceof Error ? error.message : String(error),
						message: 'Failed to create socket directory'
					});
				}
				logger.info('dev_supervisor.mode.unix_socket', {
					appId,
					socketPath,
					message: 'Using Unix socket mode for dev-supervisor'
				});
			}

			// Provision database in shared MySQL instance
			logger.info('database.provision.begin', {
				appId,
				message: 'Provisioning database in shared MySQL'
			});
			const dbConfig = await this.sharedMySQLService.provisionDatabase(appId);

			// Read OAuth credentials from environment if available
			const oauthConfig = process.env.GODADDY_OAUTH_CLIENT_ID && process.env.GODADDY_OAUTH_CLIENT_SECRET
				? {
						clientId: process.env.GODADDY_OAUTH_CLIENT_ID,
						clientSecret: process.env.GODADDY_OAUTH_CLIENT_SECRET,
				  }
				: undefined;

			// Write config.json with database and OAuth credentials to alloc directory
			const allocPath = getAllocPath(appId);
			const configPath = path.join(allocPath, 'config.json');
			ConfigJsonManager.writeConfigFile(configPath, dbConfig, oauthConfig);

			logger.info('database.provision.success', {
				appId
			});

			// Get publish ports from DevDatabase for V4 unified job
			const devApp = this.devDb.findDevAppById(appId);
			const publishSupervisorPort = devApp?.publishSupervisorPort;
			const publishPort = devApp?.publishPort;

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
				publishSupervisorPort,
				publishPort,
				enableJwtAuth: shouldEnableJwtAuth(),
			};

			// Generate docker-compose.yml
			const composeContent = this.composeGenerator.generateComposeFile(composeConfig);

			// Write docker-compose.yml to base directory (not in app or alloc subdirectories)
			const basePath = getBasePath(appId);
			const composeFilePath = path.join(basePath, 'docker-compose.yml');
			writeFileSync(composeFilePath, composeContent, 'utf-8');

			logger.info('docker.compose.generate.success', {
				appId,
				composeFilePath
			});

			// Ensure any existing compose stack is removed (unless skipping cleanup)
			if (!skipCleanup) {
				try {
					await this.composeManager.down(basePath, true);
					logger.info('docker.compose.cleanup.success', {
						appId,
						message: 'Cleaned up existing compose stack'
					});
				} catch (error) {
					// Stack doesn't exist, that's fine
					logger.info('docker.compose.cleanup.skipped', {
						appId,
						message: 'No existing compose stack to clean up'
					});
				}
			}

			// Ensure shared template image exists (builds once, reused by all apps)
			await this.ensureTemplateImage(templateVersion, basePath);

			// Ensure publish image exists (builds once, no source code)
			await this.ensurePublishImage();

			// Start the compose stack
			logger.info('docker.compose.stack.start.begin', {
				appId,
				message: 'Starting Docker Compose stack'
			});
			await this.composeManager.up(basePath, true);

			logger.info('docker.compose.stack.start.success', {
				appId
			});

		// Get preview container ID (main container for the app)
		const containerId = await this.composeManager.getContainerId(basePath, 'preview');

		if (!containerId) {
			throw new Error('Failed to get container ID from compose stack');
		}

			logger.info('docker.container.id.retrieved', {
				appId,
				containerId
			});

			const containerInfo: ContainerInfo = {
				appId,
				containerId,
				appPath: basePath, // Store base path for compose operations
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

			logger.info('docker.compose.stack.create.success', {
				appId,
				duration,
				message: `Docker Compose stack created successfully in ${duration}ms`
			});

			return containerInfo;
		} catch (error: any) {
			logger.error('docker.container.create.failure', {
				appId,
				error: error instanceof Error ? error.message : String(error),
				message: 'Container creation failed'
			});

			// Clean up provisioned database if container creation failed
			try {
				await this.sharedMySQLService.dropDatabase(appId);
				logger.info('database.cleanup.success', {
					appId,
					message: 'Cleaned up database for failed app'
				});
			} catch (dbCleanupError) {
				logger.warn('database.cleanup.failure', {
					appId,
					error: dbCleanupError instanceof Error ? dbCleanupError.message : String(dbCleanupError),
					message: 'Failed to cleanup database'
				});
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
			logger.warn('docker.container.stop.not_found', { appId, message: 'Container not found for stop operation' });
			return false;
		}

		logger.info('docker.compose.stack.stop.begin', { appId, message: 'Stopping Docker Compose stack' });

		try {
			const basePath = getBasePath(appId);
			await this.composeManager.stop(basePath);

			containerInfo.status = "stopped";
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info('docker.compose.stack.stop.success', { appId, duration });

			return true;
		} catch (error: any) {
			logger.error('docker.compose.stack.stop.failure', { appId, error: error instanceof Error ? error.message : String(error), message: 'Failed to stop compose stack' });

			return false;
		}
	}

	/**
	 * Remove container completely (uses Docker Compose down)
	 * Works even without in-memory container records - attempts cleanup based on appId alone
	 */
	async removeContainer(appId: string): Promise<boolean> {
		const startTime = Date.now();
		const containerInfo =
			this.containers.get(appId) || this.getContainerFromDb(appId);
		const basePath = getBasePath(appId);

		logger.info('docker.compose.stack.remove.begin', { appId, hasRecord: !!containerInfo, message: 'Removing Docker Compose stack' });

		try {
			// 1. Stop and remove Docker containers
			// Try docker-compose down first (if compose file exists)
			try {
				await this.composeManager.down(basePath, true);
				logger.info('docker.compose.stack.remove.success', { appId });
			} catch (composeError) {
				// Compose file might not exist, try direct container removal
				logger.warn('docker.compose.down.failed', { appId, error: composeError instanceof Error ? composeError.message : String(composeError), message: 'Attempting direct container removal' });
				await this.forceRemoveContainersByAppId(appId);
			}

			// 2. Drop database and user from shared MySQL
			try {
				await this.sharedMySQLService.dropDatabase(appId);
				logger.info('database.drop.success', { appId });
			} catch (dbError) {
				logger.warn('database.drop.failure', { appId, error: dbError instanceof Error ? dbError.message : String(dbError), message: 'Failed to drop database' });
				// Continue with cleanup even if database drop fails
			}

			// 3. Remove Docker image (only if we have container info and it's not shared)
			if (containerInfo?.imageName && !this.isSharedTemplate(containerInfo.imageName)) {
				try {
					await execa('docker', ['rmi', containerInfo.imageName]);
					logger.info('docker.image.remove.success', { imageName: containerInfo.imageName });
				} catch (error) {
					logger.info('docker.image.remove.skipped', { imageName: containerInfo.imageName, message: 'Docker image may be in use, skipping removal' });
				}
			} else if (containerInfo?.imageName) {
				logger.info('docker.image.remove.skipped_shared', {
					imageName: containerInfo.imageName,
					message: 'Skipping removal of shared template image (used by all apps)'
				});
			}

			// 4. Remove filesystem artifacts
			try {
				await this.removeAppFiles(appId);
				logger.info('filesystem.remove.success', { appId, path: basePath });
			} catch (fsError) {
				logger.warn('filesystem.remove.failure', {
					appId,
					path: basePath,
					error: fsError instanceof Error ? fsError.message : String(fsError),
					message: 'Failed to remove app files'
				});
				// Continue even if filesystem cleanup fails
			}

			// 5. Remove from memory and database
			this.containers.delete(appId);
			this.removeContainerFromDb(appId);

			const duration = Date.now() - startTime;

			logger.info('docker.compose.stack.remove.complete', { appId, duration });

			return true;
		} catch (error: any) {
			logger.error('docker.compose.stack.remove.failure', { appId, error: error instanceof Error ? error.message : String(error), message: 'Failed to remove compose stack' });

			return false;
		}
	}

	/**
	 * Force remove containers by appId using Docker CLI directly
	 * Handles both old and new naming patterns
	 * Used as fallback when docker-compose down fails
	 */
	private async forceRemoveContainersByAppId(appId: string): Promise<void> {
		const containerNames = [
			// New pattern (current)
			`preview-${appId}-1`,
			`publish-${appId}-1`,
			// Old pattern (for cleanup of legacy containers)
			`airo-app-${appId}-app-1`
		];

		for (const name of containerNames) {
			try {
				// Try to stop the container first
				await execa('docker', ['stop', name], { reject: false });
				// Then remove it
				await execa('docker', ['rm', name], { reject: false });
				logger.info('docker.container.force_remove.success', { appId, containerName: name });
			} catch (error) {
				// Container doesn't exist or already removed, that's fine
				logger.debug('docker.container.force_remove.skip', { appId, containerName: name, message: 'Container not found' });
			}
		}
	}

	/**
	 * Remove app files from filesystem
	 * Handles /tmp/apps/{appId} directory and all contents
	 * Uses native fs.rmSync for reliability, falls back to execa for stubborn files
	 */
	private async removeAppFiles(appId: string): Promise<void> {
		const basePath = getBasePath(appId);

		// Check if directory exists
		if (!fs.existsSync(basePath)) {
			logger.debug('filesystem.remove.not_found', { appId, path: basePath, message: 'Directory does not exist' });
			return;
		}

		logger.info('filesystem.remove.begin', { appId, path: basePath });

		try {
			// Try native Node.js fs.rmSync first (fastest and most reliable)
			fs.rmSync(basePath, { recursive: true, force: true });
			logger.info('filesystem.remove.native_success', { appId, path: basePath });
		} catch (nativeError) {
			// If native removal fails, try using shell commands (handles stubborn files better)
			logger.warn('filesystem.remove.native_failed', {
				appId,
				path: basePath,
				error: nativeError instanceof Error ? nativeError.message : String(nativeError),
				message: 'Attempting shell command fallback'
			});

			try {
				if (process.platform === 'win32') {
					// Windows: Use rmdir /s /q
					await execa('rmdir', ['/s', '/q', basePath], { reject: false });
				} else {
					// Unix/Linux/Mac: Fix permissions first, then rm -rf
					await execa('chmod', ['-R', '755', basePath], { reject: false });
					await execa('rm', ['-rf', basePath]);
				}
				logger.info('filesystem.remove.shell_success', { appId, path: basePath });
			} catch (shellError) {
				logger.error('filesystem.remove.shell_failed', {
					appId,
					path: basePath,
					error: shellError instanceof Error ? shellError.message : String(shellError)
				});
				throw shellError;
			}
		}
	}

	/**
	 * Check if an image name is a shared template image
	 * Shared template images (aab-template-*:latest) are reused across all apps
	 */
	private isSharedTemplate(imageName: string): boolean {
		return imageName.startsWith('aab-template-') && imageName.endsWith(':latest');
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
			const basePath = getBasePath(appId);
			const composeStatus = await this.composeManager.ps(basePath);

		// Find preview service status (main container for the app)
		const appService = composeStatus.services.find(s => s.name === 'preview' || s.name.includes('preview'));

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
			const basePath = getBasePath(appId);
			const logs = await this.composeManager.logs(basePath, {
				tail: tailLines,
				service: 'preview',
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
			logger.warn('docker.container.restart.not_found', { appId, message: 'Container not found for restart operation' });
			return false;
		}

		logger.info('docker.compose.stack.restart.begin', { appId, message: 'Restarting Docker Compose stack' });

		try {
			const basePath = getBasePath(appId);
			await this.composeManager.restart(basePath);

			containerInfo.status = "running";
			this.saveContainerToDb(containerInfo);

			const duration = Date.now() - startTime;

			logger.info('docker.compose.stack.restart.success', { appId, duration });

			return true;
		} catch (error: any) {
			logger.error('docker.compose.stack.restart.failure', { appId, error: error instanceof Error ? error.message : String(error), message: 'Failed to restart compose stack' });

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
					logger.warn('docker.container.list.supervisor_port_missing', { appId: record.appId, message: 'Supervisor port not found during container listing' });
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
				appPath: getBasePath(record.appId), // Base path for compose operations
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
					const basePath = getBasePath(record.appId);

					// Check if compose stack exists and is running
					const composeStatus = await this.composeManager.ps(basePath);

					if (composeStatus.anyRunning) {
						// Stack is running - recover it
						const safeAppId = this.sanitizeAppId(record.appId);
						const useTcp = shouldUseTcpMode();
						let socketPath: string;

						// Set supervisor connection info
						if (useTcp) {
							const devApp = this.devDb.findDevAppById(record.appId);
							if (!devApp?.supervisorPort) {
								logger.warn('docker.recovery.supervisor_port_missing', { appId: record.appId, message: 'Supervisor port not found during recovery' });
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
							appPath: getBasePath(record.appId), // Base path for compose operations
							port: record.port,
							status: "running",
							imageName: record.imageName,
							createdAt: record.createdAt,
							socketPath,
						};

						// Add to in-memory tracking
						this.containers.set(record.appId, containerInfo);

						recoveredCount++;
						logger.info('docker.recovery.stack_recovered', { appId: record.appId });
					} else {
						// Stack exists but stopped - clean it up
						try {
							await this.composeManager.down(basePath, false);
							this.removeContainerFromDb(record.appId);
							cleanedCount++;
							logger.info('docker.recovery.stack_cleaned', { appId: record.appId, message: 'Cleaned up stopped compose stack' });
						} catch (cleanupError) {
							logger.warn('docker.recovery.cleanup.failure', { appId: record.appId, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), message: 'Failed to clean up stopped compose stack' });
						}
					}
				} catch (error) {
					// Compose stack doesn't exist - clean up database record
					this.removeContainerFromDb(record.appId);
					cleanedCount++;
					logger.info('docker.recovery.database_cleaned', { appId: record.appId, message: 'Cleaned up orphaned database record' });
				}
			}

			const duration = Date.now() - startTime;

			logger.info('docker.recovery.complete', { recoveredCount, cleanedCount, duration, message: `Compose stack recovery completed: ${recoveredCount} recovered, ${cleanedCount} cleaned (${duration}ms)` });
		} catch (error) {
			logger.error('docker.recovery.failure', { error: error instanceof Error ? error.message : String(error), message: 'Compose stack recovery failed' });
		}
	}

	/**
	 * Initialize database table for container tracking
	 */
	private initializeDatabase(): void {
		// Docker containers will use the same dev_apps and running_processes tables
		// The dev database already handles this initialization
		logger.info('docker.database.init.skipped', { message: 'Database tables already initialized via DevDatabase' });
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
					appPath: getAppPath(containerInfo.appId), // App code path for database
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
			logger.warn('docker.container.save.failure', { appId: containerInfo.appId, error: error instanceof Error ? error.message : String(error), message: 'Failed to save container info to database' });
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
				logger.warn('docker.container.supervisor_port_missing', { appId: record.appId, message: 'Supervisor port not found in database' });
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
			appPath: getBasePath(record.appId), // Base path for compose operations
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

		logger.info('docker.container.bulk_stop.begin', { count: runningRecords.length, message: `Stopping all running containers: ${runningRecords.length} found` });

		for (const record of runningRecords) {
			try {
				const success = await this.stopContainer(record.appId);
				if (success) {
					stoppedCount++;
					logger.info('docker.container.bulk_stop.success', { appId: record.appId });
				}
			} catch (error) {
				logger.warn('docker.container.bulk_stop.failure', { appId: record.appId, error: error instanceof Error ? error.message : String(error), message: 'Failed to stop container' });
			}
		}

		logger.info('docker.container.bulk_stop.complete', { stoppedCount, totalCount: runningRecords.length, message: `Bulk container stop completed: ${stoppedCount}/${runningRecords.length} stopped` });

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
				const basePath = getBasePath(appId);
				const composeStatus = await this.composeManager.ps(basePath);

				// Find preview service status (main container for the app)
				const appService = composeStatus.services.find(s => s.name === 'preview' || s.name.includes('preview'));

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
			logger.warn('docker.container.restart.stack_missing', { appId, message: 'Container record exists but compose stack is missing' });

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
					service: 'preview',
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
			logger.warn('docker.container.restart.not_found', { appId, message: 'Container not found for restart' });
			return false;
		}

		logger.info('docker.container.restart.begin', { appId, message: 'Restarting container' });

		try {
			// Use Docker Compose to restart all services (app + db if present)
			await this.composeManager.restart(containerInfo.appPath);

			const duration = Date.now() - startTime;

			logger.info('docker.container.restart.success', { appId, duration });

			return true;
		} catch (error) {
			logger.error('docker.container.restart.failure', { appId, error: error instanceof Error ? error.message : String(error), message: 'Container restart failed' });

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
			logger.warn('docker.container.rebuild.in_progress', { appId, message: 'Rebuild already in progress, skipping duplicate request' });
			return null;
		}

		logger.info('docker.container.rebuild.begin', { appId, message: 'Rebuilding container' });

		// Mark rebuild as in progress
		this.activeRebuilds.add(appId);

		try {
			// Validate that app path exists
			if (!existsSync(appPath)) {
				const pathError = new Error(`App directory not found: ${appPath}`);
				logger.error('docker.container.rebuild.path_validation_failed', { appId, error: pathError instanceof Error ? pathError.message : String(pathError), message: 'App path validation failed' });
				throw pathError;
			}

			// Check for Dockerfile
			const dockerfilePath = path.join(appPath, "Dockerfile.dev");
			if (!existsSync(dockerfilePath)) {
				const dockerfileError = new Error(
					`Dockerfile.dev not found in app directory: ${appPath}`,
				);
				logger.error('docker.container.rebuild.dockerfile_validation_failed', { appId, error: dockerfileError instanceof Error ? dockerfileError.message : String(dockerfileError), message: 'Dockerfile validation failed' });
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

			logger.info('docker.container.rebuild.success', { appId, duration });

			return containerInfo;
		} catch (error) {
			logger.error('docker.container.rebuild.failure', { appId, error: error instanceof Error ? error.message : String(error), message: 'Container rebuild failed' });

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
		const basePath = getBasePath(appId);

		const imageName = `airo-app-${dockerSafeId}:dev`;

		// Remove any existing compose stack
		await this.ensureComposeStackRemoved(basePath);

		try {
			// Remove image if it exists to force rebuild
			await execa('docker', ['rmi', '-f', imageName]);
			logger.info('docker.image.remove.rebuild.success', { imageName, message: 'Removed existing image for rebuild' });
		} catch (error) {
			// Image doesn't exist, that's fine
			logger.info('docker.image.remove.rebuild.skipped', { imageName, message: 'Image removal skipped, likely did not exist' });
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

		logger.info('docker.force_cleanup.begin', { message: 'Starting force cleanup of orphaned compose stacks' });

		try {
			// Get all containers from database
			const allContainers = this.getAllContainers();

			logger.info(`🔍 Found ${allContainers.length} container records`);

			for (const containerRecord of allContainers) {
				try {
					const basePath = getBasePath(containerRecord.appId);
					const composeStatus = await this.composeManager.ps(basePath);

					if (!composeStatus.anyRunning) {
						// Stack exists but is stopped, remove it
						await this.composeManager.down(basePath, true);
						this.removeContainerFromDb(containerRecord.appId);
						cleanedCount++;
						logger.info('docker.force_cleanup.stack_cleaned', { appId: containerRecord.appId, message: 'Cleaned up stopped compose stack' });
					}
				} catch (error) {
					// Stack doesn't exist, remove database record
					this.removeContainerFromDb(containerRecord.appId);
					cleanedCount++;
					logger.info('docker.force_cleanup.database_cleaned', { appId: containerRecord.appId, message: 'Cleaned up orphaned database record' });
				}
			}

			const duration = Date.now() - startTime;

			logger.info('docker.force_cleanup.complete', { cleanedCount, duration, message: `Force cleanup completed: ${cleanedCount} cleaned (${duration}ms)` });

			return cleanedCount;
		} catch (error) {
			logger.error('docker.force_cleanup.failure', { error: error instanceof Error ? error.message : String(error), message: 'Force cleanup failed' });

			return cleanedCount;
		}
	}
}
