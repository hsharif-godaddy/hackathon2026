import type { DatabaseConfig } from '../services/docker-compose-generator';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { logger } from '../../request-context';

/**
 * Database secret value structure matching production config format
 */
export interface DatabaseSecretValue {
	/** Database name (e.g., airo_appid) */
	NAME: string;
	/** MySQL host (e.g., airo-app-mysql) */
	HOST: string;
	/** IP address (same as HOST for our use case) */
	IP: string;
	/** MySQL port */
	PORT: number;
	/** Database username */
	USERNAME: string;
	/** Database password */
	PASSWORD: string;
	/** Read-only username (reserved for future use) */
	READ_ONLY_USERNAME: string;
	/** Read-only password (reserved for future use) */
	READ_ONLY_PASSWORD: string;
	/** Environment variant */
	VARIANT: 'preview' | 'production' | 'local';
}

/**
 * Database secret wrapper with system-managed flag
 */
export interface DatabaseSecret {
	/** Indicates credentials are managed by the hosting system */
	SYSTEM_MANAGED: boolean;
	/** Database credentials and connection details */
	VALUE: DatabaseSecretValue;
}

/**
 * Root configuration structure for app secrets
 */
export interface AppSecretsConfig {
	/** Database configuration */
	DATABASE: DatabaseSecret;
}

/**
 * Configuration file paths
 */
export const CONFIG_PATHS = {
	/** Host path for config file: /tmp/apps/{appId}/config.json */
	host: (appId: string) => `/tmp/apps/${appId}/config.json`,
	/** Container path for config file: /alloc/config.json */
	container: '/alloc/config.json',
} as const;

/**
 * Utility class for managing JSON configuration files
 * Handles reading and writing database credentials in production-ready format
 */
export class ConfigJsonManager {
	/**
	 * Write configuration file with database credentials
	 *
	 * @param configPath - Absolute path to config.json file
	 * @param dbConfig - Database configuration from provisioning
	 * @throws Error if file write fails
	 */
	static writeConfigFile(configPath: string, dbConfig: DatabaseConfig): void {
		logger.info('config.write.begin', {
			configPath,
			database: dbConfig.database,
		});

		try {
			const config = this.fromDatabaseConfig(dbConfig);
			const jsonContent = JSON.stringify(config, null, 2);

			writeFileSync(configPath, jsonContent, {
				encoding: 'utf-8',
				mode: 0o600, // Owner read/write only
			});

			logger.info('config.write.success', {
				configPath,
				database: dbConfig.database,
			});
		} catch (error) {
			logger.error('config.write.failure', {
				configPath,
				error: error instanceof Error ? error.message : String(error),
			});

			throw new Error(
				`Failed to write config file at ${configPath}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Read configuration file
	 *
	 * @param configPath - Absolute path to config.json file
	 * @returns Parsed configuration object
	 * @throws Error if file doesn't exist or parsing fails
	 */
	static readConfigFile(configPath: string): AppSecretsConfig {
		logger.info('config.read.begin', {
			configPath,
		});

		if (!existsSync(configPath)) {
			logger.error('config.read.not_found', {
				configPath,
			});
			throw new Error(`Config file not found at ${configPath}`);
		}

		try {
			const content = readFileSync(configPath, 'utf-8');
			const config = JSON.parse(content) as AppSecretsConfig;

			logger.info('config.read.success', {
				configPath,
				database: config.DATABASE.VALUE.NAME,
			});

			return config;
		} catch (error) {
			logger.error('config.read.failure', {
				configPath,
				error: error instanceof Error ? error.message : String(error),
			});

			throw new Error(
				`Failed to read config file at ${configPath}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Convert DatabaseConfig to AppSecretsConfig format
	 *
	 * @param dbConfig - Database configuration from provisioning
	 * @returns Configuration in production format
	 */
	static fromDatabaseConfig(dbConfig: DatabaseConfig): AppSecretsConfig {
		return {
			DATABASE: {
				SYSTEM_MANAGED: true,
				VALUE: {
					NAME: dbConfig.database,
					HOST: dbConfig.host,
					IP: dbConfig.host, // IP matches HOST for consistency
					PORT: dbConfig.port,
					USERNAME: dbConfig.user,
					PASSWORD: dbConfig.password,
					// Read-only credentials reserved for future use
					READ_ONLY_USERNAME: `${dbConfig.user}_readonly`,
					READ_ONLY_PASSWORD: '', // Not implemented yet
					VARIANT: 'local', // Local development
				},
			},
		};
	}

	/**
	 * Extract DatabaseConfig from AppSecretsConfig
	 * Useful for backward compatibility and testing
	 *
	 * @param config - App secrets configuration
	 * @returns Database configuration
	 */
	static toDatabaseConfig(config: AppSecretsConfig): DatabaseConfig {
		const dbValue = config.DATABASE.VALUE;

		return {
			host: dbValue.HOST,
			port: dbValue.PORT,
			hostMachinePort: dbValue.PORT, // Same for shared MySQL
			database: dbValue.NAME,
			user: dbValue.USERNAME,
			password: dbValue.PASSWORD,
			rootPassword: '', // Not stored in config
		};
	}

	/**
	 * Check if config file exists
	 *
	 * @param configPath - Absolute path to config.json file
	 * @returns True if file exists
	 */
	static exists(configPath: string): boolean {
		return existsSync(configPath);
	}
}
