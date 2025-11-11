import { exec } from "child_process";
import { promisify } from "util";
import { logger } from '../../request-context';
import * as path from "node:path";

const execAsync = promisify(exec);

export interface ComposeServiceStatus {
	name: string;
	state: string;
	status: string;
}

export interface ComposeStatus {
	services: ComposeServiceStatus[];
	allRunning: boolean;
	anyRunning: boolean;
}

/**
 * Docker Compose Manager
 * Manages Docker Compose stacks for development apps
 */
export class DockerComposeManager {
	/**
	 * Get the compose file path for an app
	 */
	private getComposeFilePath(appPath: string): string {
		return path.join(appPath, 'docker-compose.yml');
	}

	/**
	 * Extract appId from appPath
	 * Assumes path format: /tmp/apps/{appId}
	 */
	private getAppIdFromPath(appPath: string): string {
		return path.basename(appPath);
	}

	/**
	 * Get the project name for compose stack
	 * Uses airo-app- prefix for consistency
	 */
	private getProjectName(appPath: string): string {
		const appId = this.getAppIdFromPath(appPath);
		return `airo-app-${appId}`;
	}

	/**
	 * Execute a docker compose command
	 */
	private async execCompose(
		appPath: string,
		command: string,
		options: { timeout?: number; ignoreError?: boolean } = {}
	): Promise<{ stdout: string; stderr: string }> {
		const composeFile = this.getComposeFilePath(appPath);
		const projectName = this.getProjectName(appPath);
		const fullCommand = `docker compose -f "${composeFile}" --project-name "${projectName}" ${command}`;

		logger.info("compose.command.execute", {
			appPath,
			projectName,
			command: command.split(' ')[0], // Log first word only (up, down, etc.)
		});

		try {
			const result = await execAsync(fullCommand, {
				cwd: appPath,
				maxBuffer: 1024 * 1024 * 10, // 10MB buffer
				timeout: options.timeout,
			});

			logger.info("compose.command.success", {
				appPath,
				projectName,
				command: command.split(' ')[0],
			});

			return result;
		} catch (error: any) {
			if (!options.ignoreError) {
				logger.error("compose.command.failure", {
					appPath,
					projectName,
					command: command.split(' ')[0],
					error: error.message || String(error),
				});
			}
			throw error;
		}
	}

	/**
	 * Start all services defined in docker-compose.yml
	 * Creates and starts containers
	 */
	async up(appPath: string, detached: boolean = true): Promise<void> {
		const startTime = Date.now();

		logger.info("compose.up.begin", { appPath, detached });

		try {
			const flags = detached ? '-d' : '';
			await this.execCompose(appPath, `up ${flags} --remove-orphans`);

			const duration = Date.now() - startTime;

			logger.info("compose.up.success", {
				appPath,
				duration,
			});
		} catch (error) {
			logger.error("compose.up.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to start compose stack: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Stop all services without removing containers
	 */
	async stop(appPath: string): Promise<void> {
		const startTime = Date.now();

		logger.info("compose.stop.begin", { appPath });

		try {
			await this.execCompose(appPath, 'stop');

			const duration = Date.now() - startTime;

			logger.info("compose.stop.success", {
				appPath,
				duration,
			});
		} catch (error) {
			logger.error("compose.stop.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to stop compose stack: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Start existing stopped services
	 */
	async start(appPath: string): Promise<void> {
		const startTime = Date.now();

		logger.info("compose.start.begin", { appPath });

		try {
			await this.execCompose(appPath, 'start');

			const duration = Date.now() - startTime;

			logger.info("compose.start.success", {
				appPath,
				duration,
			});
		} catch (error) {
			logger.error("compose.start.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to start compose stack: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Restart all services
	 */
	async restart(appPath: string): Promise<void> {
		const startTime = Date.now();

		logger.info("compose.restart.begin", { appPath });

		try {
			await this.execCompose(appPath, 'restart');

			const duration = Date.now() - startTime;

			logger.info("compose.restart.success", {
				appPath,
				duration,
			});
		} catch (error) {
			logger.error("compose.restart.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to restart compose stack: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Stop and remove all containers, networks, and volumes
	 */
	async down(appPath: string, removeVolumes: boolean = false): Promise<void> {
		const startTime = Date.now();

		logger.info("compose.down.begin", {
			appPath,
			removeVolumes,
		});

		try {
			const flags = removeVolumes ? '--volumes' : '';
			await this.execCompose(appPath, `down ${flags}`);

			const duration = Date.now() - startTime;

			logger.info("compose.down.success", {
				appPath,
				duration,
			});
		} catch (error) {
			logger.error("compose.down.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to tear down compose stack: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Get status of all services in the compose stack
	 */
	async ps(appPath: string): Promise<ComposeStatus> {
		logger.info("compose.ps.begin", { appPath });

		try {
			const { stdout } = await this.execCompose(
				appPath,
				'ps --format json',
				{ ignoreError: true }
			);

			if (!stdout.trim()) {
				logger.info("compose.ps.no_services", { appPath });
				return {
					services: [],
					allRunning: false,
					anyRunning: false,
				};
			}

			// Parse JSON output (docker compose ps --format json returns one JSON object per line)
			const services: ComposeServiceStatus[] = [];
			const lines = stdout.trim().split('\n');

			for (const line of lines) {
				try {
					const service = JSON.parse(line);
					services.push({
						name: service.Service || service.Name,
						state: service.State,
						status: service.Status,
					});
				} catch (parseError) {
					logger.warn("compose.ps.parse_error", {
						appPath,
						line,
						error: parseError instanceof Error ? parseError.message : String(parseError),
					});
				}
			}

			const allRunning = services.length > 0 && services.every(s => s.state === 'running');
			const anyRunning = services.some(s => s.state === 'running');

			logger.info("compose.ps.success", {
				appPath,
				serviceCount: services.length,
				allRunning,
				anyRunning,
			});

			return {
				services,
				allRunning,
				anyRunning,
			};
		} catch (error) {
			logger.error("compose.ps.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});

			return {
				services: [],
				allRunning: false,
				anyRunning: false,
			};
		}
	}

	/**
	 * Get logs from compose services
	 */
	async logs(
		appPath: string,
		options: {
			follow?: boolean;
			tail?: number;
			service?: string;
		} = {}
	): Promise<string> {
		logger.info("compose.logs.begin", {
			appPath,
			follow: options.follow,
			tail: options.tail,
			service: options.service,
		});

		try {
			const flags: string[] = [];

			if (options.follow) flags.push('--follow');
			if (options.tail) flags.push(`--tail ${options.tail}`);

			const service = options.service || '';
			const command = `logs ${flags.join(' ')} ${service}`.trim();

			const { stdout } = await this.execCompose(appPath, command);

			logger.info("compose.logs.success", {
				appPath,
				lines: stdout.split('\n').length,
			});

			return stdout;
		} catch (error) {
			logger.error("compose.logs.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to get compose logs: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Execute a command in a running service container
	 */
	async exec(
		appPath: string,
		service: string,
		command: string
	): Promise<{ stdout: string; stderr: string }> {
		logger.info("compose.exec.begin", {
			appPath,
			service,
			command,
		});

		try {
			const result = await this.execCompose(
				appPath,
				`exec -T ${service} ${command}`
			);

			logger.info("compose.exec.success", {
				appPath,
				service,
			});

			return result;
		} catch (error) {
			logger.error("compose.exec.failure", {
				appPath,
				service,
				command,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to exec command in service: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Build or rebuild services
	 */
	async build(appPath: string, noCache: boolean = false): Promise<void> {
		const startTime = Date.now();

		logger.info("compose.build.begin", {
			appPath,
			noCache,
		});

		try {
			const flags = noCache ? '--no-cache' : '';
			await this.execCompose(appPath, `build ${flags}`);

			const duration = Date.now() - startTime;

			logger.info("compose.build.success", {
				appPath,
				duration,
			});
		} catch (error) {
			logger.error("compose.build.failure", {
				appPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(`Failed to build compose services: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Check if MySQL database is ready
	 */
	async waitForDatabase(
		appPath: string,
		maxAttempts: number = 30
	): Promise<boolean> {
		logger.info("compose.database.wait.begin", {
			appPath,
			maxAttempts,
		});

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				// Use mysqladmin with --silent flag - authentication handled by .my.cnf or healthcheck
				const { stdout } = await this.exec(
					appPath,
					'db',
					'mysqladmin ping -h localhost --silent'
				);

				// MySQL will return empty output with exit code 0 when healthy
				if (stdout.includes('mysqld is alive') || stdout.trim() === '') {
					logger.info("compose.database.wait.success", {
						appPath,
						attempts: attempt,
					});
					return true;
				}
			} catch (error) {
				// Database not ready yet, continue waiting
			}

			// Wait 2 seconds before next attempt
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		logger.error("compose.database.wait.failure", {
			appPath,
			maxAttempts,
		});

		return false;
	}

	/**
	 * Get container ID for a service
	 */
	async getContainerId(appPath: string, service: string): Promise<string | null> {
		logger.info("compose.container_id.get", {
			appPath,
			service,
		});

		try {
			const { stdout } = await this.execCompose(
				appPath,
				`ps -q ${service}`
			);

			const containerId = stdout.trim();

			if (!containerId) {
				logger.warn("compose.container_id.not_found", {
					appPath,
					service,
				});
				return null;
			}

			logger.info("compose.container_id.success", {
				appPath,
				service,
				containerId,
			});

			return containerId;
		} catch (error) {
			logger.error("compose.container_id.failure", {
				appPath,
				service,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	/**
	 * Ensure shared network exists for all apps
	 * Creates a single shared network (Docker auto-assigns subnet)
	 * This replaces per-app /16 networks to dramatically reduce IP consumption
	 */
	async ensureSharedNetwork(): Promise<void> {
		const networkName = 'airo-apps-shared';

		logger.info("network.shared.ensure.begin", {
			networkName,
		});

		try {
			// Check if network already exists
			const { stdout } = await execAsync(`docker network inspect ${networkName}`, {
				maxBuffer: 1024 * 1024,
			});

			// Network exists, verify it's configured correctly
			const networkInfo = JSON.parse(stdout);
			if (networkInfo && networkInfo.length > 0) {
				logger.info("network.shared.ensure.exists", {
					networkName,
					id: networkInfo[0].Id?.substring(0, 12),
				});
				return;
			}
		} catch (error: any) {
			// Network doesn't exist (inspect command failed)
			const errorMessage = error.message || '';
			const errorStderr = error.stderr || '';
			const isNetworkNotFound =
				errorMessage.includes("No such network") ||
				errorMessage.includes("not found") ||
				errorStderr.includes("No such network") ||
				errorStderr.includes("not found");

			if (isNetworkNotFound) {
				logger.info("network.shared.ensure.creating", {
					networkName,
				});

				try {
					// Create the shared network (Docker auto-assigns subnet from available pool)
					await execAsync(
						`docker network create ${networkName} --driver bridge`,
						{ maxBuffer: 1024 * 1024 }
					);

					logger.info("network.shared.ensure.success", {
						networkName,
					});
				} catch (createError) {
					logger.error("network.shared.ensure.failure", {
						networkName,
						error: createError instanceof Error ? createError.message : String(createError),
					});
					throw new Error(
						`Failed to create shared network: ${createError instanceof Error ? createError.message : String(createError)}`
					);
				}
			} else {
				// Some other error occurred during inspect
				logger.error("network.shared.ensure.inspect_error", {
					networkName,
					error: error.message || String(error),
				});
				throw error;
			}
		}
	}
}
