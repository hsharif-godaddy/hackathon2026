import { getAllocPath, getBasePath } from '../utils/app-paths';
import { logger } from '../../request-context';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Constant container port for dev-supervisor TCP communication
 * Host ports are mapped to this container port via Docker port mapping
 */
const DEV_SUPERVISOR_CONTAINER_PORT = 8877;

/**
 * Fixed internal port for app container (not exposed externally)
 * Nginx proxy forwards to this port internally
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
	 * - App port configuration (internal port for nginx proxy)
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

		return env;
	}

	/**
	 * Generate nginx configuration for HTTPS termination and reverse proxy
	 *
	 * Creates a production-ready nginx configuration that provides:
	 *
	 * **SSL/TLS Termination**:
	 * - Terminates HTTPS at nginx layer using certificates from `/app/ssl/` directory
	 * - Supports TLS 1.2 and TLS 1.3 with secure cipher suites
	 * - HTTP/2 enabled for improved performance
	 * - Proxies to internal app container over HTTP (localhost-only traffic)
	 *
	 * **WebSocket Support**:
	 * - Full WebSocket upgrade support for Vite HMR (Hot Module Replacement)
	 * - Connection header mapping based on Upgrade header
	 * - Extended read timeout (24 hours) for long-lived connections
	 *
	 * **Request Forwarding**:
	 * - Preserves client IP via X-Real-IP and X-Forwarded-For headers
	 * - Forwards protocol information via X-Forwarded-Proto
	 * - Maintains Host header for proper routing
	 * - 50MB client body size limit for file uploads
	 *
	 * **DNS Resolution**:
	 * - Uses Docker embedded DNS (127.0.0.11) for dynamic service discovery
	 * - Container names resolved at request time (survives restarts)
	 * - Fully-qualified container name prevents DNS collisions on shared networks
	 * - 10-second DNS cache validity with 5-second timeout
	 *
	 * @param appId - Application ID for unique container naming (used in upstream server name)
	 * @param nginxPort - External HTTPS port for nginx to listen on (allocated by PortManager)
	 *
	 * @returns Complete nginx.conf file content as a string ready to be written to disk
	 *
	 * @example
	 * ```typescript
	 * const config = this.generateNginxConfig('my-app-123', 5001);
	 * writeFileSync('/tmp/nginx.conf', config);
	 * // Nginx will listen on :5001 (HTTPS) and proxy to app container (HTTP)
	 * ```
	 *
	 * @remarks
	 * - Upstream server: `airo-app-${appId}-app-1:${APP_INTERNAL_PORT}`
	 * - APP_INTERNAL_PORT is interpolated by Docker Compose from env var (default: 3000)
	 * - SSL certificates must exist at `/etc/nginx/ssl/cert.pem` and `/etc/nginx/ssl/key.pem`
	 * - DNS resolver (127.0.0.11) is Docker's internal DNS, not system DNS
	 * - Worker connections limit: 1024 concurrent connections per worker process
	 * - HTTP/2 enabled via `http2 on` directive (nginx 1.25.1+)
	 *
	 * @see {@link https://nginx.org/en/docs/http/websocket.html} nginx WebSocket proxying
	 * @see {@link https://docs.docker.com/network/drivers/bridge/#use-the-default-bridge-network} Docker DNS
	 */
	private generateNginxConfig(appId: string, nginxPort: number): string {
		const nginxConfig = `events {
    worker_connections 1024;
}

http {
    # Use Docker embedded DNS to resolve containers dynamically after restarts
    resolver 127.0.0.11 ipv6=off valid=10s;
    resolver_timeout 5s;

    # WebSocket upgrade support - map Connection header based on Upgrade header
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

	    upstream app_backend {
	        # Use fully-qualified container name to avoid DNS collisions on shared network
	        zone app_backend 64k;
	        server airo-app-${appId}-app-1:${APP_INTERNAL_PORT} resolve;
	    }

    server {
        listen ${nginxPort} ssl;
        http2 on;
        server_name localhost;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        client_max_body_size 50M;

        # Proxy all requests to app backend with WebSocket support
        location / {
            proxy_pass http://app_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
        }
    }
}`;

		return nginxConfig;
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
	 * Includes nginx proxy for HTTPS termination
	 */
	generateComposeFile(config: ComposeServiceConfig, dbConfig?: DatabaseConfig): string {
		logger.info("compose.generate.begin", {
			appId: config.appId,
			templateVersion: config.templateVersion,
		});

		// Generate and write nginx.conf to disk
		const basePath = getBasePath(config.appId);
		const nginxConfigPath = path.join(basePath, 'nginx.conf');
		const nginxConfigContent = this.generateNginxConfig(config.appId, config.appPort);
		writeFileSync(nginxConfigPath, nginxConfigContent, 'utf-8');

		logger.info("compose.nginx_config.created", {
			appId: config.appId,
			path: nginxConfigPath,
		});

		// Build environment variables
		const appEnv = this.generateAppEnvironment(config, dbConfig);
		const envLines = Object.entries(appEnv).map(([key, value]) => `      ${key}: "${value}"`).join('\n');

		// Build volumes
		const appVolumes = this.getAppVolumes(config);
		const volumeLines = appVolumes.map(vol => `      - ${vol}`).join('\n');

		// Build port mappings for dev-supervisor only (if TCP mode)
		const supervisorPorts: string[] = [];
		if (config.useTcp && config.socketPath?.startsWith('tcp://')) {
			try {
				const url = new URL(config.socketPath);
				const supervisorPort = parseInt(url.port);
				if (supervisorPort && !isNaN(supervisorPort)) {
					// Map host port to constant container port
					supervisorPorts.push(`${supervisorPort}:${DEV_SUPERVISOR_CONTAINER_PORT}`);
				}
			} catch (error) {
				logger.warn("compose.generate.port_parse_failed", {
					socketPath: config.socketPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const supervisorPortLines = supervisorPorts.length > 0
			? '    ports:\n' + supervisorPorts.map(port => `      - "${port}"`).join('\n') + '\n'
			: '';

		// Build the compose file with nginx proxy + app service
		// Uses pre-built shared template image (aab-template-v8:latest) for all apps
		// This eliminates per-app build time, reducing app creation from ~72s to <5s
		const composeContent = `---

services:
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "${config.appPort}:${config.appPort}"
    volumes:
      - ${basePath}/nginx.conf:/etc/nginx/nginx.conf:ro
      - ${config.appPath}/.ssl:/etc/nginx/ssl:ro
    depends_on:
      - app
    networks:
      - app-network

  app:
    image: ${config.imageName}
    restart: unless-stopped
${supervisorPortLines}    environment:
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
			services: 2, // nginx + app
		});

		return composeContent;
	}

}
