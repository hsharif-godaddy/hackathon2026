package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
)

const (
	Version            = "0.2.0"
	AppName            = "airo-supervisor"
	defaultTimeout     = 120 * time.Second
	serverReadyTimeout = 5 * time.Second
)

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

// configureSchedulerDefaults re-enables Go 1.25's automatic container-aware scheduler tuning.
func configureSchedulerDefaults() {
	previous := runtime.GOMAXPROCS(0)
	runtime.SetDefaultGOMAXPROCS()
	updated := runtime.GOMAXPROCS(0)

	if updated != previous {
		slog.Info("gomaxprocs adjusted to match container limits", "previous", previous, "current", updated)
	} else {
		slog.Debug("gomaxprocs already matches container limits", "current", updated)
	}

	logGodebugSchedulerSettings()
}

// logGodebugSchedulerSettings surfaces container scheduler GODEBUG overrides for easier troubleshooting.
func logGodebugSchedulerSettings() {
	settings := parseGodebugSettings()

	if value, ok := settings["containermaxprocs"]; ok && value == "0" {
		slog.Warn("GODEBUG disabled containermaxprocs; gomaxprocs will ignore cgroup quotas", "setting", value)
	}

	if value, ok := settings["updatemaxprocs"]; ok && value == "0" {
		slog.Warn("GODEBUG disabled gomaxprocs updates; changes to CPU quotas will be ignored", "setting", value)
	}
}

// parseGodebugSettings splits the GODEBUG environment variable into a map for quick lookups.
func parseGodebugSettings() map[string]string {
	raw := os.Getenv("GODEBUG")
	settings := make(map[string]string)
	if raw == "" {
		return settings
	}

	entries := strings.Split(raw, ",")
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			continue
		}
		settings[parts[0]] = parts[1]
	}

	return settings
}

func getSocketPath() string {
	// Check v4 environment variable first (AIRO_SUPERVISOR_SOCKET_PATH)
	if value := getEnvStringWithDefault("AIRO_SUPERVISOR_SOCKET_PATH", ""); value != "" {
		return value
	}
	// Fall back to v3 environment variable (DEV_SUPERVISOR_SOCKET_PATH) for backward compatibility
	return getEnvStringWithDefault("DEV_SUPERVISOR_SOCKET_PATH", "/tmp/airo-supervisor.sock")
}

func getProcessLoggingToStdout() bool {
	// Default is true (enabled), only disable if explicitly set to "true"
	return !getEnvBoolWithDefault("DEV_SUPERVISOR_DISABLE_PROCESS_STDOUT", false)
}

func getTCPConfig() (bool, string) {
	// Default to false (Unix socket mode)
	if !getEnvBoolWithDefault("DEV_SUPERVISOR_USE_TCP", false) {
		return false, ""
	}

	// Default port if TCP is enabled but no port specified
	port := getEnvStringWithDefault("DEV_SUPERVISOR_TCP_PORT", "8080")

	return true, port
}

type Server struct {
	router                 *mux.Router
	procMgr                *ProcessManager
	cmdExec                *CommandExecutor
	envMgr                 *EnvironmentManager
	logMgr                 *LogManager
	pid1Mgr                *PID1Manager
	smtpProxy              *SMTPProxy
	httpProxy              *HTTPProxy
	startTime              time.Time
	config                 *Config
	processLogging         bool // Current process logging configuration
	processLoggingToStdout bool // Current structured logging configuration
}

type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Uptime  string `json:"uptime"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func NewServer() *Server {
	logMgr := NewLogManager(10000)
	pid1Mgr := NewPID1Manager()
	procMgr := NewProcessManager(logMgr, pid1Mgr)

	// Set default configuration
	procMgr.SetProcessLogging(true)                           // Default: enable child process logging
	procMgr.SetStructuredLogging(getProcessLoggingToStdout()) // Default: enable structured output, configurable via env

	s := &Server{
		router:                 mux.NewRouter(),
		logMgr:                 logMgr,
		pid1Mgr:                pid1Mgr,
		procMgr:                procMgr,
		cmdExec:                NewCommandExecutor(),
		envMgr:                 NewEnvironmentManager(),
		smtpProxy:              NewSMTPProxy(),
		startTime:              time.Now(),
		processLogging:         true,                        // Default: enable child process logging
		processLoggingToStdout: getProcessLoggingToStdout(), // Default: enable structured output, configurable via env
	}

	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	// Health endpoints
	s.router.HandleFunc("/health", s.handleHealth).Methods("GET")
	s.router.HandleFunc("/info", s.handleInfo).Methods("GET")

	// Process control endpoints
	processRouter := s.router.PathPrefix("/process").Subrouter()
	processRouter.HandleFunc("/start", s.handleProcessStart).Methods("POST")
	processRouter.HandleFunc("/stop", s.handleProcessStop).Methods("POST")
	processRouter.HandleFunc("/restart", s.handleProcessRestart).Methods("POST")
	processRouter.HandleFunc("/status", s.handleProcessStatus).Methods("GET")

	// Command execution endpoints
	s.router.HandleFunc("/exec", s.handleExec).Methods("POST")

	// Environment management endpoints
	envRouter := s.router.PathPrefix("/environment").Subrouter()
	envRouter.HandleFunc("", s.handleEnvironmentGet).Methods("GET")
	envRouter.HandleFunc("", s.handleEnvironmentSet).Methods("PUT")
	envRouter.HandleFunc("", s.handleEnvironmentReset).Methods("DELETE")

	// Log endpoints
	logRouter := s.router.PathPrefix("/logs").Subrouter()
	logRouter.HandleFunc("", s.handleLogs).Methods("GET")
	logRouter.HandleFunc("/stream", s.handleLogsStream).Methods("GET")
	logRouter.HandleFunc("/config", s.handleLogsConfigGet).Methods("GET")
	logRouter.HandleFunc("/config", s.handleLogsConfigSet).Methods("PUT")

	// Health monitoring endpoints
	healthRouter := s.router.PathPrefix("/health-config").Subrouter()
	healthRouter.HandleFunc("", s.handleHealthConfigGet).Methods("GET")
	healthRouter.HandleFunc("", s.handleHealthConfigSet).Methods("PUT")
	healthRouter.HandleFunc("/status", s.handleHealthStatus).Methods("GET")
	healthRouter.HandleFunc("/restart-stats", s.handleRestartStats).Methods("GET")

	// HTTP Proxy endpoints
	proxyRouter := s.router.PathPrefix("/proxy").Subrouter()
	proxyRouter.HandleFunc("/status", s.handleProxyStatus).Methods("GET")
	proxyRouter.HandleFunc("/config", s.handleProxyConfig).Methods("GET")

	// Publish endpoints (V4 unified job architecture)
	s.router.HandleFunc("/publish", s.handlePublish).Methods("POST")
	s.router.HandleFunc("/publish/status", s.handlePublishStatus).Methods("GET")
}

func (s *Server) getConfiguredAddress() string {
	if s.config != nil && s.config.UseTCP {
		return "tcp://" + s.config.TCPPort
	}
	if s.config != nil && s.config.SocketPath != "" {
		return s.config.SocketPath
	}
	return getSocketPath()
}

// waitForServerReady waits for the server to be ready to accept connections
func (s *Server) waitForServerReady(address string, useTCP bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), serverReadyTimeout)
	defer cancel()

	network := "unix"
	if useTCP {
		network = "tcp"
		address = "localhost:" + address
	}

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("server failed to become ready within %v", serverReadyTimeout)
		default:
			// Try to connect to the socket/port
			conn, err := net.Dial(network, address)
			if err == nil {
				conn.Close()
				return nil
			}
			time.Sleep(10 * time.Millisecond) // Small delay between attempts
		}
	}
}

func (s *Server) StartWithConfig(config *Config) error {
	s.config = config
	s.processLogging = config.ProcessLogging
	s.processLoggingToStdout = config.ProcessLoggingToStdout
	// Configure process manager logging
	s.procMgr.SetProcessLogging(config.ProcessLogging)
	s.procMgr.SetStructuredLogging(config.ProcessLoggingToStdout)

	if config.UseTCP {
		return s.startTCPServer(config.TCPPort, config.ShutdownTimeout)
	}
	return s.startUnixServer(config.SocketPath, config.ShutdownTimeout)
}

func (s *Server) Start() error {
	useTCP, tcpPort := getTCPConfig()
	config := &Config{
		SocketPath:             getSocketPath(),
		ShutdownTimeout:        5 * time.Second,
		ProcessLogging:         true,                        // Default: enable child process logging
		ProcessLoggingToStdout: getProcessLoggingToStdout(), // Default: enable structured output, configurable via env
		UseTCP:                 useTCP,
		TCPPort:                tcpPort,
	}
	return s.StartWithConfig(config)
}

// startHTTPProxyIfEnabled starts the HTTP proxy if enabled in the configuration
func (s *Server) startHTTPProxyIfEnabled() error {
	if !s.config.ProxyEnabled {
		return nil
	}

	proxyConfig := HTTPProxyConfig{
		Enabled:     true,
		ListenPort:  s.config.ProxyPort,
		TargetHost:  s.config.ProxyTargetHost,
		TargetPort:  s.config.ProxyTargetPort,
		TLSCertPath: s.config.ProxyCertPath,
		TLSKeyPath:  s.config.ProxyKeyPath,

		// Static serving configuration
		StaticRoot:          s.config.ProxyStaticRoot,
		EnableStaticServing: s.config.ProxyServeStatic,
		SPAMode:             s.config.ProxySPAMode,
		APIPrefix:           s.config.ProxyAPIPrefix,
		ConfigPath:          s.config.ProxyRoutingConfig,
		AllowedOrigins:      s.config.AllowedOrigins,

		// JWT authentication configuration (hybrid mode: redirects browsers, 401 for APIs)
		JWTEnabled:        s.config.JWTEnabled,
		JWKSUrl:           s.config.JWKSUrl,
		JWKSSkipTLSVerify: s.config.JWKSSkipTLSVerify,
		JWTRedirectURL:    s.config.JWTRedirectURL,
		JWTBuilderBaseURL: s.config.JWTBuilderBaseURL,
		SiteID:            s.config.SiteID,
		JWTExcludedPaths:  s.config.JWTExcludedPaths,
	}
	s.httpProxy = NewHTTPProxy(proxyConfig)

	// Enable start-on-request if configured
	if s.config.StartOnRequestEnabled {
		s.httpProxy.EnableStartOnRequest(
			s.procMgr,
			s.config.IdleTimeout,
			s.config.IdleCheckInterval,
		)
	}

	if err := s.httpProxy.Start(); err != nil {
		slog.Error("failed to start HTTP proxy", "error", err)
		return err
	}
	slog.Info("HTTP proxy started", "listen_port", s.config.ProxyPort, "target", fmt.Sprintf("%s:%d", s.config.ProxyTargetHost, s.config.ProxyTargetPort))
	return nil
}

func (s *Server) startUnixServer(socketPath string, shutdownTimeout time.Duration) error {
	// Remove existing socket file if it exists
	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	// Create Unix domain socket listener
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}

	// Set socket permissions (non-fatal if it fails)
	if err := os.Chmod(socketPath, 0666); err != nil {
		slog.Warn("failed to set socket permissions, continuing anyway", "socket_path", socketPath, "error", err)
	}

	slog.Info("dev-supervisor starting", "socket_path", socketPath, "pid", os.Getpid())

	// Start HTTP proxy if enabled
	if err := s.startHTTPProxyIfEnabled(); err != nil {
		return err
	}

	const previewTaskName = "preview"
	// Start SMTP proxy (skip for preview task in unified job)
	if os.Getenv("NOMAD_TASK_NAME") != previewTaskName {
		if err := s.smtpProxy.Start(); err != nil {
			slog.Warn("failed to start SMTP proxy", "error", err)
		}
	}

	// Create HTTP server with SELinux enforcement for Unix socket mode
	// Only processes with allowed SELinux types can access the API via SO_PEERSEC
	allowedSELinuxTypes := getAllowedSELinuxTypes()
	server := &http.Server{
		Handler:      peerSecMiddleware(allowedSELinuxTypes)(s.router),
		ReadTimeout:  defaultTimeout,
		WriteTimeout: defaultTimeout,
		IdleTimeout:  2 * defaultTimeout,
		ConnContext:  connContextWithPeerSec,
	}

	// Start PID 1 manager with shutdown callback
	s.pid1Mgr.Start(func() {
		slog.Info("shutdown initiated by PID 1 manager")
		// Trigger graceful server shutdown with timeout
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		shutdownComplete := make(chan error, 1)
		go func() {
			shutdownComplete <- server.Shutdown(ctx)
		}()

		select {
		case err := <-shutdownComplete:
			if err != nil {
				slog.Error("PID 1 shutdown error", "error", err)
			} else {
				slog.Info("PID 1 shutdown completed gracefully")
			}
		case <-ctx.Done():
			slog.Warn("PID 1 shutdown timeout exceeded", "timeout", shutdownTimeout)
		}
	})

	// Start server in a goroutine
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// If we're not PID 1, still wait for signals manually
	if os.Getpid() != 1 {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit

		slog.Info("shutting down server")

		// Graceful shutdown with configurable timeout
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		// Shutdown in background and wait for completion or timeout
		shutdownComplete := make(chan error, 1)
		go func() {
			shutdownComplete <- server.Shutdown(ctx)
		}()

		select {
		case err := <-shutdownComplete:
			if err != nil {
				slog.Error("server shutdown error", "error", err)
			} else {
				slog.Info("server shutdown completed gracefully")
			}
		case <-ctx.Done():
			slog.Warn("server shutdown timeout exceeded, forcing shutdown", "timeout", shutdownTimeout)
		}
	} else {
		// If we are PID 1, the PID1Manager handles shutdown
		// Wait for server to be shut down (block forever until PID1Manager calls shutdown)
		select {}
	}

	// Stop HTTP proxy
	if s.httpProxy != nil {
		if err := s.httpProxy.Stop(); err != nil {
			slog.Warn("failed to stop HTTP proxy", "error", err)
		}
	}

	// Stop SMTP proxy
	if err := s.smtpProxy.Stop(); err != nil {
		slog.Warn("failed to stop SMTP proxy", "error", err)
	}

	// Clean up socket file
	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		slog.Warn("failed to clean up socket file", "path", socketPath, "error", err)
	}

	slog.Info("server stopped")
	return nil
}

func (s *Server) startTCPServer(port string, shutdownTimeout time.Duration) error {
	// Create TCP listener
	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return fmt.Errorf("failed to create TCP listener on port %s: %w", port, err)
	}

	slog.Warn("dev-supervisor starting in TCP mode (INSECURE - development only)", "port", port, "pid", os.Getpid())
	slog.Warn("TCP mode exposes dev-supervisor API to network - use only in secure development environments")

	// Start HTTP proxy if enabled
	if err := s.startHTTPProxyIfEnabled(); err != nil {
		return err
	}

	// Start SMTP proxy (skip for preview task in unified job)
	if os.Getenv("NOMAD_TASK_NAME") != "preview" {
		if err := s.smtpProxy.Start(); err != nil {
			slog.Warn("failed to start SMTP proxy", "error", err)
		}
	}

	// Create HTTP server
	server := &http.Server{
		Handler:      s.router,
		ReadTimeout:  defaultTimeout,
		WriteTimeout: defaultTimeout,
		IdleTimeout:  2 * defaultTimeout,
	}

	// Start PID 1 manager with shutdown callback
	s.pid1Mgr.Start(func() {
		slog.Info("shutdown initiated by PID 1 manager")
		// Trigger graceful server shutdown with timeout
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		shutdownComplete := make(chan error, 1)
		go func() {
			shutdownComplete <- server.Shutdown(ctx)
		}()

		select {
		case err := <-shutdownComplete:
			if err != nil {
				slog.Error("PID 1 shutdown error", "error", err)
			} else {
				slog.Info("PID 1 shutdown completed gracefully")
			}
		case <-ctx.Done():
			slog.Warn("PID 1 shutdown timeout exceeded", "timeout", shutdownTimeout)
		}
	})

	// Start server in a goroutine
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			slog.Error("TCP server failed", "error", err)
			os.Exit(1)
		}
	}()

	// If we're not PID 1, still wait for signals manually
	if os.Getpid() != 1 {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit

		slog.Info("shutting down TCP server")

		// Graceful shutdown with configurable timeout
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		// Shutdown in background and wait for completion or timeout
		shutdownComplete := make(chan error, 1)
		go func() {
			shutdownComplete <- server.Shutdown(ctx)
		}()

		select {
		case err := <-shutdownComplete:
			if err != nil {
				slog.Error("TCP server shutdown error", "error", err)
			} else {
				slog.Info("TCP server shutdown completed gracefully")
			}
		case <-ctx.Done():
			slog.Warn("TCP server shutdown timeout exceeded, forcing shutdown", "timeout", shutdownTimeout)
		}
	} else {
		// If we are PID 1, the PID1Manager handles shutdown
		// Wait for server to be shut down (block forever until PID1Manager calls shutdown)
		select {}
	}

	// Stop HTTP proxy
	if s.httpProxy != nil {
		if err := s.httpProxy.Stop(); err != nil {
			slog.Warn("failed to stop HTTP proxy", "error", err)
		}
	}

	// Stop SMTP proxy
	if err := s.smtpProxy.Stop(); err != nil {
		slog.Warn("failed to stop SMTP proxy", "error", err)
	}

	slog.Info("TCP server stopped")
	return nil
}

// StartCommandOnStartup starts a command when dev-supervisor starts
func (s *Server) StartCommandOnStartup(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("no command provided")
	}

	// Build the full command with proper argument handling
	fullCommand := strings.Join(args, " ")

	// Validate command is not empty after joining
	if strings.TrimSpace(fullCommand) == "" {
		return fmt.Errorf("command cannot be empty")
	}

	// Convert environment slice to map
	envMap := make(map[string]string)
	for _, env := range os.Environ() {
		if parts := strings.SplitN(env, "=", 2); len(parts) == 2 {
			envMap[parts[0]] = parts[1]
		}
	}

	// Set working directory - use /app if it exists, otherwise current directory
	workingDir := "/app"
	if _, err := os.Stat("/app"); os.IsNotExist(err) {
		if cwd, err := os.Getwd(); err == nil {
			workingDir = cwd
		} else {
			workingDir = defaultTmpDir
		}
	}

	// Use the ProcessManager to start the command
	startReq := ProcessStartRequest{
		Command:    fullCommand,
		Env:        envMap,
		WorkingDir: workingDir,
	}

	if err := s.procMgr.Start(startReq); err != nil {
		slog.Error("failed to start initial command",
			"command", startReq.Command,
			"error", err)
		return fmt.Errorf("failed to start command: %w", err)
	}

	status := s.procMgr.GetStatus()
	slog.Info("initial command started",
		"pid", status.PID,
		"command", startReq.Command)
	return nil
}

// WaitForShutdown waits for shutdown signals
func (s *Server) WaitForShutdown() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	<-sigChan
	slog.Info("shutdown signal received, cleaning up...")

	// Stop all managed processes
	s.procMgr.StopAllProcesses()
	slog.Info("server stopped")
}

func parseFlags() *Config {
	config := &Config{}

	flag.StringVar(&config.SocketPath, "socket", "", "Unix domain socket path (overrides DEV_SUPERVISOR_SOCKET_PATH)")
	flag.BoolVar(&config.UseTCP, "tcp", false, "Use TCP instead of Unix socket (INSECURE - development only)")
	flag.StringVar(&config.TCPPort, "port", "", "TCP port to listen on when using -tcp flag (overrides DEV_SUPERVISOR_TCP_PORT)")
	flag.BoolVar(&config.ShowVersion, "version", false, "Show version and exit")
	flag.BoolVar(&config.ShowVersion, "v", false, "Show version and exit (shorthand)")
	flag.BoolVar(&config.ShowHelp, "help", false, "Show help and exit")
	flag.BoolVar(&config.ShowHelp, "h", false, "Show help and exit (shorthand)")
	flag.DurationVar(&config.ShutdownTimeout, "shutdown-timeout", 10*time.Second, "Graceful shutdown timeout")

	// HTTP Proxy configuration
	flag.BoolVar(&config.ProxyEnabled, "proxy", false, "Enable HTTP proxy mode")
	flag.IntVar(&config.ProxyPort, "proxy-port", 0, "HTTP proxy listen port")
	flag.StringVar(&config.ProxyTargetHost, "proxy-target-host", "localhost", "HTTP proxy target host")
	flag.IntVar(&config.ProxyTargetPort, "proxy-target-port", 8080, "HTTP proxy target port")
	flag.StringVar(&config.ProxyCertPath, "proxy-cert", "", "Path to TLS certificate")
	flag.StringVar(&config.ProxyKeyPath, "proxy-key", "", "Path to TLS private key")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [options]\n\n", AppName)
		fmt.Fprintf(os.Stderr, "%s - A containerized service that acts as PID 1 in Docker containers,\n", AppName)
		fmt.Fprintf(os.Stderr, "providing centralized process management through an HTTP API over Unix domain sockets or TCP.\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "Environment Variables:\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_SOCKET_PATH        Path for Unix domain socket (default: /tmp/dev-supervisor.sock)\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_USE_TCP            Enable TCP mode instead of Unix socket (set to 'true')\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_TCP_PORT           TCP port to listen on (default: 8080)\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_LOG_LEVEL          Log level: debug, info, warn, error (default: info)\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_ENABLE_PROXY       Enable HTTP proxy mode (set to 'true')\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_PORT         HTTP proxy listen port\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_TARGET_HOST  HTTP proxy target host (default: localhost)\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_TARGET_PORT  HTTP proxy target port (default: 8080)\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_CERT_PATH    Path to TLS certificate\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_KEY_PATH     Path to TLS private key\n")
		fmt.Fprintf(os.Stderr, "  SMTP_DESTINATION                  SMTP server destination for proxy (default: relay-hosting.secureserver.net:25)\n")
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "SMTP Proxy Headers (automatically injected):\n")
		fmt.Fprintf(os.Stderr, "  SITE_ID                     Sets X-SITE-UID header (default: unknown)\n")
		fmt.Fprintf(os.Stderr, "  PRODUCT                     Sets X-PRODUCT header (default: airo-app-builder)\n")
		fmt.Fprintf(os.Stderr, "  NODE_ENV                    Sets X-ENVIRONMENT header (default: unknown)\n")
		fmt.Fprintf(os.Stderr, "  NOMAD_DC                    Sets X-DATACENTER header (default: unknown)\n")
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "Examples:\n")
		fmt.Fprintf(os.Stderr, "  %s                                    # Use default settings (Unix socket)\n", AppName)
		fmt.Fprintf(os.Stderr, "  %s -socket /app/supervisor.sock       # Custom socket path\n", AppName)
		fmt.Fprintf(os.Stderr, "  %s -tcp -port 9090                    # TCP mode on port 9090 (INSECURE)\n", AppName)
		fmt.Fprintf(os.Stderr, "  %s -shutdown-timeout 30s              # Custom shutdown timeout\n", AppName)
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "WARNING: TCP mode is insecure and should only be used in development environments!\n")
		fmt.Fprintf(os.Stderr, "\n")
	}

	flag.Parse()

	// Handle TCP vs Unix socket configuration
	if config.UseTCP {
		// TCP mode
		if config.TCPPort == "" {
			// Check environment variable for port
			_, envPort := getTCPConfig()
			if envPort != "" {
				config.TCPPort = envPort
			} else {
				config.TCPPort = "8080" // Default port
			}
		}
	} else {
		// Check if environment variable forces TCP mode
		useTCP, tcpPort := getTCPConfig()
		if useTCP {
			config.UseTCP = true
			config.TCPPort = tcpPort
		} else {
			// Unix socket mode
			if config.SocketPath == "" {
				config.SocketPath = getSocketPath()
			}
		}
	}

	// Set default process logging configuration
	config.ProcessLogging = true                                // Default: enable child process logging
	config.ProcessLoggingToStdout = getProcessLoggingToStdout() // Default: enable structured output, configurable via env

	// HTTP Proxy configuration from environment variables
	config.ProxyEnabled = getEnvBoolWithDefault("DEV_SUPERVISOR_ENABLE_PROXY", false)
	config.ProxyPort = getEnvIntWithDefault("DEV_SUPERVISOR_PROXY_PORT", 0)
	config.ProxyTargetHost = getEnvStringWithDefault("DEV_SUPERVISOR_PROXY_TARGET_HOST", "localhost")
	config.ProxyTargetPort = getEnvIntWithDefault("DEV_SUPERVISOR_PROXY_TARGET_PORT", 8080)
	config.ProxyCertPath = getEnvStringWithDefault("DEV_SUPERVISOR_PROXY_CERT_PATH", "")
	config.ProxyKeyPath = getEnvStringWithDefault("DEV_SUPERVISOR_PROXY_KEY_PATH", "")

	// Static serving configuration from environment variables
	// Default static root is /app/dist/client (standard Vite build output in container)
	config.ProxyStaticRoot = getEnvStringWithDefault("DEV_SUPERVISOR_STATIC_ROOT", "/app/dist/client")
	config.ProxyServeStatic = getEnvBoolWithDefault("DEV_SUPERVISOR_SERVE_STATIC", false)
	config.ProxySPAMode = getEnvBoolWithDefault("DEV_SUPERVISOR_SPA_MODE", true)
	config.ProxyAPIPrefix = getEnvStringWithDefault("DEV_SUPERVISOR_API_PREFIX", "/api")
	config.ProxyRoutingConfig = getEnvStringWithDefault("DEV_SUPERVISOR_ROUTING_CONFIG", "")

	// Parse ALLOWED_ORIGINS (comma-separated list)
	allowedOriginsStr := os.Getenv("ALLOWED_ORIGINS")
	if allowedOriginsStr != "" {
		config.AllowedOrigins = strings.Split(allowedOriginsStr, ",")
		// Trim whitespace from each origin
		for i := range config.AllowedOrigins {
			config.AllowedOrigins[i] = strings.TrimSpace(config.AllowedOrigins[i])
		}
	}

	// JWT authentication configuration from environment variables
	config.JWTEnabled = getEnvBoolWithDefault("DEV_SUPERVISOR_ENABLE_JWT_AUTH", false)
	config.JWKSUrl = getEnvStringWithDefault("DEV_SUPERVISOR_JWKS_URL", "")
	config.JWKSSkipTLSVerify = getEnvBoolWithDefault("DEV_SUPERVISOR_JWKS_SKIP_TLS_VERIFY", false)
	config.JWTRedirectURL = getEnvStringWithDefault("DEV_SUPERVISOR_JWT_REDIRECT_URL", "")
	config.JWTBuilderBaseURL = getEnvStringWithDefault("DEV_SUPERVISOR_JWT_BUILDER_BASE_URL", "")

	// SITE_ID is required (no default) - must be set by docker-compose or production deployment
	config.SiteID = os.Getenv("SITE_ID")

	// Parse excluded paths (comma-separated)
	excludedPathsStr := getEnvStringWithDefault("DEV_SUPERVISOR_JWT_EXCLUDED_PATHS", "/api/health")
	if excludedPathsStr != "" {
		config.JWTExcludedPaths = strings.Split(excludedPathsStr, ",")
		// Trim whitespace from each path
		for i := range config.JWTExcludedPaths {
			config.JWTExcludedPaths[i] = strings.TrimSpace(config.JWTExcludedPaths[i])
		}
	}

	// Add /airo/health to excluded paths when proxy mode is enabled
	// This endpoint is used for deployment health checks and must be unauthenticated
	if config.ProxyEnabled {
		// Check if /airo/health is already excluded
		if !slices.Contains(config.JWTExcludedPaths, "/airo/health") {
			config.JWTExcludedPaths = append(config.JWTExcludedPaths, "/airo/health")
		}
	}

	// Start-on-request configuration (preview variant only)
	config.StartOnRequestEnabled = getEnvBoolWithDefault("DEV_SUPERVISOR_ENABLE_START_ON_REQUEST", false)
	config.IdleTimeout = getEnvDurationWithDefault("DEV_SUPERVISOR_IDLE_TIMEOUT", 30*time.Minute)
	config.IdleCheckInterval = getEnvDurationWithDefault("DEV_SUPERVISOR_IDLE_CHECK_INTERVAL", 30*time.Second)

	const previewTaskName = "preview"
	// Only enable for preview variant
	taskName := os.Getenv("NOMAD_TASK_NAME")
	if config.StartOnRequestEnabled && taskName != previewTaskName {
		slog.Warn("start-on-request disabled: only supported for preview variant",
			"task_name", taskName)
		config.StartOnRequestEnabled = false
	}

	return config
}

func showVersion() {
	fmt.Printf("%s version %s\n", AppName, Version)
}

func main() {
	config := parseFlags()

	if config.ShowHelp {
		flag.Usage()
		os.Exit(0)
	}

	if config.ShowVersion {
		showVersion()
		os.Exit(0)
	}

	// Initialize structured logging
	initLogging()
	configureSchedulerDefaults()

	if config.UseTCP {
		slog.Info("starting dev-supervisor",
			"version", Version,
			"mode", "tcp",
			"port", config.TCPPort,
			"pid", os.Getpid(),
			"shutdown_timeout", config.ShutdownTimeout)
	} else {
		slog.Info("starting dev-supervisor",
			"version", Version,
			"mode", "unix",
			"socket_path", config.SocketPath,
			"pid", os.Getpid(),
			"shutdown_timeout", config.ShutdownTimeout)
	}

	server := NewServer()

	// Check for additional command arguments to auto-start
	args := flag.Args()
	if len(args) > 0 {
		slog.Info("auto-starting command", "command", args)

		// Start the server in a goroutine so we can also start the command
		go func() {
			if err := server.StartWithConfig(config); err != nil {
				slog.Error("failed to start server", "error", err)
				os.Exit(1)
			}
		}()

		// Wait for server to be ready
		address := config.SocketPath
		if config.UseTCP {
			address = config.TCPPort
		}
		if err := server.waitForServerReady(address, config.UseTCP); err != nil {
			slog.Error("server failed to start", "error", err)
			os.Exit(1)
		}

		// Start the specified command
		if err := server.StartCommandOnStartup(args); err != nil {
			slog.Error("failed to start initial command", "error", err, "command", args)
			os.Exit(1)
		}

		// Wait for shutdown signals
		server.WaitForShutdown()
	} else {
		// No command specified, just start the server normally
		if err := server.StartWithConfig(config); err != nil {
			slog.Error("failed to start server", "error", err)
			os.Exit(1)
		}
	}
}
