package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
	"github.com/airo-ai-builder/dev-supervisor/internal/process"
	"github.com/airo-ai-builder/dev-supervisor/internal/processmanager"
	httpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/http"
	smtpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/smtp"
	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const (
	Version            = "0.2.0"
	AppName            = "airo-supervisor"
	defaultTimeout     = 120 * time.Second
	serverReadyTimeout = 5 * time.Second

	// Startup mode constants
	startupModeFirstStart = "first-start"
	startupModeRestart    = "restart"
)

// Config is an alias for config.Config
type Config = config.Config

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

	entries := strings.SplitSeq(raw, ",")
	for entry := range entries {
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

type Server struct {
	router                 *mux.Router
	procMgr                *processmanager.ProcessManager
	cmdExec                *CommandExecutor
	envMgr                 *EnvironmentManager
	logMgr                 *logs.Manager
	pid1Mgr                *process.PID1Manager
	smtpProxy              *smtpproxy.Proxy
	httpProxy              *httpproxy.HTTPProxy
	startTime              time.Time
	config                 *Config
	processLogging         bool       // Current process logging configuration
	processLoggingToStdout bool       // Current structured logging configuration
	pruneMu                sync.Mutex // Serialize prune operations

	shutdownCh   chan struct{} // Closed by Shutdown to trigger programmatic graceful exit
	shutdownOnce sync.Once
	// execCmdSeq hands out monotonically increasing IDs for each /exec
	// invocation. The ID is stamped on every log entry mirrored for that
	// command and returned to the caller on the HTTP response, so consumers
	// can later scope GET /logs?command_id=N to a specific command.
	execCmdSeq atomic.Uint64
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

type SetupExecuteResponse struct {
	Status string  `json:"status"` // "executed", "already_executed", "not_configured", "error"
	Error  *string `json:"error,omitempty"`
}

// sharedStorageDir returns the SHARED_STORAGE_DIR environment variable value.
// This is used by sandbox profiles to resolve the shared storage assets path.
func sharedStorageDir() string {
	return os.Getenv("SHARED_STORAGE_DIR")
}

func NewServer() *Server {
	logMgr := logs.NewManager(10000)
	pid1Mgr := process.NewPID1Manager()
	procMgr := processmanager.NewProcessManager(logMgr, pid1Mgr)

	// Set default configuration
	procMgr.SetProcessLogging(true) // Default: enable child process logging
	procMgr.SetStructuredLogging(
		config.GetProcessLoggingToStdout(),
	) // Default: enable structured output, configurable via env

	s := &Server{
		router:                 mux.NewRouter(),
		logMgr:                 logMgr,
		pid1Mgr:                pid1Mgr,
		procMgr:                procMgr,
		cmdExec:                NewCommandExecutor(pid1Mgr),
		envMgr:                 NewEnvironmentManager(),
		smtpProxy:              smtpproxy.New(),
		startTime:              time.Now(),
		processLogging:         true,                               // Default: enable child process logging
		processLoggingToStdout: config.GetProcessLoggingToStdout(), // Default: enable structured output, configurable via env
		shutdownCh:             make(chan struct{}),
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

	// Setup endpoints
	setupRouter := s.router.PathPrefix("/setup").Subrouter()
	setupRouter.HandleFunc("/status", s.handleSetupStatus).Methods("GET")
	setupRouter.HandleFunc("/execute", s.handleSetupExecute).Methods("POST")

	// Publish endpoints (V4 unified job architecture)
	s.router.HandleFunc("/publish", s.handlePublish).Methods("POST")
	s.router.HandleFunc("/publish/status", s.handlePublishStatus).Methods("GET")
	s.router.HandleFunc("/unpublish", s.handleUnpublish).Methods("POST")

	// Filesystem operation endpoints
	fsRouter := s.router.PathPrefix("/fs").Subrouter()
	fsRouter.Use(fsMaxBodyMiddleware)
	fsRouter.HandleFunc("/read", s.handleFsRead).Methods("POST")
	fsRouter.HandleFunc("/write", s.handleFsWrite).Methods("POST")
	fsRouter.HandleFunc("/stat", s.handleFsStat).Methods("POST")
	fsRouter.HandleFunc("/readdir", s.handleFsReaddir).Methods("POST")
	fsRouter.HandleFunc("/mkdir", s.handleFsMkdir).Methods("POST")
	fsRouter.HandleFunc("/unlink", s.handleFsUnlink).Methods("POST")
	fsRouter.HandleFunc("/rename", s.handleFsRename).Methods("POST")
	fsRouter.HandleFunc("/exists", s.handleFsExists).Methods("POST")
	fsRouter.HandleFunc("/grep", s.handleFsGrep).Methods("POST")
}

func (s *Server) getConfiguredAddress() string {
	if s.config != nil && s.config.UseTCP {
		return "tcp://" + s.config.TCPPort
	}
	if s.config != nil && s.config.SocketPath != "" {
		return s.config.SocketPath
	}
	// Fallback to config package
	cfg := config.LoadConfig()
	return cfg.SocketPath
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
			//nolint:noctx // Infrastructure health check, no request context
			conn, err := net.Dial(network, address)
			if err == nil {
				//nolint:gosec // G104: Intentionally ignoring error
				conn.Close()
				return nil
			}
			time.Sleep(10 * time.Millisecond) // Small delay between attempts
		}
	}
}

func (s *Server) StartWithConfig(cfg *Config) error {
	s.config = cfg
	s.processLogging = cfg.ProcessLogging
	s.processLoggingToStdout = cfg.ProcessLoggingToStdout
	// Configure process manager logging
	s.procMgr.SetProcessLogging(cfg.ProcessLogging)
	s.procMgr.SetStructuredLogging(cfg.ProcessLoggingToStdout)

	// Configure sandbox for child processes
	storageDir := sharedStorageDir()
	s.cmdExec.SetSandboxEnabled(cfg.SandboxEnabled)
	s.cmdExec.SetSharedStorageDir(storageDir)
	s.procMgr.SetSandboxEnabled(cfg.SandboxEnabled)
	s.procMgr.SetSharedStorageDir(storageDir)
	s.procMgr.SetProcessVariant(sandbox.DetectProcessVariant())
	s.procMgr.SetDefaultBindPort(cfg.ProxyTargetPort)

	if cfg.SandboxEnabled {
		if _, err := os.Stat(sandbox.BinaryPath()); err != nil {
			return fmt.Errorf("sandbox enabled but binary not found at %s: %w", sandbox.BinaryPath(), err)
		}
		variant := sandbox.DetectProcessVariant()
		slog.Info("sandbox.enabled",
			"binary", sandbox.BinaryPath(),
			"shared_storage_dir", storageDir,
			"process_variant", string(variant),
			"exec_paths", sandbox.ExecPaths(storageDir),
			"process_paths", sandbox.ProcessPaths(variant, storageDir),
			"connect_tcp", sandbox.ConnectTCPPorts,
		)
	} else {
		slog.Info("sandbox.disabled")
	}

	if cfg.UseTCP {
		return s.startTCPServer(cfg.TCPPort, cfg.ShutdownTimeout)
	}
	return s.startUnixServer(cfg.SocketPath, cfg.ShutdownTimeout)
}

func (s *Server) Start() error {
	cfg := config.LoadConfig()
	return s.StartWithConfig(cfg)
}

// startHTTPProxyIfEnabled starts the HTTP proxy if enabled in the configuration
func (s *Server) startHTTPProxyIfEnabled() error {
	if !s.config.ProxyEnabled {
		return nil
	}

	proxyConfig := httpproxy.Config{
		Enabled:     true,
		ListenPort:  s.config.ProxyPort,
		TargetHost:  s.config.ProxyTargetHost,
		TargetPort:  s.config.ProxyTargetPort,
		TLSCertPath: s.config.ProxyCertPath,
		TLSKeyPath:  s.config.ProxyKeyPath,

		APIPrefix:      s.config.ProxyAPIPrefix,
		AllowedOrigins: s.config.AllowedOrigins,

		// JWT authentication configuration (hybrid mode: redirects browsers to builder, 401 for APIs)
		JWTEnabled:        s.config.JWTEnabled,
		JWKSUrl:           s.config.JWKSUrl,
		JWKSSkipTLSVerify: s.config.JWKSSkipTLSVerify,
		SiteID:            s.config.SiteID,
		JWTExcludedPaths:  s.config.JWTExcludedPaths,

		// Share token configuration (for public preview links)
		EnableShareTokens: s.config.EnableShareTokens,
		AgentsBaseURL:     s.config.AgentsBaseURL,
	}
	s.httpProxy = httpproxy.NewHTTPProxy(proxyConfig)

	// Enable start-on-request if configured
	if s.config.StartOnRequestEnabled {
		s.httpProxy.EnableStartOnRequest(
			newProcessController(s.procMgr),
			s.config.IdleTimeout,
			s.config.IdleCheckInterval,
		)
	}

	if err := s.httpProxy.Start(); err != nil {
		slog.Error("failed to start HTTP proxy", "error", err)
		return err
	}
	slog.Info(
		"HTTP proxy started",
		"listen_port",
		s.config.ProxyPort,
		"target",
		fmt.Sprintf("%s:%d", s.config.ProxyTargetHost, s.config.ProxyTargetPort),
	)
	return nil
}

func (s *Server) startUnixServer(socketPath string, shutdownTimeout time.Duration) error {
	// Remove existing socket file if it exists
	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	// Create Unix domain socket listener
	//nolint:noctx // Long-lived server listener, no request context available
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}

	// Set socket permissions (non-fatal if it fails)
	//nolint:gosec // G302: Unix socket needs broad permissions for IPC
	if err := os.Chmod(socketPath, 0666); err != nil {
		slog.Warn("failed to set socket permissions, continuing anyway", "socket_path", socketPath, "error", err)
	}

	slog.Info("dev-supervisor starting", "socket_path", socketPath, "pid", os.Getpid())

	// Start HTTP proxy if enabled
	if err := s.startHTTPProxyIfEnabled(); err != nil {
		return err
	}

	// Start SMTP proxy (skip for preview task in unified job)
	if os.Getenv("NOMAD_TASK_NAME") != config.PreviewTaskName {
		if err := s.smtpProxy.Start(); err != nil {
			slog.Warn("failed to start SMTP proxy", "error", err)
		}
	}

	// Create HTTP server with SELinux enforcement for Unix socket mode
	// Only processes with allowed SELinux types can access the API via SO_PEERSEC
	allowedSELinuxTypes := config.GetAllowedSELinuxTypes()
	server := &http.Server{
		Handler:      middleware.PeerSec(allowedSELinuxTypes)(s.router),
		ReadTimeout:  defaultTimeout,
		WriteTimeout: defaultTimeout,
		IdleTimeout:  2 * defaultTimeout,
		ConnContext:  middleware.ConnContextWithPeerSec,
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
		select {
		case <-quit:
		case <-s.shutdownCh:
		}

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
	//nolint:noctx // Long-lived server listener, no request context available
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
		select {
		case <-quit:
		case <-s.shutdownCh:
		}

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

// Shutdown triggers a graceful shutdown of a server started via StartWithConfig.
// Idempotent and safe to call from any goroutine. Returns immediately; the
// blocking StartWithConfig call returns once cleanup completes.
func (s *Server) Shutdown() {
	s.shutdownOnce.Do(func() {
		close(s.shutdownCh)
	})
}

func parseFlags() *Config {
	// CLI flag variables for overrides
	var (
		socketPath       string
		useTCP           bool
		tcpPort          string
		showVersion      bool
		showVersionShort bool
		showHelp         bool
		showHelpShort    bool
		shutdownTimeout  time.Duration
		proxyEnabled     bool
		proxyPort        int
		proxyTargetHost  string
		proxyTargetPort  int
		proxyCertPath    string
		proxyKeyPath     string
	)

	flag.StringVar(&socketPath, "socket", "", "Unix domain socket path (overrides DEV_SUPERVISOR_SOCKET_PATH)")
	flag.BoolVar(&useTCP, "tcp", false, "Use TCP instead of Unix socket (INSECURE - development only)")
	flag.StringVar(
		&tcpPort,
		"port",
		"",
		"TCP port to listen on when using -tcp flag (overrides DEV_SUPERVISOR_TCP_PORT)",
	)
	flag.BoolVar(&showVersion, "version", false, "Show version and exit")
	flag.BoolVar(&showVersionShort, "v", false, "Show version and exit (shorthand)")
	flag.BoolVar(&showHelp, "help", false, "Show help and exit")
	flag.BoolVar(&showHelpShort, "h", false, "Show help and exit (shorthand)")
	flag.DurationVar(&shutdownTimeout, "shutdown-timeout", 0, "Graceful shutdown timeout")

	// HTTP Proxy configuration
	flag.BoolVar(&proxyEnabled, "proxy", false, "Enable HTTP proxy mode")
	flag.IntVar(&proxyPort, "proxy-port", 0, "HTTP proxy listen port")
	flag.StringVar(&proxyTargetHost, "proxy-target-host", "", "HTTP proxy target host")
	flag.IntVar(&proxyTargetPort, "proxy-target-port", 0, "HTTP proxy target port")
	flag.StringVar(&proxyCertPath, "proxy-cert", "", "Path to TLS certificate")
	flag.StringVar(&proxyKeyPath, "proxy-key", "", "Path to TLS private key")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [options]\n\n", AppName)
		fmt.Fprintf(os.Stderr, "%s - A containerized service that acts as PID 1 in Docker containers,\n", AppName)
		fmt.Fprintf(
			os.Stderr,
			"providing centralized process management through an HTTP API over Unix domain sockets or TCP.\n\n",
		)
		fmt.Fprintf(os.Stderr, "Options:\n")
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "Environment Variables:\n")
		fmt.Fprintf(
			os.Stderr,
			"  DEV_SUPERVISOR_SOCKET_PATH        Path for Unix domain socket (default: /tmp/dev-supervisor.sock)\n",
		)
		fmt.Fprintf(
			os.Stderr,
			"  DEV_SUPERVISOR_USE_TCP            Enable TCP mode instead of Unix socket (set to 'true')\n",
		)
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_TCP_PORT           TCP port to listen on (default: 8080)\n")
		fmt.Fprintf(
			os.Stderr,
			"  DEV_SUPERVISOR_LOG_LEVEL          Log level: debug, info, warn, error (default: info)\n",
		)
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_ENABLE_PROXY       Enable HTTP proxy mode (set to 'true')\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_PORT         HTTP proxy listen port\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_TARGET_HOST  HTTP proxy target host (default: localhost)\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_TARGET_PORT  HTTP proxy target port (default: 8080)\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_CERT_PATH    Path to TLS certificate\n")
		fmt.Fprintf(os.Stderr, "  DEV_SUPERVISOR_PROXY_KEY_PATH     Path to TLS private key\n")
		fmt.Fprintf(
			os.Stderr,
			"  SMTP_DESTINATION                  SMTP server destination for proxy (default: relay-hosting.secureserver.net:25)\n",
		)
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "SMTP Proxy Headers (automatically injected):\n")
		fmt.Fprintf(os.Stderr, "  SITE_ID                     Sets X-SITE-UID header (default: unknown)\n")
		fmt.Fprintf(os.Stderr, "  PRODUCT                     Sets X-PRODUCT header (default: airo-app-builder)\n")
		fmt.Fprintf(os.Stderr, "  NODE_ENV                    Sets X-ENVIRONMENT header (default: unknown)\n")
		fmt.Fprintf(os.Stderr, "  NOMAD_DC                    Sets X-DATACENTER header (default: unknown)\n")
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "Examples:\n")
		fmt.Fprintf(
			os.Stderr,
			"  %s                                    # Use default settings (Unix socket)\n",
			AppName,
		)
		fmt.Fprintf(os.Stderr, "  %s -socket /app/supervisor.sock       # Custom socket path\n", AppName)
		fmt.Fprintf(os.Stderr, "  %s -tcp -port 9090                    # TCP mode on port 9090 (INSECURE)\n", AppName)
		fmt.Fprintf(os.Stderr, "  %s -shutdown-timeout 30s              # Custom shutdown timeout\n", AppName)
		fmt.Fprintf(os.Stderr, "\n")
		fmt.Fprintf(os.Stderr, "WARNING: TCP mode is insecure and should only be used in development environments!\n")
		fmt.Fprintf(os.Stderr, "\n")
	}

	flag.Parse()

	// Load configuration from environment
	cfg := config.LoadConfig()

	// Apply CLI flag overrides
	if socketPath != "" {
		cfg.SocketPath = socketPath
	}
	if useTCP {
		cfg.UseTCP = true
		if tcpPort != "" {
			cfg.TCPPort = tcpPort
		}
	}
	if shutdownTimeout > 0 {
		cfg.ShutdownTimeout = shutdownTimeout
	}
	if proxyEnabled {
		cfg.ProxyEnabled = true
	}
	if proxyPort > 0 {
		cfg.ProxyPort = proxyPort
	}
	if proxyTargetHost != "" {
		cfg.ProxyTargetHost = proxyTargetHost
	}
	if proxyTargetPort > 0 {
		cfg.ProxyTargetPort = proxyTargetPort
	}
	if proxyCertPath != "" {
		cfg.ProxyCertPath = proxyCertPath
	}
	if proxyKeyPath != "" {
		cfg.ProxyKeyPath = proxyKeyPath
	}

	// Handle show version/help flags
	cfg.ShowVersion = showVersion || showVersionShort
	cfg.ShowHelp = showHelp || showHelpShort

	return cfg
}

func showVersion() {
	fmt.Fprintf(os.Stdout, "%s version %s\n", AppName, Version)
}

// detectStartupMode detects whether this is a first-start (fresh app) or restart (existing app)
// by checking if .git/config exists in the app directory.
//
// Valid modes: startupModeFirstStart, startupModeRestart
//
// Detection logic:
// - first-start: .git/config does NOT exist (git repository not initialized)
// - restart: .git/config EXISTS (git repository already initialized)
//
// This determines WHEN to run the setup script (immediately vs deferred to first HTTP request).
// The setup script (nomad_setup.sh) performs its own finer-grained detection to decide WHAT
// work to do:
// - first-start: git init + template copy + npm ci (always immediate)
// - corrupted restart: .git/config exists but package.json missing → restore files + npm ci
// - clean restart: both .git/config and package.json exist → no-op (workspace intact)
//
// If appDir is not configured, returns startupModeFirstStart (default).
// Returns error on filesystem errors when checking .git/config existence.
func detectStartupMode(appDir string) (string, error) {
	if appDir == "" {
		slog.Info("startup.detection.not_configured",
			"mode", startupModeFirstStart,
			"hint", "set CUSTOMER_APP_DIR to enable mode detection")
		return startupModeFirstStart, nil
	}

	// Check if .git/config exists
	gitConfigPath := filepath.Join(appDir, ".git", "config")
	_, err := os.Stat(gitConfigPath)

	if os.IsNotExist(err) {
		// .git/config does not exist - this is a first-start (fresh app)
		slog.Info("startup.detection.first_start",
			"app_dir", appDir,
			"git_config", gitConfigPath,
			"exists", false)
		return startupModeFirstStart, nil
	}

	if err != nil {
		// Unexpected error accessing .git/config (permissions, I/O error, etc.)
		slog.Error("startup.detection.error",
			"app_dir", appDir,
			"git_config", gitConfigPath,
			"error", err)
		return "", fmt.Errorf("failed to check .git/config: %w", err)
	}

	// .git/config exists - this is a restart (existing app)
	slog.Info("startup.detection.restart",
		"app_dir", appDir,
		"git_config", gitConfigPath,
		"exists", true)
	return startupModeRestart, nil
}

// handleConditionalSetup handles mode-based conditional startup when a setup script is configured.
// Returns true if setup was deferred to first HTTP request, false if setup ran immediately or
// no setup script was configured.
func handleConditionalSetup(server *Server, cfg *Config, startReq validation.ProcessStartRequest) bool {
	if cfg.SetupScript == "" {
		return false
	}

	// Detect startup mode (first-start vs restart)
	mode, err := detectStartupMode(cfg.AppDir)
	if err != nil {
		slog.Error("startup.detection.failed", "error", err)
		os.Exit(1)
	}

	var deferSetup bool

	switch mode {
	case startupModeFirstStart:
		// First-start: always run setup immediately (user is actively waiting)
		slog.Info("startup.mode.first_start",
			"setup_script", cfg.SetupScript,
			"defer_setup", false)

	case startupModeRestart:
		// Restart: defer behavior configured via DeferRestartSetup
		deferSetup = cfg.DeferRestartSetup
		slog.Info("startup.mode.restart",
			"setup_script", cfg.SetupScript,
			"defer_setup", deferSetup)

	default:
		slog.Error("startup.mode.invalid", "mode", mode)
		os.Exit(1)
	}

	// Validate configuration if deferring setup
	if deferSetup && !cfg.StartOnRequestEnabled {
		slog.Error("startup.configuration_error",
			"error", "deferred setup requested, but DEV_SUPERVISOR_ENABLE_START_ON_REQUEST is not enabled",
			"hint", "set DEV_SUPERVISOR_ENABLE_START_ON_REQUEST=true for preview deployments")
		os.Exit(1)
	}
	if deferSetup && !cfg.ProxyEnabled {
		slog.Error("startup.configuration_error",
			"error", "deferred setup requested, but DEV_SUPERVISOR_ENABLE_PROXY is not enabled",
			"hint", "deferred setup requires HTTP proxy to detect first request")
		os.Exit(1)
	}

	// Execute setup or defer it
	if deferSetup {
		slog.Info("startup.setup.deferred",
			"setup_script", cfg.SetupScript,
			"command", startReq.Command,
			"trigger", "first_http_request")
		server.procMgr.SetDeferredSetup(cfg.SetupScript, cfg.SetupScriptTimeout, startReq)
		return true
	}

	err = processmanager.RunSetupScriptInternal(
		cfg.SetupScript, cfg.SetupScriptTimeout, server.pid1Mgr,
	)
	if err != nil {
		slog.Error("startup.setup.failed", "error", err)
		os.Exit(1)
	}
	return false
}

// buildStartRequestFromArgs creates a ProcessStartRequest from command arguments
func buildStartRequestFromArgs(args []string) validation.ProcessStartRequest {
	fullCommand := strings.Join(args, " ")

	envMap := make(map[string]string)
	for _, env := range os.Environ() {
		if parts := strings.SplitN(env, "=", 2); len(parts) == 2 {
			envMap[parts[0]] = parts[1]
		}
	}

	workingDir := "/app"
	if _, err := os.Stat("/app"); os.IsNotExist(err) {
		if cwd, err := os.Getwd(); err == nil {
			workingDir = cwd
		}
	}

	return validation.ProcessStartRequest{
		Command:    fullCommand,
		Env:        envMap,
		WorkingDir: workingDir,
	}
}

// readAiroConfigCommand reads the custom dev command from .airo/config.json if present.
// Returns empty string if file doesn't exist, can't be parsed, or has no custom command.
// This allows applications to override the default command specified in Dockerfile CMD.
func readAiroConfigCommand() string {
	// Path resolution order:
	// 1. If CUSTOMER_APP_DIR is set, use $CUSTOMER_APP_DIR/.airo/config.json ONLY
	//    (do not fall back - explicit env var means explicit path)
	// 2. Otherwise try /app/.airo/config.json (production default)
	// 3. Finally try ./.airo/config.json (relative to working directory)

	configPath, data := readAiroConfigFile()
	if data == nil {
		return ""
	}

	// Short-circuit on empty files to avoid noisy parse warnings
	if len(data) == 0 {
		return ""
	}

	var config struct {
		Runtime struct {
			Dev struct {
				Command string `json:"command"`
			} `json:"dev"`
		} `json:"runtime"`
	}

	if err := json.Unmarshal(data, &config); err != nil {
		slog.Warn("startup.config.parse_failed",
			"config_path", configPath,
			"error", err.Error())
		return ""
	}

	return strings.TrimSpace(config.Runtime.Dev.Command)
}

// readAiroConfigFile locates and reads the .airo/config.json file
func readAiroConfigFile() (string, []byte) {
	customerAppDir := os.Getenv("CUSTOMER_APP_DIR")
	if customerAppDir != "" {
		// CUSTOMER_APP_DIR is explicitly set - use it exclusively
		configPath := filepath.Join(customerAppDir, ".airo", "config.json")
		data, err := os.ReadFile(configPath)
		if err == nil {
			return configPath, data
		}
		// File doesn't exist or can't be read - don't fall back when CUSTOMER_APP_DIR is explicit
		return "", nil
	}

	// No CUSTOMER_APP_DIR - try production default first
	configPath := filepath.Join("/app", ".airo", "config.json")
	data, err := os.ReadFile(configPath)
	if err == nil {
		return configPath, data
	}

	// Try relative path as last resort
	configPath = filepath.Join(".airo", "config.json")
	data, err = os.ReadFile(configPath)
	if err == nil {
		return configPath, data
	}

	// File doesn't exist - this is normal for apps without custom config
	return "", nil
}

// startServerWithCommand starts the server in the background, optionally runs setup based on
// mode detection, and starts the specified command.
//
// When a setup script is configured (cfg.SetupScript != ""), mode-based conditional startup is used:
// - First-start: run setup immediately, then start process
// - Restart: defer setup to first HTTP request (if DeferRestartSetup is true)
// When no setup script is configured, the process starts immediately (backward compat).
func startServerWithCommand(server *Server, cfg *Config, args []string) {
	slog.Info("startup.begin", "command", args)

	// Build start request from args
	startReq := buildStartRequestFromArgs(args)

	// Check for custom command in .airo/config.json
	if customCmd := readAiroConfigCommand(); customCmd != "" {
		slog.Info("startup.using_custom_command",
			"custom_command", customCmd,
			"default_command", startReq.Command)
		startReq.Command = customCmd
	}

	// Handle conditional startup if setup script is configured
	deferSetup := handleConditionalSetup(server, cfg, startReq)

	// Start server in background
	go func() {
		if err := server.StartWithConfig(cfg); err != nil {
			slog.Error("failed to start server", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for server ready
	address := cfg.SocketPath
	if cfg.UseTCP {
		address = cfg.TCPPort
	}
	if err := server.waitForServerReady(address, cfg.UseTCP); err != nil {
		slog.Error("server failed to start", "error", err)
		os.Exit(1)
	}

	// Start process immediately if not deferred
	if !deferSetup {
		slog.Info("startup.immediate", "command", startReq.Command)
		if err := server.procMgr.Start(startReq); err != nil {
			slog.Error("failed to start initial command",
				"error", err,
				"command", startReq.Command,
				"cli_args", args)
			os.Exit(1)
		}

		status := server.procMgr.GetStatus()
		slog.Info("initial.command.started", "pid", status.PID, "command", startReq.Command)
	}

	// Wait for shutdown signals
	server.WaitForShutdown()
}

func main() {
	cfg := parseFlags()

	if cfg.ShowHelp {
		flag.Usage()
		os.Exit(0)
	}

	if cfg.ShowVersion {
		showVersion()
		os.Exit(0)
	}

	// Initialize structured logging
	initLogging()
	configureSchedulerDefaults()

	// Migrate task-specific config before anything reads NOMAD_ALLOC_DIR/config.json
	allocconfig.MigrateTaskConfig()

	if cfg.UseTCP {
		slog.Info("starting dev-supervisor",
			"version", Version,
			"mode", "tcp",
			"port", cfg.TCPPort,
			"pid", os.Getpid(),
			"shutdown_timeout", cfg.ShutdownTimeout)
	} else {
		slog.Info("starting dev-supervisor",
			"version", Version,
			"mode", "unix",
			"socket_path", cfg.SocketPath,
			"pid", os.Getpid(),
			"shutdown_timeout", cfg.ShutdownTimeout)
	}

	server := NewServer()

	// Check for additional command arguments to auto-start
	args := flag.Args()
	if len(args) > 0 {
		startServerWithCommand(server, cfg, args)
	} else {
		// No command specified, just start the server normally
		if err := server.StartWithConfig(cfg); err != nil {
			slog.Error("failed to start server", "error", err)
			os.Exit(1)
		}
	}
}
