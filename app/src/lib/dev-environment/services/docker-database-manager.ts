import { logger } from '../../request-context';
import { exec } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";
import net from "net";

const execAsync = promisify(exec);

export interface DatabaseInfo {
	appId: string;
	containerId: string;
	networkId: string;
	volumeName: string;
	credentials: {
		host: string;               // Container hostname for Docker network
		port: number;               // Container port (3306)
		hostMachineHost: string;    // Host for external access (localhost/host.docker.internal)
		hostMachinePort: number;    // Mapped port on host machine
		database: string;
		user: string;
		password: string;
		rootPassword: string;
	};
	status: "creating" | "running" | "stopped" | "error";
	createdAt: Date;
}

export interface DatabaseStatus {
	status: "running" | "stopped" | "not_found" | "error";
	message?: string;
	containerId?: string;
}

/**
 * Docker Database Manager for MySQL Containers
 * Manages MySQL database containers for development apps
 */
export class DockerDatabaseManager {
	private databases = new Map<string, DatabaseInfo>();
	private allocatedPorts = new Set<number>();

	/**
	 * Sanitize app ID for safe use in Docker names
	 */
	private sanitizeAppId(appId: string): string {
		return appId
			.toLowerCase()
			.replace(/[^a-z0-9.-]/g, "")
			.replace(/^[.-]+|[.-]+$/g, "")
			.substring(0, 63);
	}

	/**
	 * Generate secure random password
	 */
	private generatePassword(): string {
		return randomBytes(16).toString('hex');
	}

	/**
	 * Check if a port is available on the host machine
	 */
	private async isPortAvailable(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = net.createServer();

			server.once('error', (err: NodeJS.ErrnoException) => {
				resolve(false);
			});

			server.once('listening', () => {
				server.close();
				resolve(true);
			});

			server.listen(port, '127.0.0.1');
		});
	}

	/**
	 * Find an available port for MySQL host mapping
	 * Starts from 33060 and increments until an available port is found
	 */
	private async findAvailablePort(startPort: number = 33060): Promise<number> {
		let port = startPort;
		const maxAttempts = 1000;
		let attempts = 0;

		while (attempts < maxAttempts) {
			// Skip if already allocated in this session
			if (this.allocatedPorts.has(port)) {
				port++;
				attempts++;
				continue;
			}

			// Check if port is actually available
			if (await this.isPortAvailable(port)) {
				this.allocatedPorts.add(port);
				logger.info("database.port.allocated", {
					port,
					startPort,
					attempts: attempts + 1,
				});
				return port;
			}

			port++;
			attempts++;
		}

		throw new Error(`Unable to find available port after ${maxAttempts} attempts starting from ${startPort}`);
	}

	/**
	 * Release a port from the allocation set
	 */
	private releasePort(port: number): void {
		this.allocatedPorts.delete(port);
		logger.info("database.port.released", { port });
	}

	/**
	 * Create Docker network for app and database communication
	 */
	private async createNetwork(appId: string): Promise<string> {
		const dockerSafeId = this.sanitizeAppId(appId);
		const networkName = `airo-network-${dockerSafeId}`;

		logger.info("database.network.create.begin", {
			appId,
			networkName,
		});

		try {
			// Check if network already exists
			try {
				const { stdout } = await execAsync(
					`docker network inspect ${networkName}`
				);
				if (stdout.trim()) {
					logger.info("database.network.create.exists", {
						appId,
						networkName,
					});
					return networkName;
				}
			} catch {
				// Network doesn't exist, create it
			}

			// Create network
			await execAsync(`docker network create ${networkName}`);

			logger.info("database.network.create.success", {
				appId,
				networkName,
			});

			return networkName;
		} catch (error) {
			logger.error("database.network.create.failure", {
				appId,
				networkName,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(
				`Failed to create Docker network: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Create Docker volume for MySQL data persistence
	 */
	private async createVolume(appId: string): Promise<string> {
		const dockerSafeId = this.sanitizeAppId(appId);
		const volumeName = `airo-mysql-data-${dockerSafeId}`;

		logger.info("database.volume.create.begin", {
			appId,
			volumeName,
		});

		try {
			// Check if volume already exists
			try {
				const { stdout } = await execAsync(
					`docker volume inspect ${volumeName}`
				);
				if (stdout.trim()) {
					logger.info("database.volume.create.exists", {
						appId,
						volumeName,
					});
					return volumeName;
				}
			} catch {
				// Volume doesn't exist, create it
			}

			// Create volume
			await execAsync(`docker volume create ${volumeName}`);

			logger.info("database.volume.create.success", {
				appId,
				volumeName,
			});

			return volumeName;
		} catch (error) {
			logger.error("database.volume.create.failure", {
				appId,
				volumeName,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(
				`Failed to create Docker volume: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Wait for MySQL to be ready
	 */
	private async waitForMySQLReady(
		containerName: string,
		rootPassword: string,
		maxAttempts: number = 30
	): Promise<boolean> {
		logger.info("database.health.check.begin", {
			containerName,
			maxAttempts,
		});

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const { stdout } = await execAsync(
					`docker exec ${containerName} mysqladmin ping -h localhost -u root -p${rootPassword} 2>&1`
				);

				if (stdout.includes("mysqld is alive")) {
					logger.info("database.health.check.success", {
						containerName,
						attempts: attempt,
					});
					return true;
				}
			} catch (error) {
				// MySQL not ready yet, wait and retry
			}

			// Wait 2 seconds before next attempt
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		logger.error("database.health.check.failure", {
			containerName,
			maxAttempts,
		});

		return false;
	}

	/**
	 * Create and start MySQL database container
	 */
	async createDatabaseContainer(appId: string): Promise<DatabaseInfo> {
		const startTime = Date.now();
		const dockerSafeId = this.sanitizeAppId(appId);
		const containerName = `airo-mysql-${dockerSafeId}`;

		logger.info("database.create.begin", {
			appId,
			containerName,
		});

		try {
			// Allocate a host port for external access
			const hostMachinePort = await this.findAvailablePort();

			// Generate credentials
			const credentials = {
				host: containerName, // Use container name for Docker networking
				port: 3306,
				hostMachineHost: "localhost", // For agents service on host machine
				hostMachinePort,              // Mapped port on host
				database: "appdb",
				user: "appuser",
				password: this.generatePassword(),
				rootPassword: this.generatePassword(),
			};

			logger.info("database.credentials.generated", {
				appId,
				containerHost: credentials.host,
				containerPort: credentials.port,
				hostMachineHost: credentials.hostMachineHost,
				hostMachinePort: credentials.hostMachinePort,
			});

			// Create network
			const networkId = await this.createNetwork(appId);

			// Create volume for data persistence
			const volumeName = await this.createVolume(appId);

			// Check if container already exists and remove it
			try {
				const { stdout } = await execAsync(
					`docker ps -aq --filter name=^${containerName}$`
				);
				if (stdout.trim()) {
					logger.info("database.container.cleanup", {
						appId,
						containerName,
					});
					await execAsync(`docker rm -f ${stdout.trim()}`);
					// Wait for Docker to release the name
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			} catch {
				// Container doesn't exist, continue
			}

			// Start MySQL container
			logger.info("database.container.start.begin", {
				appId,
				containerName,
			});

			const runCommand = [
				"docker run -d",
				`--name ${containerName}`,
				`--network ${networkId}`,
				`-p 127.0.0.1:${hostMachinePort}:3306`,  // Map container port 3306 to host port
				`-v ${volumeName}:/var/lib/mysql`,
				`-e MYSQL_ROOT_PASSWORD=${credentials.rootPassword}`,
				`-e MYSQL_DATABASE=${credentials.database}`,
				`-e MYSQL_USER=${credentials.user}`,
				`-e MYSQL_PASSWORD=${credentials.password}`,
				"--restart unless-stopped",
				"mysql:8.0",
				"--default-authentication-plugin=mysql_native_password",
			].join(" ");

			const { stdout: containerId } = await execAsync(runCommand);
			const cleanContainerId = containerId.trim();

			logger.info("database.container.start.success", {
				appId,
				containerName,
				containerId: cleanContainerId,
			});

			// Wait for MySQL to be ready
			const isReady = await this.waitForMySQLReady(
				containerName,
				credentials.rootPassword
			);

			if (!isReady) {
				throw new Error("MySQL container failed to become ready");
			}

			const databaseInfo: DatabaseInfo = {
				appId,
				containerId: cleanContainerId,
				networkId,
				volumeName,
				credentials,
				status: "running",
				createdAt: new Date(),
			};

			// Store in memory
			this.databases.set(appId, databaseInfo);

			const duration = Date.now() - startTime;

			logger.info("database.create.success", {
				appId,
				containerName,
				containerId: cleanContainerId,
				duration,
			});

			return databaseInfo;
		} catch (error) {
			logger.error("database.create.failure", {
				appId,
				containerName,
				error: error instanceof Error ? error.message : String(error),
			});

			throw new Error(
				`Failed to create database container: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Stop database container
	 */
	async stopDatabaseContainer(appId: string): Promise<boolean> {
		const databaseInfo = this.databases.get(appId);

		if (!databaseInfo) {
			logger.warn("database.stop.not_found", { appId });
			return false;
		}

		logger.info("database.stop.begin", {
			appId,
			containerId: databaseInfo.containerId,
		});

		try {
			await execAsync(`docker stop ${databaseInfo.containerId}`);

			databaseInfo.status = "stopped";

			logger.info("database.stop.success", {
				appId,
				containerId: databaseInfo.containerId,
			});

			return true;
		} catch (error) {
			logger.error("database.stop.failure", {
				appId,
				containerId: databaseInfo.containerId,
				error: error instanceof Error ? error.message : String(error),
			});

			return false;
		}
	}

	/**
	 * Remove database container, network, and volume
	 */
	async removeDatabaseContainer(appId: string): Promise<boolean> {
		const startTime = Date.now();
		const databaseInfo = this.databases.get(appId);
		const dockerSafeId = this.sanitizeAppId(appId);

		logger.info("database.cleanup.begin", { appId });

		try {
			// Release the allocated port
			if (databaseInfo?.credentials.hostMachinePort) {
				this.releasePort(databaseInfo.credentials.hostMachinePort);
			}

			// Remove container
			if (databaseInfo) {
				try {
					await execAsync(`docker rm -f ${databaseInfo.containerId}`);
					logger.info("database.container.remove.success", {
						appId,
						containerId: databaseInfo.containerId,
					});
				} catch (error) {
					logger.warn("database.container.remove.failure", {
						appId,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				// Try to find and remove container by name
				const containerName = `airo-mysql-${dockerSafeId}`;
				try {
					const { stdout } = await execAsync(
						`docker ps -aq --filter name=^${containerName}$`
					);
					if (stdout.trim()) {
						await execAsync(`docker rm -f ${stdout.trim()}`);
						logger.info("database.container.remove.success", {
							appId,
							containerName,
						});
					}
				} catch {
					// Container doesn't exist, continue
				}
			}

			// Remove network
			const networkName = `airo-network-${dockerSafeId}`;
			try {
				await execAsync(`docker network rm ${networkName}`);
				logger.info("database.network.remove.success", {
					appId,
					networkName,
				});
			} catch (error) {
				logger.warn("database.network.remove.failure", {
					appId,
					networkName,
					error: error instanceof Error ? error.message : String(error),
				});
			}

			// Remove volume
			const volumeName = databaseInfo?.volumeName || `airo-mysql-data-${dockerSafeId}`;
			try {
				await execAsync(`docker volume rm ${volumeName}`);
				logger.info("database.volume.remove.success", {
					appId,
					volumeName,
				});
			} catch (error) {
				logger.warn("database.volume.remove.failure", {
					appId,
					volumeName,
					error: error instanceof Error ? error.message : String(error),
				});
			}

			// Remove from memory
			this.databases.delete(appId);

			const duration = Date.now() - startTime;

			logger.info("database.cleanup.complete", {
				appId,
				duration,
			});

			return true;
		} catch (error) {
			logger.error("database.cleanup.failure", {
				appId,
				error: error instanceof Error ? error.message : String(error),
			});

			return false;
		}
	}

	/**
	 * Get database container status
	 */
	async getDatabaseStatus(appId: string): Promise<DatabaseStatus> {
		const databaseInfo = this.databases.get(appId);
		const dockerSafeId = this.sanitizeAppId(appId);
		const containerName = `airo-mysql-${dockerSafeId}`;

		if (!databaseInfo) {
			// Try to find container by name
			try {
				const { stdout } = await execAsync(
					`docker ps -a --filter name=^${containerName}$ --format "{{.ID}} {{.Status}}"`
				);

				if (stdout.trim()) {
					const [containerId, ...statusParts] = stdout.trim().split(" ");
					const status = statusParts.join(" ");

					if (status.includes("Up")) {
						return {
							status: "running",
							containerId,
							message: "Database container is running",
						};
					} else {
						return {
							status: "stopped",
							containerId,
							message: "Database container is stopped",
						};
					}
				}
			} catch {
				// Container not found
			}

			return {
				status: "not_found",
				message: "Database container not found",
			};
		}

		try {
			const { stdout } = await execAsync(
				`docker inspect --format='{{.State.Status}}' ${databaseInfo.containerId}`
			);
			const dockerStatus = stdout.trim();

			if (dockerStatus === "running") {
				return {
					status: "running",
					containerId: databaseInfo.containerId,
					message: "Database container is running",
				};
			} else if (dockerStatus === "exited" || dockerStatus === "stopped") {
				return {
					status: "stopped",
					containerId: databaseInfo.containerId,
					message: "Database container is stopped",
				};
			} else {
				return {
					status: "error",
					containerId: databaseInfo.containerId,
					message: `Database container status: ${dockerStatus}`,
				};
			}
		} catch (error) {
			return {
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Get database information
	 */
	getDatabaseInfo(appId: string): DatabaseInfo | null {
		return this.databases.get(appId) || null;
	}

	/**
	 * Generate environment variables for app container
	 */
	getEnvironmentVariables(databaseInfo: DatabaseInfo): Record<string, string> {
		const { credentials } = databaseInfo;

		return {
			// DATABASE_URL for app container (uses Docker network)
			DATABASE_URL: `mysql://${credentials.user}:${credentials.password}@${credentials.host}:${credentials.port}/${credentials.database}`,

			// Internal Docker network endpoint (for app container)
			MYSQL_HOST: credentials.host,
			MYSQL_PORT: credentials.port.toString(),

			// External host machine endpoint (for agents service on host)
			MYSQL_HOST_EXTERNAL: credentials.hostMachineHost,
			MYSQL_PORT_EXTERNAL: credentials.hostMachinePort.toString(),

			// Common database credentials
			MYSQL_DATABASE: credentials.database,
			MYSQL_USER: credentials.user,
			MYSQL_PASSWORD: credentials.password,
			MYSQL_ROOT_PASSWORD: credentials.rootPassword,
		};
	}

	/**
	 * Connect app container to database network
	 */
	async connectAppToNetwork(appId: string, appContainerId: string): Promise<boolean> {
		const databaseInfo = this.databases.get(appId);

		if (!databaseInfo) {
			logger.warn("database.network.connect.not_found", { appId });
			return false;
		}

		logger.info("database.network.connect.begin", {
			appId,
			appContainerId,
			networkId: databaseInfo.networkId,
		});

		try {
			await execAsync(
				`docker network connect ${databaseInfo.networkId} ${appContainerId}`
			);

			logger.info("database.network.connect.success", {
				appId,
				appContainerId,
				networkId: databaseInfo.networkId,
			});

			return true;
		} catch (error) {
			logger.error("database.network.connect.failure", {
				appId,
				appContainerId,
				networkId: databaseInfo.networkId,
				error: error instanceof Error ? error.message : String(error),
			});

			return false;
		}
	}

	/**
	 * Clean up orphaned database containers
	 */
	async cleanupOrphans(): Promise<number> {
		const startTime = Date.now();
		let cleanedCount = 0;

		logger.info("database.orphan.cleanup.begin", {});

		try {
			// Find all airo-mysql containers
			const { stdout } = await execAsync(
				`docker ps -a --filter name=^airo-mysql- --format "{{.Names}}"`
			);

			const containerNames = stdout
				.trim()
				.split("\n")
				.filter((name) => name.length > 0);

			logger.info("database.orphan.cleanup.found", {
				count: containerNames.length,
			});

			for (const containerName of containerNames) {
				try {
					// Extract app ID from container name
					const appId = containerName.replace("airo-mysql-", "");

					// Remove container and associated resources
					await this.removeDatabaseContainer(appId);
					cleanedCount++;
				} catch (error) {
					logger.warn("database.orphan.cleanup.item.failure", {
						containerName,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}

			const duration = Date.now() - startTime;

			logger.info("database.orphan.cleanup.complete", {
				cleaned: cleanedCount,
				duration,
			});

			return cleanedCount;
		} catch (error) {
			logger.error("database.orphan.cleanup.failure", {
				error: error instanceof Error ? error.message : String(error),
			});

			return cleanedCount;
		}
	}
}
