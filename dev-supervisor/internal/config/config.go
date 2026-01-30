package config

import (
	"os"
	"slices"
	"strings"
	"time"
)

// Config holds all configuration for dev-supervisor
type Config struct {
	SocketPath             string
	ShowVersion            bool
	ShowHelp               bool
	ShutdownTimeout        time.Duration
	ProcessLogging         bool   // Enable/disable child process stdout/stderr logging
	ProcessLoggingToStdout bool   // Enable/disable outputting child process logs to structured logging (stdout)
	UseTCP                 bool   // Enable TCP mode instead of Unix socket (insecure, dev only)
	TCPPort                string // TCP port to listen on when UseTCP is true
	ProxyEnabled           bool   // Enable HTTP proxy mode
	ProxyPort              int    // External HTTPS port for proxy
	ProxyTargetHost        string // Proxy target host (backend host)
	ProxyTargetPort        int    // Proxy target port (backend port)
	ProxyCertPath          string // Path to TLS certificate
	ProxyKeyPath           string // Path to TLS private key

	// Static serving configuration
	ProxyStaticRoot    string   // Root directory for static files (required if ProxyServeStatic=true)
	ProxyServeStatic   bool     // Enable static file serving (explicit, default: false)
	ProxySPAMode       bool     // Enable SPA fallback (default: true)
	ProxyAPIPrefix     string   // API route prefix (default: /api)
	ProxyRoutingConfig string   // Optional routing config file path
	AllowedOrigins     []string // CORS allowed origins (comma-separated in env)

	// JWT authentication configuration
	// Auth failure handling uses hybrid mode: redirects browsers, returns 401 for APIs
	JWTEnabled        bool     // Enable JWT authentication (default: false)
	JWKSUrl           string   // JWKS endpoint URL
	JWKSSkipTLSVerify bool     // Skip TLS certificate verification for JWKS endpoint (local dev only)
	JWTRedirectURL    string   // Redirect URL on auth failure (supports {url} placeholder)
	JWTBuilderBaseURL string   // Builder app base URL for smart redirects (e.g., https://airo-builder.test-godaddy.com)
	SiteID            string   // Site ID for smart redirects (from SITE_ID env var)
	JWTExcludedPaths  []string // Paths to exclude from JWT validation

	// Start-on-request configuration (preview variant only)
	StartOnRequestEnabled bool          // Enable start-on-request (auto-start stopped apps, auto-stop idle apps)
	IdleTimeout           time.Duration // Duration of inactivity before auto-stopping (default: 30m)
	IdleCheckInterval     time.Duration // How often to check for idle timeout (default: 30s)
}

// LoadConfig loads configuration from environment variables with defaults
func LoadConfig() *Config {
	config := &Config{}

	// Socket/TCP configuration
	useTCP, tcpPort := getTCPConfig()
	config.UseTCP = useTCP
	config.TCPPort = tcpPort
	config.SocketPath = GetSocketPath()

	// Default shutdown timeout
	config.ShutdownTimeout = 10 * time.Second

	// Process logging configuration
	config.ProcessLogging = true                                // Default: enable child process logging
	config.ProcessLoggingToStdout = GetProcessLoggingToStdout() // Default: enable structured output, configurable via env

	// HTTP Proxy configuration from environment variables
	config.ProxyEnabled = GetEnvBoolWithDefault("DEV_SUPERVISOR_ENABLE_PROXY", false)
	config.ProxyPort = GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_PORT", 0)
	config.ProxyTargetHost = GetEnvStringWithDefault("DEV_SUPERVISOR_PROXY_TARGET_HOST", "localhost")
	config.ProxyTargetPort = GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_TARGET_PORT", 8080)
	config.ProxyCertPath = GetEnvStringWithDefault("DEV_SUPERVISOR_PROXY_CERT_PATH", "")
	config.ProxyKeyPath = GetEnvStringWithDefault("DEV_SUPERVISOR_PROXY_KEY_PATH", "")

	// Static serving configuration from environment variables
	// Default static root is /app/dist/client (standard Vite build output in container)
	config.ProxyStaticRoot = GetEnvStringWithDefault("DEV_SUPERVISOR_STATIC_ROOT", "/app/dist/client")
	config.ProxyServeStatic = GetEnvBoolWithDefault("DEV_SUPERVISOR_SERVE_STATIC", false)
	config.ProxySPAMode = GetEnvBoolWithDefault("DEV_SUPERVISOR_SPA_MODE", true)
	config.ProxyAPIPrefix = GetEnvStringWithDefault("DEV_SUPERVISOR_API_PREFIX", "/api")
	config.ProxyRoutingConfig = GetEnvStringWithDefault("DEV_SUPERVISOR_ROUTING_CONFIG", "")

	// Parse allowed origins using the same logic as vite.config.ts
	// This ensures dev-supervisor and Vite have identical CORS configurations
	config.AllowedOrigins = parseAllowedOrigins()

	// JWT authentication configuration from environment variables
	config.JWTEnabled = GetEnvBoolWithDefault("DEV_SUPERVISOR_ENABLE_JWT_AUTH", false)
	config.JWKSUrl = GetEnvStringWithDefault("DEV_SUPERVISOR_JWKS_URL", "")
	config.JWKSSkipTLSVerify = GetEnvBoolWithDefault("DEV_SUPERVISOR_JWKS_SKIP_TLS_VERIFY", false)
	config.JWTRedirectURL = GetEnvStringWithDefault("DEV_SUPERVISOR_JWT_REDIRECT_URL", "")
	config.JWTBuilderBaseURL = GetEnvStringWithDefault("DEV_SUPERVISOR_JWT_BUILDER_BASE_URL", "")

	// SITE_ID is required (no default) - must be set by docker-compose or production deployment
	config.SiteID = os.Getenv("SITE_ID")

	// Parse excluded paths (comma-separated)
	config.JWTExcludedPaths = parseJWTExcludedPaths()

	// Add /airo/health to excluded paths when proxy mode is enabled
	// This endpoint is used for deployment health checks and must be unauthenticated
	if config.ProxyEnabled {
		// Check if /airo/health is already excluded
		if !slices.Contains(config.JWTExcludedPaths, "/airo/health") {
			config.JWTExcludedPaths = append(config.JWTExcludedPaths, "/airo/health")
		}
	}

	// Start-on-request configuration (preview variant only)
	config.StartOnRequestEnabled = GetEnvBoolWithDefault("DEV_SUPERVISOR_ENABLE_START_ON_REQUEST", false)
	config.IdleTimeout = GetEnvDurationWithDefault("DEV_SUPERVISOR_IDLE_TIMEOUT", 30*time.Minute)
	config.IdleCheckInterval = GetEnvDurationWithDefault("DEV_SUPERVISOR_IDLE_CHECK_INTERVAL", 30*time.Second)

	// Only enable start-on-request for preview variant (safety check)
	const previewTaskName = "preview"
	taskName := os.Getenv("NOMAD_TASK_NAME")
	if config.StartOnRequestEnabled && taskName != previewTaskName {
		// Note: This will log after initLogging() is called in main
		config.StartOnRequestEnabled = false
	}

	return config
}

// GetSocketPath returns the socket path from environment or default
func GetSocketPath() string {
	// Check v4 environment variable first (AIRO_SUPERVISOR_SOCKET_PATH)
	if value := GetEnvStringWithDefault("AIRO_SUPERVISOR_SOCKET_PATH", ""); value != "" {
		return value
	}
	// Fall back to v3 environment variable (DEV_SUPERVISOR_SOCKET_PATH) for backward compatibility
	return GetEnvStringWithDefault("DEV_SUPERVISOR_SOCKET_PATH", "/tmp/airo-supervisor.sock")
}

// GetProcessLoggingToStdout returns process logging configuration
func GetProcessLoggingToStdout() bool {
	// Default is true (enabled), only disable if explicitly set to "true"
	return !GetEnvBoolWithDefault("DEV_SUPERVISOR_DISABLE_PROCESS_STDOUT", false)
}

// getTCPConfig returns TCP mode configuration
func getTCPConfig() (bool, string) {
	// Default to false (Unix socket mode)
	if !GetEnvBoolWithDefault("DEV_SUPERVISOR_USE_TCP", false) {
		return false, ""
	}

	// Default port if TCP is enabled but no port specified
	port := GetEnvStringWithDefault("DEV_SUPERVISOR_TCP_PORT", "8080")

	return true, port
}

// parseAllowedOrigins parses CORS allowed origins from environment
func parseAllowedOrigins() []string {
	var allowedOrigins []string

	// 1. Add FRONTEND_DOMAIN with http/https prefixes (if set)
	frontendDomain := os.Getenv("FRONTEND_DOMAIN")
	if frontendDomain != "" {
		allowedOrigins = append(allowedOrigins,
			frontendDomain,
			"http://"+frontendDomain,
			"https://"+frontendDomain,
		)
	}

	// 2. Add ALLOWED_ORIGINS (comma-separated list, if set)
	allowedOriginsStr := os.Getenv("ALLOWED_ORIGINS")
	if allowedOriginsStr != "" {
		origins := strings.Split(allowedOriginsStr, ",")
		allowedOrigins = append(allowedOrigins, origins...)
	}

	// 3. Add VITE_PARENT_ORIGIN (if set)
	viteParentOrigin := os.Getenv("VITE_PARENT_ORIGIN")
	if viteParentOrigin != "" {
		allowedOrigins = append(allowedOrigins, viteParentOrigin)
	}

	// Trim whitespace and remove duplicates
	seenOrigins := make(map[string]bool)
	var result []string
	for _, origin := range allowedOrigins {
		trimmed := strings.TrimSpace(origin)
		if trimmed != "" && !seenOrigins[trimmed] {
			seenOrigins[trimmed] = true
			result = append(result, trimmed)
		}
	}

	return result
}

// parseJWTExcludedPaths parses JWT excluded paths from environment
func parseJWTExcludedPaths() []string {
	excludedPathsStr := GetEnvStringWithDefault("DEV_SUPERVISOR_JWT_EXCLUDED_PATHS", "/airo/health")
	if excludedPathsStr == "" {
		return nil
	}

	paths := strings.Split(excludedPathsStr, ",")
	// Trim whitespace from each path
	for i := range paths {
		paths[i] = strings.TrimSpace(paths[i])
	}
	return paths
}
