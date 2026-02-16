import { logger } from '../../request-context';
import { getAllocPath } from '../utils/app-paths';

/**
 * Constant container port for dev-supervisor TCP communication
 * Host ports are mapped to this container port via Docker port mapping
 */
const DEV_SUPERVISOR_CONTAINER_PORT = 8877;

/**
 * Fixed internal ports for app containers (not exposed externally)
 * Dev-supervisor HTTP proxy forwards to these ports internally
 * These match production Nomad configuration for consistency
 */
const PREVIEW_INTERNAL_PORT = 20010;
const PUBLISH_INTERNAL_PORT = 20011;

/**
 * Memory configuration for app containers
 * Matches production Nomad resource allocations for consistency
 * - CONTAINER_MEMORY_SOFT_MB: Soft limit / reservation (512 MB)
 * - CONTAINER_MEMORY_MAX_MB: Hard memory limit / OOM kill threshold (2048 MB)
 * - GO_MEM_LIMIT_MB: Soft limit for Go dev-supervisor process (~6% of max = 128 MB)
 * This leaves ~94% of memory available for the NodeJS application
 */
const CONTAINER_MEMORY_SOFT_MB = 512;
const CONTAINER_MEMORY_MAX_MB = 2048;
const SUPERVISOR_MEMORY_PERCENT = 0.0625; // 6.25% of max memory for supervisor
const GO_MEM_LIMIT_MB = Math.floor(CONTAINER_MEMORY_MAX_MB * SUPERVISOR_MEMORY_PERCENT); // 128 MiB

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
	publishSupervisorPort?: number;
	publishPort?: number;
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
 * Supports both unified mode (single service) and separate mode (preview + publish services)
 */
export class DockerComposeGenerator {
	/**
	 * Generate environment variables for preview service
	 *
	 * Builds environment configuration for preview container including:
	 * - Development mode settings (NODE_ENV=development)
	 * - Preview supervisor configuration
	 * - App port configuration (internal port for HTTP proxy)
	 * - Vite-specific settings (VITE_HOST, ALLOWED_ORIGINS)
	 * - GoDaddy API configuration (GODADDY_API_BASE_URL)
	 *
	 * @param config - Service configuration containing app details and connection settings
	 * @returns Record of environment variable key-value pairs for Docker Compose
	 */
	private generatePreviewEnvironment(config: ComposeServiceConfig): Record<string, string> {
		const env: Record<string, string> = {
			HOST: "127.0.0.1",
			NODE_ENV: "development",
		};

		// Preview supervisor configuration
		if (config.useTcp && config.socketPath?.startsWith('tcp://')) {
			// TCP mode - container always listens on constant port 8877
			env.DEV_SUPERVISOR_USE_TCP = "true";
			env.DEV_SUPERVISOR_TCP_PORT = DEV_SUPERVISOR_CONTAINER_PORT.toString();
		} else if (config.socketPath) {
			// Unix socket mode
			env.DEV_SUPERVISOR_SOCKET_PATH = "/tmp/supervisor/dev-supervisor.sock";
		}

		// Template-specific environment variables (v8)
		env.PORT = PREVIEW_INTERNAL_PORT.toString();
		env.VITE_HOST = "127.0.0.1";

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

		// Preview HTTP Proxy configuration
		env.DEV_SUPERVISOR_ENABLE_PROXY = "true";
		env.DEV_SUPERVISOR_PROXY_PORT = config.appPort.toString();
		env.DEV_SUPERVISOR_PROXY_TARGET_HOST = "localhost";
		env.DEV_SUPERVISOR_PROXY_TARGET_PORT = PREVIEW_INTERNAL_PORT.toString();
		env.DEV_SUPERVISOR_PROXY_CERT_PATH = "/app/.ssl/cert.pem";
		env.DEV_SUPERVISOR_PROXY_KEY_PATH = "/app/.ssl/key.pem";
		env.DEV_SUPERVISOR_LOG_LEVEL = "debug";

		// HTTP Proxy retry configuration (generous for dev mode to handle slow startup)
		env.DEV_SUPERVISOR_PROXY_MAX_RETRIES = "10";
		env.DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS = "200";
		env.DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS = "5000";

		// Go runtime memory limit for dev-supervisor (matches production)
		env.GOMEMLIMIT = `${GO_MEM_LIMIT_MB}MiB`;

		// JWT Authentication configuration (if enabled)
		if (config.enableJwtAuth) {
			env.DEV_SUPERVISOR_ENABLE_JWT_AUTH = "true";

			// Builder JWKS Configuration
			// Dev-supervisor validates site-scoped JWTs issued by the builder
			// using the builder's public keys from /.well-known/jwks.json
			const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://local.gasket.dev-godaddy.com:8443';
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
			const ssoLoginUrl = process.env.SSO_LOGIN_URL || 'https://sso.dev-godaddy.com/login';

			// Smart redirect configuration:
			// When users access preview apps directly (not via builder iframe), redirect them
			// to the builder with the specific app open instead of just the homepage.
			// Works for both:
			// - localhost:5001 (local: UUID format like 3d3bdcfd-a490-4475-a1a8-11c1a84e16d1)
			// - 41gb5nrnyl.c4.test-airoapp.ai (production: short format like 41gb5nrnyl)
			// Redirects to: https://airo-builder.{env}-godaddy.com/?redirect=%2Fdevelop%2F{siteId}%3FsiteId%3D{siteId}
			env.DEV_SUPERVISOR_JWT_REDIRECT_URL = `${ssoLoginUrl}?app=airo-builder&redirect={url}`;
			env.DEV_SUPERVISOR_JWT_BUILDER_BASE_URL = appUrl; // Builder base URL for smart redirects
			env.DEV_SUPERVISOR_JWT_EXCLUDED_PATHS = "/airo/health";

			// Auth failure handling uses hybrid mode (hardcoded in dev-supervisor):
			// - Browser requests (Accept: text/html): Redirect to SSO login page
			// - API/JSON requests: Return 401 Unauthorized with JSON error
		}

		// Share Token Authentication (Public Preview Links)
		// Enables unauthenticated preview access via share tokens (e.g., ?airoShareToken=abc123)
		// When enabled, dev-supervisor validates tokens with the agents API before falling back to JWT
		env.DEV_SUPERVISOR_ENABLE_SHARE_TOKENS = "true";
		const agentsBaseUrl = process.env.AGENTS_BASE_URL || 'http://host.docker.internal:4000';
		env.DEV_SUPERVISOR_AGENTS_BASE_URL = agentsBaseUrl;

		// SITE_ID is required by dev-supervisor regardless of JWT auth status
		// Used for: logging context, X-SITE-UID header, SMTP proxy, and JWT smart redirects
		// In production, this is set by the deployment system. For local docker-compose, we set it explicitly.
		env.SITE_ID = config.appId;

		// Start-on-request configuration (preview only)
		// Automatically starts the process when a request arrives and stops it after idle timeout
		// NOMAD_TASK_NAME signals the variant (required for start-on-request to activate)
		env.NOMAD_TASK_NAME = "preview";
		env.DEV_SUPERVISOR_ENABLE_START_ON_REQUEST = "true";
		env.DEV_SUPERVISOR_IDLE_TIMEOUT = "5m";           // Stop after 5 minutes of inactivity
		env.DEV_SUPERVISOR_IDLE_CHECK_INTERVAL = "30s";   // Check for idle timeout every 30 seconds

		return env;
	}

	/**
	 * Generate environment variables for publish service
	 *
	 * Builds environment configuration for publish container including:
	 * - Production mode settings (NODE_ENV=production)
	 * - Publish supervisor configuration
	 * - Dist directory configuration
	 *
	 * @param config - Service configuration containing app details and connection settings
	 * @returns Record of environment variable key-value pairs for Docker Compose
	 */
	private generatePublishEnvironment(config: ComposeServiceConfig): Record<string, string> {
		const env: Record<string, string> = {
			HOST: "127.0.0.1",
			NODE_ENV: "production",
			PORT: PUBLISH_INTERNAL_PORT.toString(),
			DIST_DIR: "/dist",
		};

		// Identify this as the publish variant (always-on, no start-on-request)
		env.NOMAD_TASK_NAME = "publish";

		// Publish supervisor configuration
		if (config.publishSupervisorPort) {
			env.DEV_SUPERVISOR_USE_TCP = "true";
			env.DEV_SUPERVISOR_TCP_PORT = "8878"; // Different container port for publish supervisor
		}

		// Publish HTTP port
		if (config.publishPort) {
			env.DEV_SUPERVISOR_PUBLISH_HTTP_PORT = config.publishPort.toString();
		}

		// Publish HTTP Proxy configuration
		if (config.publishPort) {
			env.DEV_SUPERVISOR_ENABLE_PROXY = "true";
			env.DEV_SUPERVISOR_PROXY_PORT = config.publishPort.toString();
			env.DEV_SUPERVISOR_PROXY_TARGET_HOST = "localhost";
			env.DEV_SUPERVISOR_PROXY_TARGET_PORT = PUBLISH_INTERNAL_PORT.toString();
			env.DEV_SUPERVISOR_PROXY_CERT_PATH = "/app/.ssl/cert.pem";
			env.DEV_SUPERVISOR_PROXY_KEY_PATH = "/app/.ssl/key.pem";
			env.DEV_SUPERVISOR_PUBLISH_SERVE_STATIC = "false";
			env.DEV_SUPERVISOR_PUBLISH_INTERNAL_PORT = PUBLISH_INTERNAL_PORT.toString();
		}

		// Go runtime memory limit for dev-supervisor (matches production)
		env.GOMEMLIMIT = `${GO_MEM_LIMIT_MB}MiB`;

		return env;
	}


	/**
	 * Generate preview service definition for docker-compose
	 * Used when running in separate containers mode
	 */
	private generatePreviewService(config: ComposeServiceConfig): string {
		const allocPath = getAllocPath(config.appId);

		// V4 aligned volumes with bind mounts
		const gitRepoPath = config.appPath.replace(/\/preview$/, '/git-repo');
		const assetsPath = config.appPath.replace(/\/preview$/, '/assets');
		const distPath = config.appPath.replace(/\/preview$/, '/dist');
		const tmpPath = config.appPath.replace(/\/preview$/, '/tmp');

		const previewEnv = this.generatePreviewEnvironment(config);
		const envLines = Object.entries(previewEnv).map(([key, value]) => `      ${key}: "${value}"`).join('\n');

		// Note: node_modules is at /node_modules in the image (not /app/node_modules)
		// This allows the /app bind mount without needing a 549MB anonymous volume copy
		const volumes = [
			`${config.appPath}:/app`,                           // Preview workspace
			`${distPath}:/dist`,                                // Dist directory
			`${allocPath}:/alloc:ro`,                           // Config/secrets
			`${gitRepoPath}/.git:/app/.git`,                    // Git repo bind mount
			`${assetsPath}/public:/app/public/assets`,          // Public assets
			`${assetsPath}/private:/private`,                   // Private assets
			`${tmpPath}:/tmp`,                                  // Temp directory
		];

		if (!config.useTcp && config.socketPath) {
			const socketDir = config.socketPath.substring(0, config.socketPath.lastIndexOf('/'));
			volumes.push(`${socketDir}:/tmp/supervisor`);
		}

		const volumeLines = volumes.map(vol => `      - ${vol}`).join('\n');

		const ports: string[] = [];
		ports.push(`${config.appPort}:${config.appPort}`);

		if (config.useTcp && config.socketPath?.startsWith('tcp://')) {
			try {
				const url = new URL(config.socketPath);
				const supervisorPort = parseInt(url.port);
				if (supervisorPort && !isNaN(supervisorPort)) {
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

		// Build extra_hosts for JWT auth (allows container to reach builder's JWKS endpoint)
		let extraHostsLines = '';
			if (config.enableJwtAuth) {
				const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://local.gasket.dev-godaddy.com:8443';
				const extraHosts = ['host.docker.internal:host-gateway'];

			// For local development, map builder hostname to host gateway
			// This allows containers to reach https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json
			// with proper TLS certificate validation
			if (appUrl.includes('local.gasket.dev-godaddy.com')) {
				extraHosts.push('local.gasket.dev-godaddy.com:host-gateway');
			}

			extraHostsLines = '    extra_hosts:\n' + extraHosts.map(host => `      - "${host}"`).join('\n') + '\n';
			}

			return `  preview:
    image: ${config.imageName}
    restart: unless-stopped
    container_name: preview-${config.appId}-1
    ports:
${portLines}
${extraHostsLines}    environment:
${envLines}
    volumes:
${volumeLines}
    networks:
      - app-network
    deploy:
      resources:
        limits:
          memory: ${CONTAINER_MEMORY_MAX_MB}M
        reservations:
          memory: ${CONTAINER_MEMORY_SOFT_MB}M
    expose:
      - "${PREVIEW_INTERNAL_PORT}"`;
		}

	/**
	 * Generate publish service definition for docker-compose
	 * Used when running in separate containers mode
	 */
	private generatePublishService(config: ComposeServiceConfig): string {
		const allocPath = getAllocPath(config.appId);
		const distPath = config.appPath.replace(/\/preview$/, '/dist');
		const publishPath = config.appPath.replace(/\/preview$/, '/publish');
		const assetsPath = config.appPath.replace(/\/preview$/, '/assets');
		const tmpPath = config.appPath.replace(/\/preview$/, '/tmp');

		const publishEnv = this.generatePublishEnvironment(config);
		const envLines = Object.entries(publishEnv).map(([key, value]) => `      ${key}: "${value}"`).join('\n');

		// Publish container volumes - matches production architecture
		// /dist is mounted READ-WRITE so supervisor can create/update symlinks
		// Extraction happens in container's /app (not shared /dist)
		// SSL certs mounted for HTTPS proxy from alloc/.ssl
		const sslPath = allocPath + '/.ssl';
		const volumes = [
			`${distPath}:/dist`,
			`${publishPath}:/app`,
			`${allocPath}:/alloc:ro`,
			`${sslPath}:/app/.ssl:ro`,
			`${assetsPath}/public:/app/public/assets`,
			`${assetsPath}/private:/private`,
			`${tmpPath}:/tmp`,
		];

		const volumeLines = volumes.map(vol => `      - ${vol}`).join('\n');

		const ports: string[] = [];

		if (config.publishPort) {
			ports.push(`${config.publishPort}:${config.publishPort}`);
		}

		if (config.publishSupervisorPort) {
			ports.push(`${config.publishSupervisorPort}:8878`);
		}

			const portLines = ports.map(port => `      - "${port}"`).join('\n');

			// Use dedicated publish image (no source code, production parity)
			// Pre-built by ensurePublishImage() before compose stack creation
			return `  publish:
    image: aab-publish:latest
    restart: unless-stopped
    container_name: publish-${config.appId}-1
    command: ["exec", "/publish/run-app.sh"]
    ports:
${portLines}
    environment:
${envLines}
    volumes:
${volumeLines}
    networks:
      - app-network
    deploy:
      resources:
        limits:
          memory: ${CONTAINER_MEMORY_MAX_MB}M
        reservations:
          memory: ${CONTAINER_MEMORY_SOFT_MB}M
    expose:
      - "${PUBLISH_INTERNAL_PORT}"`;
		}

	/**
	 * Generate docker-compose.yml content
	 * Supports both unified mode (single service) and separate mode (preview + publish services)
	 * Note: Database service removed - apps now use shared MySQL instance
	 * HTTP proxy integrated into dev-supervisor
	 */
	generateComposeFile(config: ComposeServiceConfig): string {
		logger.info("compose.generate.begin", {
			appId: config.appId,
			templateVersion: config.templateVersion,
			mode: "separate-containers",
		});

		// Always generate separate preview and publish services
		const previewService = this.generatePreviewService(config);
		const publishService = this.generatePublishService(config);
		const servicesContent = `${previewService}\n\n${publishService}`;

		const composeContent = `---

services:
${servicesContent}

networks:
  app-network:
    external: true
    name: airo-network
`;

		logger.info("compose.generate.success", {
			appId: config.appId,
			services: 2,
			mode: "separate-containers",
		});

		return composeContent;
	}

}
