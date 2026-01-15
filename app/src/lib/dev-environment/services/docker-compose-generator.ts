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
	enableJwtAuth?: boolean; // Enable JWT authentication in dev-supervisor
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

		// Parent origin for postMessage communication (iframe security)
		env.VITE_PARENT_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "https://local.gasket.dev-godaddy.com:8443";

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

		// JWT Authentication configuration (if enabled)
		if (config.enableJwtAuth) {
			env.DEV_SUPERVISOR_ENABLE_JWT_AUTH = "true";

			// Builder JWKS Configuration
			// Dev-supervisor validates site-scoped JWTs issued by the builder
			// using the builder's public keys from /.well-known/jwks.json
			const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://airo-builder.test-godaddy.com';
			env.DEV_SUPERVISOR_JWKS_URL = `${appUrl}/.well-known/jwks.json`;

			// Skip TLS verification for local development with self-signed certificates
			// Only enable for localhost or local.gasket.dev-godaddy.com URLs
			if (appUrl.includes('localhost') || appUrl.includes('local.gasket.dev-godaddy.com')) {
				env.DEV_SUPERVISOR_JWKS_SKIP_TLS_VERIFY = "true";
			}

			// JWT claims validation
			env.DEV_SUPERVISOR_JWT_ISSUER = 'airo-app';        // Must match builder's issuer
			env.DEV_SUPERVISOR_JWT_AUDIENCE = 'agents-service'; // Must match builder's audience

			// GoDaddy SSO Configuration for smart redirects
			// Extract SSO host from login URL (e.g., "sso.dev-godaddy.com")
			const ssoLoginUrl = process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';

			// Smart redirect configuration:
			// When users access preview apps directly (not via builder iframe), redirect them
			// to the builder with the specific app open instead of just the homepage.
			// Works for both:
			// - localhost:5001 (local: UUID format like 3d3bdcfd-a490-4475-a1a8-11c1a84e16d1)
			// - 41gb5nrnyl.c4.test-airoapp.ai (production: short format like 41gb5nrnyl)
			// Redirects to: https://airo-builder.{env}-godaddy.com/develop/{siteId}?siteId={siteId}
			env.DEV_SUPERVISOR_JWT_REDIRECT_URL = `${ssoLoginUrl}?app=airo-builder&redirect={url}`;
			env.DEV_SUPERVISOR_JWT_BUILDER_BASE_URL = appUrl; // Builder base URL for smart redirects
			env.DEV_SUPERVISOR_JWT_EXCLUDED_PATHS = "/api/health";

			// Auth failure handling uses hybrid mode (hardcoded in dev-supervisor):
			// - Browser requests (Accept: text/html): Redirect to SSO login page
			// - API/JSON requests: Return 401 Unauthorized with JSON error
		}

		// SITE_ID is required by dev-supervisor regardless of JWT auth status
		// Used for: logging context, X-SITE-UID header, SMTP proxy, and JWT smart redirects
		// In production, this is set by the deployment system. For local docker-compose, we set it explicitly.
		env.SITE_ID = config.appId;

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

		// Build extra_hosts for JWT auth (allows container to reach builder's JWKS endpoint)
		let extraHostsLines = '';
		if (config.enableJwtAuth) {
			const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://airo-builder.test-godaddy.com';
			const extraHosts = ['host.docker.internal:host-gateway'];

			// For local development, map builder hostname to host gateway
			// This allows containers to reach https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json
			// with proper TLS certificate validation
			if (appUrl.includes('local.gasket.dev-godaddy.com')) {
				extraHosts.push('local.gasket.dev-godaddy.com:host-gateway');
			}

			extraHostsLines = '    extra_hosts:\n' + extraHosts.map(host => `      - "${host}"`).join('\n') + '\n';
		}

		// Build the compose file with single app service (HTTP proxy in dev-supervisor)
		// Uses pre-built shared template image (aab-template-v8:latest) for all apps
		// This eliminates per-app build time, reducing app creation from ~72s to <5s
		const composeContent = `---

services:
  app:
    image: ${config.imageName}
    restart: unless-stopped
${portLines}${extraHostsLines}    environment:
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
