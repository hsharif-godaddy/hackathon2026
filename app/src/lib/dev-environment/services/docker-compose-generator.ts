import { logger } from '../../request-context';

/**
 * Constant container port for dev-supervisor TCP communication
 * Host ports are mapped to this container port via Docker port mapping
 */
const DEV_SUPERVISOR_CONTAINER_PORT = 8877;

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
	 */
	private generateAppEnvironment(config: ComposeServiceConfig, dbConfig?: DatabaseConfig): Record<string, string> {
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
		env.PORT = config.appPort.toString();
		env.VITE_HOST = "0.0.0.0";
		env.ALLOWED_ORIGINS = "http://localhost:3000,https://localhost:3000,https://airo-builder.godaddy.com,https://airo-builder.test-godaddy.com,https://airo-builder.dev-godaddy.com";

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
			`${config.appPath}/config.json:/alloc/config.json:ro`, // Database credentials
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
	 * Note: Database service removed - apps now use shared MySQL instance
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
		const ports = [this.getAppPortMapping(config)];

		// Extract supervisor port from socketPath if in TCP mode
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

		const portLines = ports.map(port => `      - "${port}"`).join('\n');

		// Build the compose file (app service only - no per-app database)
		const composeContent = `---

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

networks:
  app-network:
    external: true
    name: airo-network
`;

		logger.info("compose.generate.success", {
			appId: config.appId,
			services: 1, // app only (database is shared)
		});

		return composeContent;
	}

}
