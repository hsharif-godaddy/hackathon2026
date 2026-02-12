package httpproxy

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/rs/cors"

	"github.com/airo-ai-builder/dev-supervisor/internal/auth"
	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/routing"
)

// HTTPProxy provides HTTP reverse proxy with optional TLS termination.
//
// Responsibilities:
// - HTTPS termination using provided TLS certificates (optional)
// - Plain HTTP mode when certificates are not provided
// - Reverse proxy to backend application
// - WebSocket upgrade support
// - Request header forwarding
// - Graceful lifecycle management
type HTTPProxy struct {
	mu                    sync.RWMutex
	config                Config
	server                *http.Server
	listener              net.Listener
	running               bool
	reverseProxy          *httputil.ReverseProxy
	corsMiddleware        *cors.Cors
	startTime             time.Time
	procMgr               ProcessController
	startOnRequestEnabled bool
}

// Start initializes and starts the HTTP proxy server.
func (p *HTTPProxy) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.running {
		return errors.New("HTTP proxy already running")
	}

	// Validate configuration
	if err := p.validateConfig(); err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}

	// Load TLS certificates if provided
	var tlsConfig *tls.Config
	useTLS := p.config.TLSCertPath != "" && p.config.TLSKeyPath != ""
	if useTLS {
		var err error
		tlsConfig, err = p.loadTLSConfig()
		if err != nil {
			return fmt.Errorf("failed to load TLS certificates: %w", err)
		}
		// Enable HTTP/2 support (includes ALPN negotiation for h2)
		// This allows clients to negotiate HTTP/2 over TLS
		tlsConfig.NextProtos = []string{"h2", "http/1.1"}
	}

	// Create reverse proxy to backend
	targetURL := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%d", p.config.TargetHost, p.config.TargetPort),
	}

	// Create custom transport with retry logic
	baseTransport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		// ForceAttemptHTTP2 enables HTTP/2 for non-TLS connections (h2c)
		// Not enabled by default as backend typically uses HTTP/1.1
		// ForceAttemptHTTP2: true,
	}

	// Wrap transport with retry logic
	retryTransport := &retryTransport{
		base:           baseTransport,
		maxRetries:     p.config.MaxRetries,
		initialBackoff: p.config.InitialBackoff,
		maxBackoff:     p.config.MaxBackoff,
	}

	// Create reverse proxy to backend
	p.reverseProxy = p.newReverseProxy(targetURL, retryTransport)

	// Load routing configuration (with error handling)
	routingConfig, err := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: p.config.ConfigPath,
		APIPrefix:  p.config.APIPrefix,
		StaticRoot: p.config.StaticRoot,
		SPAMode:    p.config.SPAMode,
	})
	if err != nil {
		return fmt.Errorf("failed to load routing configuration: %w", err)
	}

	// Validate static serving configuration (after loading routing config)
	if validateErr := p.validateStaticServingConfig(routingConfig); validateErr != nil {
		return fmt.Errorf("invalid static serving configuration: %w", validateErr)
	}

	// Create HTTP server mux
	mux := http.NewServeMux()

	// Add health check endpoint (unauthenticated, always available)
	mux.HandleFunc("/airo/health", p.handleHealthCheck)

	// Add canary checks endpoint for infrastructure verification
	mux.HandleFunc("/airo/canary_checks", handleCanaryChecks)

	// Add media slot handlers - use app directory for manifest (not static root)
	// The manifest is written to the app root by the agents service, not to the build output
	appDir := os.Getenv("CUSTOMER_APP_DIR")
	if appDir == "" {
		appDir = "/app" // Default app directory in container
	}
	manifestPath := filepath.Join(appDir, "airo-media.json")
	mediaSlotCache := NewManifestCache(manifestPath)
	mux.Handle("/airo-assets/images/", NewImageSlotHandler(mediaSlotCache))
	mux.Handle("/airo-assets/videos/", NewVideoSlotHandler(mediaSlotCache))
	slog.Debug("media_slot.handlers_registered", "manifest_path", manifestPath)

	// Add catch-all for /airo/* that returns 404 for unmatched paths
	// This MUST come after specific /airo/* handlers but before the / catch-all
	mux.HandleFunc("/airo/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	// Create request router
	router := &RequestRouter{
		proxyHandler:          p.reverseProxy,
		apiPrefix:             routingConfig.APIPrefix,
		isProductionMode:      p.config.EnableStaticServing,
		allowedOrigins:        p.config.AllowedOrigins,
		procMgr:               p.procMgr,
		startOnRequestEnabled: p.startOnRequestEnabled,
	}

	// Route all other requests to the router
	mux.Handle("/", router)

	// Configure static serving if enabled
	if p.config.EnableStaticServing {
		// Use static root from routing config (which may come from JSON or env var)
		staticRoot := routingConfig.StaticRoot
		if staticRoot == "" {
			staticRoot = p.config.StaticRoot
		}

		router.staticHandler = routing.NewStaticFileHandler(staticRoot, routingConfig.CacheControl)

		if routingConfig.SPAMode {
			router.spaFallback = filepath.Join(staticRoot, "index.html")
		}
	}

	// Build middleware chain (outermost to innermost):
	// logging -> CORS -> method validation -> JWT -> connection tracking -> activity -> router
	//
	// This order ensures:
	// - All requests are logged (logging first)
	// - CORS is handled before authentication (preflight has no auth)
	// - Only valid HTTP methods proceed (early rejection)
	// - Authentication happens before activity tracking
	// - WebSocket connections are tracked for idle monitoring
	// - Only authenticated requests count as activity
	handler := http.Handler(mux)

	// Determine excluded paths for activity tracking
	// Always exclude health check and monitoring paths from updating activity
	// to prevent automated probes from keeping apps alive indefinitely
	activityExcludedPaths := p.config.JWTExcludedPaths
	if activityExcludedPaths == nil {
		activityExcludedPaths = []string{}
	}

	// Activity tracking middleware (tracks requests for idle monitoring)
	// Placed after JWT so only authenticated requests count as activity
	handler = activityTrackingMiddleware(handler, p.procMgr, activityExcludedPaths)

	// Connection tracking middleware (tracks WebSocket connections)
	// Wraps response writer to intercept Hijack() calls
	handler = middleware.ConnectionTracking(handler, p.procMgr)

	// JWT middleware (if enabled)
	if p.config.JWTEnabled {
		if p.config.JWKSUrl == "" {
			return errors.New("JWT authentication enabled but JWKS_URL not configured")
		}
		if p.config.SiteID == "" {
			return errors.New("JWT authentication enabled but SITE_ID not configured")
		}
		if p.config.JWTBuilderBaseURL == "" {
			return errors.New("JWT authentication enabled but DEV_SUPERVISOR_JWT_BUILDER_BASE_URL not configured")
		}

		// Create JWT validator
		validator := auth.NewJWTValidator(auth.JWTValidatorConfig{
			JWKSUrl:       p.config.JWKSUrl,
			SkipTLSVerify: p.config.JWKSSkipTLSVerify,
		})

		// Create share token validator if enabled
		var shareValidator *auth.ShareValidator
		if p.config.EnableShareTokens {
			shareValidator = auth.NewShareValidator(p.config.AgentsBaseURL)
			slog.Info("Share token validation enabled",
				"agents_base_url", p.config.AgentsBaseURL)
		}

		// Create JWT middleware (uses hybrid mode: redirects browsers, 401 for APIs)
		jwtMiddleware := auth.NewJWTMiddleware(auth.JWTMiddlewareConfig{
			Enabled:        true,
			Validator:      validator,
			ShareValidator: shareValidator,
			RedirectURL:    p.config.JWTRedirectURL,
			BuilderBaseURL: p.config.JWTBuilderBaseURL,
			SiteID:         p.config.SiteID,
			ExcludedPaths:  p.config.JWTExcludedPaths,
			APIPrefix:      routingConfig.APIPrefix,
			AllowedOrigins: p.config.AllowedOrigins,
		})

		// Wrap handler with JWT middleware
		handler = jwtMiddleware.Wrap(handler)

		slog.Info("JWT authentication enabled (hybrid mode)",
			"jwksURL", p.config.JWKSUrl,
			"excludedPaths", p.config.JWTExcludedPaths)
	}

	// HTTP method validation middleware
	// Rejects unsupported methods (CONNECT, TRACE, etc.)
	handler = middleware.MethodValidation(handler)

	// CORS middleware using rs/cors library
	// Handles CORS for all requests (preflight, actual requests, errors)
	p.corsMiddleware = cors.New(cors.Options{
		AllowedOrigins: p.config.AllowedOrigins,
		AllowedMethods: []string{
			http.MethodGet,
			http.MethodHead,
			http.MethodPost,
			http.MethodPut,
			http.MethodPatch,
			http.MethodDelete,
			http.MethodOptions,
		},
		// Allow all headers including custom ones (X-Requested-With, X-CSRF-Token, analytics headers, etc.)
		// This is required for builder UI and prevents preflight failures
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
		MaxAge:           86400, // Cache preflight for 24 hours
	})
	handler = p.corsMiddleware.Handler(handler)

	// Logging middleware (outermost layer)
	// Logs all requests with response details
	handler = loggingMiddleware(handler)

	// Create HTTP server with middleware-wrapped handler
	p.server = &http.Server{
		Handler:     handler,
		TLSConfig:   tlsConfig,
		ReadTimeout: 30 * time.Second,
		// WriteTimeout intentionally omitted - would break WebSockets and SSE
		// WebSocket and SSE connections are long-lived and can't have write timeouts
		IdleTimeout: 120 * time.Second,
	}

	// Create listener (TLS or plain HTTP)
	listenAddr := fmt.Sprintf(":%d", p.config.ListenPort)
	//nolint:noctx // Long-lived server listener, no request context available
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to create listener on port %d: %w", p.config.ListenPort, err)
	}

	// Wrap with TLS if enabled
	if useTLS {
		listener = tls.NewListener(listener, tlsConfig)
	}

	p.listener = listener
	p.running = true
	p.startTime = time.Now()

	actualAddr := p.listener.Addr().String()
	if useTLS {
		slog.Info("HTTP proxy started with TLS",
			"listen_addr", actualAddr,
			"target_url", targetURL.String(),
			"tls_cert", p.config.TLSCertPath)
	} else {
		slog.Info("HTTP proxy started without TLS",
			"listen_addr", actualAddr,
			"target_url", targetURL.String())
	}

	// Start serving in background
	go func() {
		if err := p.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP proxy server error", "error", err)
		}
	}()

	return nil
}

// EnableStartOnRequest enables start-on-request behavior with idle monitoring.
func (p *HTTPProxy) EnableStartOnRequest(procMgr ProcessController, idleTimeout, checkInterval time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.procMgr = procMgr
	p.startOnRequestEnabled = true

	// Enable idle monitoring in ProcessController (logs configuration).
	procMgr.EnableStartOnRequest(idleTimeout, checkInterval)
}

// Stop gracefully shuts down the HTTP proxy server.
func (p *HTTPProxy) Stop() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return nil
	}

	p.running = false

	if p.server != nil {
		// Graceful shutdown with 5 second timeout
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := p.server.Shutdown(ctx); err != nil {
			slog.Warn("error during HTTP proxy shutdown", "error", err)
			// Force close if graceful shutdown fails
			if closeErr := p.server.Close(); closeErr != nil {
				slog.Error("error force closing HTTP proxy", "error", closeErr)
			}
			return err
		}
	}

	slog.Info("HTTP proxy stopped")
	return nil
}

// GetStatus returns the current status of the HTTP proxy.
func (p *HTTPProxy) GetStatus() Status {
	p.mu.RLock()
	defer p.mu.RUnlock()

	status := Status{
		Enabled: p.config.Enabled,
		Running: p.running,
	}

	if p.listener != nil {
		status.ListenAddr = p.listener.Addr().String()
	}

	if p.running {
		targetURL := "http://" + net.JoinHostPort(p.config.TargetHost, strconv.Itoa(p.config.TargetPort))
		status.TargetURL = targetURL
		status.Uptime = time.Since(p.startTime).String()
	}

	return status
}

// Addr returns the listener address if running.
func (p *HTTPProxy) Addr() string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if p.listener != nil {
		return p.listener.Addr().String()
	}
	return ""
}
