import { randomBytes } from "crypto";
import { logger } from '../../request-context';

export interface ComposeServiceConfig {
	appId: string;
	appPort: number;
	templateVersion: string;
	appPath: string;
	imageName: string;
	uid: number;
	gid: number;
	useTcp: boolean;
	supervisorPort?: number;
	socketPath?: string;
}

export interface DatabaseConfig {
	host: string;
	port: number;
	hostMachinePort: number;
	database: string;
	user: string;
	password: string;
	rootPassword: string;
}

/**
 * Docker Compose file generator for app containers
 * Generates docker-compose.yml files for development apps
 */
export class DockerComposeGenerator {
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
	generatePassword(): string {
		return randomBytes(16).toString('hex');
	}

	/**
	 * Generate database configuration
	 */
	generateDatabaseConfig(appId: string, hostMachinePort: number): DatabaseConfig {
		return {
			host: 'db', // Simple service name within compose stack
			port: 3306,
			hostMachinePort,
			database: "appdb",
			user: "appuser",
			password: this.generatePassword(),
			rootPassword: this.generatePassword(),
		};
	}

	/**
	 * Generate environment variables for app service
	 */
	private generateAppEnvironment(config: ComposeServiceConfig, dbConfig?: DatabaseConfig): Record<string, string> {
		const env: Record<string, string> = {
			HOST: "0.0.0.0",
			NODE_ENV: "development",
		};

		// Dev-supervisor configuration
		if (config.useTcp && config.supervisorPort) {
			env.DEV_SUPERVISOR_USE_TCP = "true";
			env.DEV_SUPERVISOR_TCP_PORT = config.supervisorPort.toString();
		} else if (config.socketPath) {
			env.DEV_SUPERVISOR_SOCKET_PATH = "/tmp/supervisor/dev-supervisor.sock";
		}

		// Template-specific environment variables (v8)
		env.PORT = config.appPort.toString();
		env.VITE_HOST = "0.0.0.0";
		env.ALLOWED_ORIGINS = "http://localhost:3000,https://localhost:3000,https://airo-builder.godaddy.com,https://airo-builder.test-godaddy.com,https://airo-builder.dev-godaddy.com";

		// Database environment variables
		if (dbConfig) {
			env.DATABASE_URL = `mysql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
			env.MYSQL_HOST = dbConfig.host;
			env.MYSQL_PORT = dbConfig.port.toString();
			env.MYSQL_HOST_EXTERNAL = "localhost";
			env.MYSQL_PORT_EXTERNAL = dbConfig.hostMachinePort.toString();
			env.MYSQL_DATABASE = dbConfig.database;
			env.MYSQL_USER = dbConfig.user;
			env.MYSQL_PASSWORD = dbConfig.password;
			env.MYSQL_ROOT_PASSWORD = dbConfig.rootPassword;
		}

		return env;
	}

	/**
	 * Get port mapping for app service (v8 template)
	 */
	private getAppPortMapping(config: ComposeServiceConfig): string {
		return `${config.appPort}:${config.appPort}`;
	}

	/**
	 * Get anonymous volumes for app service (v8 template)
	 */
	private getAppVolumes(config: ComposeServiceConfig): string[] {
		const volumes = [
			`${config.appPath}:/app`,
			"/app/node_modules",
		];

		// Add dev-supervisor socket directory if using Unix socket mode
		if (!config.useTcp && config.socketPath) {
			const socketDir = config.socketPath.substring(0, config.socketPath.lastIndexOf('/'));
			volumes.push(`${socketDir}:/tmp/supervisor`);
		}

		// v8 template doesn't require additional volumes

		return volumes;
	}

	/**
	 * Generate docker-compose.yml content
	 */
	generateComposeFile(config: ComposeServiceConfig, dbConfig?: DatabaseConfig): string {
		const dockerSafeId = this.sanitizeAppId(config.appId);
		const networkName = `airo-app-${dockerSafeId}-network`;

		logger.info("compose.generate.begin", {
			appId: config.appId,
			templateVersion: config.templateVersion,
		});

		// Build environment variables
		const appEnv = this.generateAppEnvironment(config, dbConfig);
		const envLines = Object.entries(appEnv).map(([key, value]) => `      ${key}: "${value}"`).join('\n');

		// Build volumes
		const appVolumes = this.getAppVolumes(config);
		const volumeLines = appVolumes.map(vol => `      - ${vol}`).join('\n');

		// Build port mappings
		const ports = [this.getAppPortMapping(config)];
		if (config.useTcp && config.supervisorPort) {
			ports.push(`${config.supervisorPort}:${config.supervisorPort}`);
		}
		const portLines = ports.map(port => `      - "${port}"`).join('\n');

		// Build the compose file
		let composeContent = `---

services:
  app:
    build:
      context: ${config.appPath}
      dockerfile: Dockerfile.dev
      args:
        HOST_UID: ${config.uid}
        HOST_GID: ${config.gid}
    image: ${config.imageName}
    restart: unless-stopped
    ports:
${portLines}
    environment:
${envLines}
    volumes:
${volumeLines}
    networks:
      - app-network
`;

		// Add database dependency (always needed for v8)
		if (dbConfig) {
			composeContent += `    depends_on:
      db:
        condition: service_healthy
`;
		}

		// Add database service (always needed for v8)
		if (dbConfig) {
			composeContent += `
  db:
    image: mysql:8.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:${dbConfig.hostMachinePort}:3306"
    environment:
      MYSQL_ROOT_PASSWORD: "${dbConfig.rootPassword}"
      MYSQL_DATABASE: "${dbConfig.database}"
      MYSQL_USER: "${dbConfig.user}"
      MYSQL_PASSWORD: "${dbConfig.password}"
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - app-network
    command: --default-authentication-plugin=mysql_native_password
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "--silent"]
      interval: 2s
      timeout: 5s
      retries: 20
      start_period: 10s
`;
		}

		// Add networks and volumes
		composeContent += `
networks:
  app-network:
    driver: bridge
    name: ${networkName}

volumes:
  mysql-data:
    name: airo-app-${dockerSafeId}-mysql-data
`;

		logger.info("compose.generate.success", {
			appId: config.appId,
			services: 2, // app + database (v8 always includes database)
		});

		return composeContent;
	}

	/**
	 * Generate .env file content for host machine access
	 */
	generateEnvFile(dbConfig: DatabaseConfig, existingEnvContent?: string): string {
		logger.info("compose.env.generate.begin", {
			database: dbConfig.database,
		});

		// Parse existing content to preserve non-database variables
		const preservedLines: string[] = [];
		if (existingEnvContent) {
			const existingLines = existingEnvContent.split('\n');
			for (const line of existingLines) {
				const trimmed = line.trim();
				// Skip empty lines, comments, and database-related variables
				if (!trimmed || trimmed.startsWith('#')) {
					preservedLines.push(line);
				} else if (!trimmed.startsWith('MYSQL_') &&
				           !trimmed.startsWith('DATABASE_URL') &&
				           !trimmed.startsWith('DB_')) {
					preservedLines.push(line);
				}
			}
		}

		// Build the new .env content
		const envLines: string[] = [
			...preservedLines,
			'',
			'# Database credentials (auto-generated)',
			`DATABASE_URL=mysql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
			'',
			'# Internal Docker network endpoint (for app container)',
			`MYSQL_HOST=${dbConfig.host}`,
			`MYSQL_PORT=${dbConfig.port}`,
			'',
			'# External host machine endpoint (for agents service)',
			`MYSQL_HOST_EXTERNAL=localhost`,
			`MYSQL_PORT_EXTERNAL=${dbConfig.hostMachinePort}`,
			'',
			'# Database credentials',
			`MYSQL_DATABASE=${dbConfig.database}`,
			`MYSQL_USER=${dbConfig.user}`,
			`MYSQL_PASSWORD=${dbConfig.password}`,
			`MYSQL_ROOT_PASSWORD=${dbConfig.rootPassword}`,
			''
		];

		logger.info("compose.env.generate.success", {
			varCount: 8,
		});

		return envLines.join('\n');
	}
}
