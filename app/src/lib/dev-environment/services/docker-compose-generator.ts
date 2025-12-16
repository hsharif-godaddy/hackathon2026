import { logger } from '../../request-context';
import { getAllocPath } from '../utils/app-paths';

/**
 * Constant container port for dev-supervisor TCP communication
 * Host ports are mapped to this container port via Docker port mapping
 */
const DEV_SUPERVISOR_CONTAINER_PORT = 8877;

/**
 * Fixed internal port for app container (not exposed externally)
 * Dev-supervisor HTTP proxy forwards to this port internally
 */
const APP_INTERNAL_PORT = 8080;

export interface ComposeServiceConfig {
	appId: string;
	appPort: number;
	templateVersion: string;
	appPath: string;
	imageName: string;
	uid: number;
	gid: number;
	useTcp: boolean;
	socketPath: string;
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
	 * Generate environment variables for app service
	 *
	 * Builds environment configuration including:
	 * - Basic runtime settings (HOST, NODE_ENV)
	 * - Dev-supervisor communication mode (TCP or Unix socket)
	 * - App port configuration (internal port for HTTP proxy)
	 * - Vite-specific settings (VITE_HOST, ALLOWED_ORIGINS)
	 * - GoDaddy API configuration (GODADDY_API_BASE_URL)
	 *
	 * @param config - Service configuration containing app details and connection settings
	 * @param _dbConfig - Optional database configuration (reserved for future use)
	 * @returns Record of environment variable key-value pairs for Docker Compose
	 */
	private generateAppEnvironment(config: ComposeServiceConfig, _dbConfig?: DatabaseConfig): Record<string, string> {
		const env: Record<string, string> = {
			HOST: "0.0.0.0",
			NODE_ENV: "development",
		};

		// Dev-supervisor configuration
		if (config.useTcp && config.socketPath?.startsWith('tcp://')) {
			// TCP mode - container always listens on constant port 8877
			env.DEV_SUPERVISOR_USE_TCP = "true";
			env.DEV_SUPERVISOR_TCP_PORT = DEV_SUPERVISOR_CONTAINER_PORT.toString();
		} else if (config.socketPath) {
			// Unix socket mode
			env.DEV_SUPERVISOR_SOCKET_PATH = "/tmp/supervisor/dev-supervisor.sock";
		}

		// Template-specific environment variables (v8)
		env.PORT = APP_INTERNAL_PORT.toString();
		env.VITE_HOST = "0.0.0.0";

		env.ALLOWED_ORIGINS = [
			"https://local.gasket.dev-godaddy.com:8443",
			"https://airo-builder.test-godaddy.com",
			"https://airo-builder.godaddy.com",
			"https://airo-builder.dev-godaddy.com",
			"https://localhost:3000",
			"http://localhost:3000"
		].join(",");

		// GoDaddy API base URL (if configured)
		if (process.env.GODADDY_API_BASE_URL) {
			env.GODADDY_API_BASE_URL = process.env.GODADDY_API_BASE_URL;
		}

		// HTTP Proxy configuration
		env.DEV_SUPERVISOR_ENABLE_PROXY = "true";
		env.DEV_SUPERVISOR_PROXY_PORT = config.appPort.toString();
		env.DEV_SUPERVISOR_PROXY_TARGET_HOST = "localhost";
		env.DEV_SUPERVISOR_PROXY_TARGET_PORT = APP_INTERNAL_PORT.toString();
		env.DEV_SUPERVISOR_PROXY_CERT_PATH = "/app/.ssl/cert.pem";
		env.DEV_SUPERVISOR_PROXY_KEY_PATH = "/app/.ssl/key.pem";
		env.DEV_SUPERVISOR_LOG_LEVEL = "debug";

		// HTTP Proxy retry configuration (generous for dev mode to handle slow startup)
		env.DEV_SUPERVISOR_PROXY_MAX_RETRIES = "10";
		env.DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS = "200";
		env.DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS = "5000";

		return env;
	}


	/**
	 * Get volume mount configurations for app service (v8 template)
	 *
	 * Configures Docker volume mounts including:
	 * - App code directory with hot reload support
	 * - Anonymous volume for node_modules (performance optimization)
	 * - Alloc directory for configuration and secrets (read-only)
	 * - Shared pnpm store directory (single volume shared across all local dev apps)
	 * - Dev-supervisor socket directory (Unix socket mode only)
	 *
	 * @param config - Service configuration containing paths and connection settings
	 * @returns Array of volume mount strings in Docker Compose format
	 */
	private getAppVolumes(config: ComposeServiceConfig): string[] {
		// Get alloc path using centralized utility
		const allocPath = getAllocPath(config.appId);

		const volumes = [
			// Mount app code directory for hot reload
			`${config.appPath}:/app`,
      // Anonymous volume for node_modules to improve performance
      // Prevents the copy of host node_modules into container at startup from being overwritten by the /app bind mount
      `/app/node_modules`,
			`${allocPath}:/alloc:ro`, // Mount alloc directory for config and secrets
		];

		// Add dev-supervisor socket directory if using Unix socket mode
		if (!config.useTcp && config.socketPath) {
			const socketDir = config.socketPath.substring(0, config.socketPath.lastIndexOf('/'));
			volumes.push(`${socketDir}:/tmp/supervisor`);
		}

		// Note: npm cache is handled by BuildKit cache mounts during build, not at runtime

		return volumes;
	}

	/**
	 * Generate docker-compose.yml content
	 * Note: Database service removed - apps now use shared MySQL instance
	 * HTTP proxy integrated into dev-supervisor
	 */
	generateComposeFile(config: ComposeServiceConfig, dbConfig?: DatabaseConfig): string {
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
		const ports: string[] = [];

		// HTTP proxy port
		ports.push(`${config.appPort}:${config.appPort}`);

		// Supervisor management API (if TCP mode)
		if (config.useTcp && config.socketPath?.startsWith('tcp://')) {
			try {
				const url = new URL(config.socketPath);
				const supervisorPort = parseInt(url.port);
				if (supervisorPort && !isNaN(supervisorPort)) {
					// Map host port to constant container port
					ports.push(`${supervisorPort}:${DEV_SUPERVISOR_CONTAINER_PORT}`);
				}
			} catch (error) {
				logger.warn("compose.generate.port_parse_failed", {
					socketPath: config.socketPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const portLines = ports.length > 0
			? '    ports:\n' + ports.map(port => `      - "${port}"`).join('\n') + '\n'
			: '';

		// Build the compose file with single app service (HTTP proxy in dev-supervisor)
		// Uses pre-built shared template image (aab-template-v8:latest) for all apps
		// This eliminates per-app build time, reducing app creation from ~72s to <5s
		const composeContent = `---

services:
  app:
    image: ${config.imageName}
    restart: unless-stopped
${portLines}    environment:
${envLines}
    volumes:
${volumeLines}
    networks:
      - app-network
    expose:
      - "${APP_INTERNAL_PORT}"

networks:
  app-network:
    external: true
    name: airo-network
`;

		logger.info("compose.generate.success", {
			appId: config.appId,
			services: 1, // Single app service with integrated HTTP proxy
			proxyMode: "dev-supervisor",
		});

		return composeContent;
	}

}
