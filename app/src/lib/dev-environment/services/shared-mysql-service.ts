import { createHash } from 'crypto';
import { type Connection, createConnection } from 'mysql2/promise';

import type { DatabaseConfig } from './docker-compose-generator';
import { logger } from '../../request-context';
import { generateSecurePassword } from '../utils/password-generator';
import { sanitizeForMySQL } from '../utils/sanitizers';

/**
 * Credentials for connecting to the shared MySQL instance as root
 */
interface RootCredentials {
	/** MySQL host (container name for Docker network DNS) */
	host: string;
	/** MySQL port (default: 3306) */
	port: number;
	/** MySQL root username */
	user: string;
	/** MySQL root password */
	password: string;
}

/**
 * Service for managing database provisioning in the shared MySQL instance
 *
 * Responsibilities:
 * - Create unique databases for each app
 * - Create unique users with isolated permissions
 * - Drop databases and users on app deletion
 * - Health check and connection management
 *
 * Database naming convention:
 * - Database: airo_{appId}
 * - User: user_airo_{appId} (truncated to 32 chars for MySQL limits)
 */
export class SharedMySQLService {
	private readonly rootCredentials: RootCredentials;
	private initialized = false;

	/**
	 * Initialize the service with root credentials for the shared MySQL instance
	 *
	 * @param containerName - Name of the MySQL Docker container (default: 'airo-app-mysql')
	 * @param rootPassword - Root password for MySQL (default: from docker-compose.yml)
	 */
	constructor(
		private readonly containerName: string = 'airo-app-mysql',
		rootPassword: string = 'rootpassword'
	) {
		// App service runs on host, so connect to MySQL via localhost
		// Generated apps run in containers, so they connect via container name (handled in provisioning)
		this.rootCredentials = {
			host: 'localhost', // Host machine connection
			port: 3306,
			user: 'root',
			password: rootPassword,
		};
	}

	/**
	 * Initialize the service and ensure MySQL is healthy
	 *
	 * Note: Assumes root docker-compose.yml has already created the airo-network
	 * and connected the MySQL container to it
	 *
	 * @throws {Error} If shared MySQL instance is not healthy or accessible after health check
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Verify MySQL is accessible and healthy
		const healthy = await this.healthCheck();
		if (!healthy) {
			throw new Error('Shared MySQL instance is not healthy or accessible');
		}

		this.initialized = true;
	}

	/**
	 * Check if MySQL is healthy and accessible
	 * Retries with exponential backoff
	 *
	 * @param maxAttempts - Maximum number of health check attempts (default: 30)
	 * @param baseInterval - Base interval between attempts in ms (default: 2000)
	 * @returns true if healthy, false otherwise
	 */
	async healthCheck(maxAttempts: number = 30, baseInterval: number = 2000): Promise<boolean> {
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			let connection: Connection | null = null;
			try {
				connection = await createConnection({
					...this.rootCredentials,
					ssl: {
						rejectUnauthorized: false,
					},
				});
				await connection.ping();
				return true;
			} catch (error) {
				const interval = attempt <= 10 ? baseInterval : baseInterval * 2.5; // Slower after 10 attempts

				logger.warn('shared_mysql.health.retry', {
					attempt,
					maxAttempts,
					nextRetryIn: interval,
					error: error instanceof Error ? error.message : String(error),
				});

				if (attempt < maxAttempts) {
					await this.sleep(interval);
				}
			} finally {
				if (connection) {
					try {
						await connection.end();
					} catch {
						// Connection already closed or failed - safe to ignore
					}
				}
			}
		}

		logger.error('shared_mysql.health.failure', { maxAttempts });
		return false;
	}

	/**
	 * Provision a new database and user for an app
	 *
	 * Creates:
	 * - Database: airo_{appId}
	 * - User: user_airo_{appId}@'%' with random password
	 * - Grants: ALL PRIVILEGES on airo_{appId}.* to user
	 *
	 * @param appId - The unique app identifier
	 * @returns Database credentials for the app
	 * @throws {Error} If database provisioning fails
	 */
	async provisionDatabase(appId: string): Promise<DatabaseConfig> {
		await this.ensureInitialized();

		const dbName = this.generateDatabaseName(appId);
		const username = this.generateUsername(appId);
		const password = generateSecurePassword();

		let connection: Connection | null = null;

		try {
			connection = await createConnection({
				...this.rootCredentials,
				ssl: {
					rejectUnauthorized: false,
				},
			});

			// Create database using identifier escaping
			await connection.query('CREATE DATABASE IF NOT EXISTS ??', [dbName]);

			// Create user with parameterized query
			await connection.query(
				'CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?',
				[username, '%', password]
			);

			// Grant privileges using identifier escaping for database
			await connection.query(
				'GRANT ALL PRIVILEGES ON ??.* TO ?@?',
				[dbName, username, '%']
			);

			// Flush privileges to ensure they take effect
			await connection.query('FLUSH PRIVILEGES');

			return {
				host: this.containerName, // Container name for Docker network DNS
				port: 3306,
				hostMachinePort: 3306, // Shared MySQL port (no per-app port mapping needed)
				database: dbName,
				user: username,
				password,
				rootPassword: this.rootCredentials.password,
			};
		} catch (error) {
			logger.error('shared_mysql.provision.failure', {
				appId,
				database: dbName,
				user: username,
				error: error instanceof Error ? error.message : String(error),
			});

			// Attempt cleanup on failure
			if (connection) {
				try {
					await connection.query('DROP DATABASE IF EXISTS ??', [dbName]);
					await connection.query('DROP USER IF EXISTS ?@?', [username, '%']);
				} catch (cleanupError) {
					logger.warn('shared_mysql.provision.cleanup_failed', {
						appId,
						error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
					});
				}
			}

			throw new Error(`Failed to provision database for app ${appId}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			if (connection) {
				try {
					await connection.end();
				} catch {
					// Connection already closed or failed - safe to ignore
				}
			}
		}
	}

	/**
	 * Drop the database and user for an app
	 *
	 * Deletes:
	 * - Database: airo_{appId}
	 * - User: user_airo_{appId}@'%'
	 *
	 * This operation is idempotent - safe to call even if database/user doesn't exist
	 *
	 * @param appId - The unique app identifier
	 */
	async dropDatabase(appId: string): Promise<void> {
		await this.ensureInitialized();

		const dbName = this.generateDatabaseName(appId);
		const username = this.generateUsername(appId);

		let connection: Connection | null = null;

		try {
			connection = await createConnection({
				...this.rootCredentials,
				ssl: {
					rejectUnauthorized: false,
				},
			});

			// Drop database (IF EXISTS makes this idempotent) using identifier escaping
			await connection.query('DROP DATABASE IF EXISTS ??', [dbName]);

			// Drop user (IF EXISTS makes this idempotent)
			await connection.query('DROP USER IF EXISTS ?@?', [username, '%']);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);

			// Only log unexpected errors (not "already doesn't exist")
			if (!errorMsg.includes('Unknown database') && !errorMsg.includes('Operation DROP USER failed')) {
				logger.error('shared_mysql.drop.failure', {
					appId,
					error: errorMsg,
				});
			}
		} finally {
			if (connection) {
				try {
					await connection.end();
				} catch {
					// Connection already closed or failed - safe to ignore
				}
			}
		}
	}

	/**
	 * Generate a database name for an app
	 * Format: airo_{sanitizedAppId}
	 *
	 * @param appId - The unique app identifier
	 * @returns Database name in format airo_{sanitizedAppId}
	 */
	private generateDatabaseName(appId: string): string {
		const sanitized = sanitizeForMySQL(appId);
		return `airo_${sanitized}`;
	}

	/**
	 * Generate a username for an app
	 * Format: user_airo_{sanitizedAppId}
	 * Truncated to 32 characters (MySQL username limit)
	 * Uses hash suffix if name would be too long to avoid collisions
	 *
	 * @param appId - The unique app identifier
	 * @returns Username in format user_airo_{sanitizedAppId}, max 32 chars
	 */
	private generateUsername(appId: string): string {
		const sanitized = sanitizeForMySQL(appId);
		let username = `user_airo_${sanitized}`;

		// If too long, use a hash suffix to avoid collisions
		if (username.length > 32) {
			const hash = createHash('md5').update(appId).digest('hex').substring(0, 8);
			username = `user_airo_${hash}`;
		}

		return username.substring(0, 32);
	}

	/**
	 * Ensure the service is initialized before operations
	 *
	 * @throws {Error} If initialization fails
	 */
	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}
	}

	/**
	 * Sleep for a specified duration
	 *
	 * @param ms - Duration to sleep in milliseconds
	 * @returns Promise that resolves after the specified duration
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Get the shared MySQL connection details
	 * WARNING: Exposes sensitive credentials - for testing purposes only
	 *
	 * @returns Copy of root credentials (does not expose internal state)
	 * @internal
	 */
	getRootCredentials(): RootCredentials {
		return { ...this.rootCredentials };
	}
}
