package docker

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

const (
	devSupervisorContainerPort = 8877
	previewInternalPort        = 20010
	publishInternalPort        = 20011
	containerMemoryMaxMB       = 2048
	containerMemorySoftMB      = 512
	goMemLimitMB               = 128
)

// GenerateComposeFile creates a docker-compose.yml for an app's preview and publish services.
func GenerateComposeFile(app *store.App, basePath string) string {
	preview := generatePreviewService(app, basePath)
	publish := generatePublishService(app, basePath)

	return fmt.Sprintf(`---

services:
%s

%s

networks:
  app-network:
    external: true
    name: airo-network
`, preview, publish)
}

func generatePreviewService(app *store.App, basePath string) string {
	appPath := basePath + "/preview"
	allocPath := basePath + "/alloc"
	gitRepoPath := basePath + "/git-repo"
	assetsPath := basePath + "/assets"
	distPath := basePath + "/dist"
	tmpPath := basePath + "/tmp"
	previewLocalPath := basePath + "/local/preview"

	env := generatePreviewEnvironment(app)
	envLines := formatEnvLines(env)

	volumes := []string{
		fmt.Sprintf("%s:/app", appPath),
		fmt.Sprintf("%s:/dist", distPath),
		fmt.Sprintf("%s:/alloc", allocPath),
		fmt.Sprintf("%s:/local", previewLocalPath),
		fmt.Sprintf("%s/.git:/app/.git", gitRepoPath),
		fmt.Sprintf("%s/public:/shared-storage/public", assetsPath),
		fmt.Sprintf("%s/private:/shared-storage/private", assetsPath),
		fmt.Sprintf("%s:/tmp", tmpPath),
	}
	volumeLines := formatVolumeLines(volumes)

	ports := []string{
		fmt.Sprintf(`"%d:%d"`, app.PreviewPort, app.PreviewPort),
		fmt.Sprintf(`"%d:%d"`, app.SupervisorPort, devSupervisorContainerPort),
	}
	portLines := formatPortLines(ports)

	appURL := getEnvOrDefault("NEXT_PUBLIC_APP_URL", "https://local.gasket.dev-godaddy.com:8443")
	extraHosts := `    extra_hosts:
      - "host.docker.internal:host-gateway"`
	if strings.Contains(appURL, "local.gasket.dev-godaddy.com") {
		extraHosts += `
      - "local.gasket.dev-godaddy.com:host-gateway"`
	}

	return fmt.Sprintf(`  preview:
    image: aab-template-v8:latest
    restart: unless-stopped
    container_name: preview-%s-1
    mem_limit: 2g
    ports:
%s
%s
    environment:
%s
    volumes:
%s
    networks:
      - app-network
    deploy:
      resources:
        limits:
          memory: %dM
        reservations:
          memory: %dM
    expose:
      - "%d"`,
		app.ID, portLines, extraHosts, envLines, volumeLines,
		containerMemoryMaxMB, containerMemorySoftMB, previewInternalPort)
}

func generatePublishService(app *store.App, basePath string) string {
	allocPath := basePath + "/alloc"
	distPath := basePath + "/dist"
	publishPath := basePath + "/publish"
	assetsPath := basePath + "/assets"
	tmpPath := basePath + "/tmp"
	publishLocalPath := basePath + "/local/publish"
	sslPath := allocPath + "/.ssl"

	env := generatePublishEnvironment(app)
	envLines := formatEnvLines(env)

	volumes := []string{
		fmt.Sprintf("%s:/dist", distPath),
		fmt.Sprintf("%s:/app", publishPath),
		fmt.Sprintf("%s:/alloc", allocPath),
		fmt.Sprintf("%s:/local", publishLocalPath),
		fmt.Sprintf("%s:/app/.ssl:ro", sslPath),
		fmt.Sprintf("%s/public:/shared-storage/public", assetsPath),
		fmt.Sprintf("%s/private:/shared-storage/private", assetsPath),
		fmt.Sprintf("%s:/tmp", tmpPath),
	}
	volumeLines := formatVolumeLines(volumes)

	var ports []string
	if app.PublishPort > 0 {
		ports = append(ports, fmt.Sprintf(`"%d:%d"`, app.PublishPort, app.PublishPort))
	}
	if app.PublishSupervisorPort > 0 {
		ports = append(ports, fmt.Sprintf(`"%d:8878"`, app.PublishSupervisorPort))
	}
	portLines := formatPortLines(ports)

	return fmt.Sprintf(`  publish:
    image: aab-publish:latest
    restart: unless-stopped
    container_name: publish-%s-1
    mem_limit: 2g
    command: ["exec", "/publish/run-app.sh"]
    ports:
%s
    environment:
%s
    volumes:
%s
    networks:
      - app-network
    deploy:
      resources:
        limits:
          memory: %dM
        reservations:
          memory: %dM
    expose:
      - "%d"`,
		app.ID, portLines, envLines, volumeLines,
		containerMemoryMaxMB, containerMemorySoftMB, publishInternalPort)
}

func generatePreviewEnvironment(app *store.App) map[string]string {
	appURL := getEnvOrDefault("NEXT_PUBLIC_APP_URL", "https://local.gasket.dev-godaddy.com:8443")
	agentsBaseURL := getEnvOrDefault("AGENTS_BASE_URL", "http://host.docker.internal:4000")

	env := map[string]string{
		"HOST":     "127.0.0.1",
		"NODE_ENV": "development",

		// Supervisor TCP mode
		"DEV_SUPERVISOR_USE_TCP":  "true",
		"DEV_SUPERVISOR_TCP_PORT": fmt.Sprintf("%d", devSupervisorContainerPort),

		// App port
		"PORT":      fmt.Sprintf("%d", previewInternalPort),
		"VITE_HOST": "127.0.0.1",

		// CORS
		"ALLOWED_ORIGINS": strings.Join([]string{
			"https://local.gasket.dev-godaddy.com:8443",
			"https://airo-builder.test-godaddy.com",
			"https://airo-builder.godaddy.com",
			"https://airo-builder.dev-godaddy.com",
			"https://localhost:3000",
			"http://localhost:3000",
		}, ","),

		"VITE_PARENT_ORIGIN": appURL,

		// HTTP proxy
		"DEV_SUPERVISOR_ENABLE_PROXY":       "true",
		"DEV_SUPERVISOR_PROXY_PORT":         fmt.Sprintf("%d", app.PreviewPort),
		"DEV_SUPERVISOR_PROXY_TARGET_HOST":  "localhost",
		"DEV_SUPERVISOR_PROXY_TARGET_PORT":  fmt.Sprintf("%d", previewInternalPort),
		"DEV_SUPERVISOR_PROXY_CERT_PATH":    "/app/.ssl/cert.pem",
		"DEV_SUPERVISOR_PROXY_KEY_PATH":     "/app/.ssl/key.pem",
		"DEV_SUPERVISOR_LOG_LEVEL":          "debug",
		"DEV_SUPERVISOR_PROXY_MAX_RETRIES":  "10",
		"DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS": "200",
		"DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS":     "5000",

		// Go memory limit
		"GOMEMLIMIT": fmt.Sprintf("%dMiB", goMemLimitMB),

		// JWT auth
		"DEV_SUPERVISOR_ENABLE_JWT_AUTH":         "true",
		"DEV_SUPERVISOR_JWKS_URL":               appURL + "/.well-known/jwks.json",
		"DEV_SUPERVISOR_JWKS_SKIP_TLS_VERIFY":   "true",
		"DEV_SUPERVISOR_JWT_ISSUER":             "airo-app",
		"DEV_SUPERVISOR_JWT_AUDIENCE":           "agents-service",
		"DEV_SUPERVISOR_JWT_EXCLUDED_PATHS":     "/airo/health",

		// Share tokens
		"DEV_SUPERVISOR_ENABLE_SHARE_TOKENS": "true",
		"DEV_SUPERVISOR_AGENTS_BASE_URL":     agentsBaseURL,

		// Site ID
		"SITE_ID": app.ID,

		// Nomad compatibility
		"NOMAD_ALLOC_DIR":  "/alloc",
		"NOMAD_TASK_DIR":   "/local",
		"NOMAD_TASK_NAME":  "preview",

		// Start-on-request
		"DEV_SUPERVISOR_ENABLE_START_ON_REQUEST": "true",
		"DEV_SUPERVISOR_IDLE_TIMEOUT":            "5m",
		"DEV_SUPERVISOR_IDLE_CHECK_INTERVAL":     "30s",

		// Mode-based startup
		"CUSTOMER_APP_DIR":                    "/app",
		"BASE_APP_DIR":                        "/app-template",
		"DEV_SUPERVISOR_SETUP_SCRIPT":         "/management-scripts/nomad_setup.sh",
		"DEV_SUPERVISOR_DEFER_RESTART_SETUP":  "true",

		// Persistent assets mount location (matches container volume mount)
		"PERSISTENT_ASSETS_DIR": "/shared-storage",
	}

	if v := os.Getenv("GODADDY_API_BASE_URL"); v != "" {
		env["GODADDY_API_BASE_URL"] = v
	}

	return env
}

func generatePublishEnvironment(app *store.App) map[string]string {
	env := map[string]string{
		"HOST":           "127.0.0.1",
		"NODE_ENV":       "production",
		"PORT":           fmt.Sprintf("%d", publishInternalPort),
		"DIST_DIR":       "/dist",
		"NOMAD_ALLOC_DIR": "/alloc",
		"NOMAD_TASK_DIR":  "/local",
		"NOMAD_TASK_NAME": "publish",
		"CUSTOMER_APP_DIR":           "",
		"DEV_SUPERVISOR_SETUP_SCRIPT": "",
		"GOMEMLIMIT":     fmt.Sprintf("%dMiB", goMemLimitMB),

		// Persistent assets mount location (matches container volume mount)
		"PERSISTENT_ASSETS_DIR": "/shared-storage",
	}

	if app.PublishSupervisorPort > 0 {
		env["DEV_SUPERVISOR_USE_TCP"] = "true"
		env["DEV_SUPERVISOR_TCP_PORT"] = "8878"
	}

	if app.PublishPort > 0 {
		env["DEV_SUPERVISOR_PUBLISH_HTTP_PORT"] = fmt.Sprintf("%d", app.PublishPort)
		env["DEV_SUPERVISOR_ENABLE_PROXY"] = "true"
		env["DEV_SUPERVISOR_PROXY_PORT"] = fmt.Sprintf("%d", app.PublishPort)
		env["DEV_SUPERVISOR_PROXY_TARGET_HOST"] = "localhost"
		env["DEV_SUPERVISOR_PROXY_TARGET_PORT"] = fmt.Sprintf("%d", publishInternalPort)
		env["DEV_SUPERVISOR_PROXY_CERT_PATH"] = "/app/.ssl/cert.pem"
		env["DEV_SUPERVISOR_PROXY_KEY_PATH"] = "/app/.ssl/key.pem"
		env["DEV_SUPERVISOR_PUBLISH_SERVE_STATIC"] = "false"
		env["DEV_SUPERVISOR_PUBLISH_INTERNAL_PORT"] = fmt.Sprintf("%d", publishInternalPort)
	}

	return env
}

func formatEnvLines(env map[string]string) string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var lines []string
	for _, k := range keys {
		lines = append(lines, fmt.Sprintf(`      %s: "%s"`, k, env[k]))
	}
	return strings.Join(lines, "\n")
}

func formatVolumeLines(vols []string) string {
	var lines []string
	for _, v := range vols {
		lines = append(lines, fmt.Sprintf("      - %s", v))
	}
	return strings.Join(lines, "\n")
}

func formatPortLines(ports []string) string {
	var lines []string
	for _, p := range ports {
		lines = append(lines, fmt.Sprintf("      - %s", p))
	}
	return strings.Join(lines, "\n")
}

func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
