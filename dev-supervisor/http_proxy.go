package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/cors"

	"github.com/airo-ai-builder/dev-supervisor/internal/auth"
	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/routing"
)

const (
	protoHTTP  = "http"
	protoHTTPS = "https"
)

func determineForwardedProto(req *http.Request) string {
	if raw := strings.TrimSpace(req.Header.Get("X-Forwarded-Proto")); raw != "" {
		normalized := strings.ToLower(raw)
		if normalized == protoHTTP || normalized == protoHTTPS {
			return normalized
		}

		slog.Warn("http.proxy.invalid_forwarded_proto",
			"value", raw,
			"remote_addr", req.RemoteAddr,
		)
	}

	if req.TLS != nil {
		return protoHTTPS
	}

	return protoHTTP
}

/**
 * getClientIP extracts the real client IP from CF-Connecting-IP header
 * Returns empty string if header is not present (direct connection, no Cloudflare)
 *
 * @param req - HTTP request
 * @returns client IP address string or empty string
 */
func getClientIP(req *http.Request) string {
	return strings.TrimSpace(req.Header.Get("Cf-Connecting-Ip"))
}

/**
 * getSrcIPAndPort splits RemoteAddr into IP and port components
 * RemoteAddr format is typically "ip:port" or "[ipv6]:port"
 *
 * @param remoteAddr - The RemoteAddr string from request
 * @returns IP address and port as separate strings
 */
func getSrcIPAndPort(remoteAddr string) (string, string) {
	// RemoteAddr is in format "ip:port" or "[ipv6]:port"
	host, port, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		// If split fails, return the whole address as IP with empty port
		return remoteAddr, ""
	}
	return host, port
}

/**
 * getRayID extracts the CF-Ray header for request tracing
 * Returns empty string if header is not present
 *
 * @param req - HTTP request
 * @returns CF-Ray value or empty string
 */
func getRayID(req *http.Request) string {
	return strings.TrimSpace(req.Header.Get("Cf-Ray"))
}

/**
 * HTTPProxyConfig defines configuration for the HTTP proxy server
 */
type HTTPProxyConfig struct {
	Enabled        bool          // Enable HTTP proxy mode
	ListenPort     int           // External HTTPS port for proxy
	TargetHost     string        // Backend host (typically localhost)
	TargetPort     int           // Backend port (app internal port, typically 8080)
	TLSCertPath    string        // Path to TLS certificate
	TLSKeyPath     string        // Path to TLS private key
	MaxRetries     int           // Maximum number of retries for connection errors (default: 5)
	InitialBackoff time.Duration // Initial backoff duration (default: 100ms)
	MaxBackoff     time.Duration // Maximum backoff duration (default: 2s)

	// Static serving configuration
	StaticRoot          string   // Root directory for static files (required if EnableStaticServing=true)
	EnableStaticServing bool     // Enable static file serving (explicit, default: false)
	SPAMode             bool     // Enable SPA fallback (default: true when static serving enabled)
	APIPrefix           string   // API route prefix (default: "/api")
	ConfigPath          string   // Optional path to routing config file
	AllowedOrigins      []string // CORS allowed origins (whitelist)

	// JWT authentication configuration
	// Auth failure handling uses hybrid mode: redirects browsers, returns 401 for APIs
	JWTEnabled        bool     // Enable JWT authentication (default: false)
	JWKSUrl           string   // JWKS endpoint URL
	JWKSSkipTLSVerify bool     // Skip TLS certificate verification (local dev only)
	JWTRedirectURL    string   // Redirect URL on auth failure (supports {url} placeholder)
	JWTBuilderBaseURL string   // Builder app base URL for smart redirects
	SiteID            string   // Site ID for smart redirects (from SITE_ID env var)
	JWTExcludedPaths  []string // Paths to exclude from JWT validation
}

/**
 * HTTPProxy provides HTTP reverse proxy with optional TLS termination
 *
 * Responsibilities:
 * - HTTPS termination using provided TLS certificates (optional)
 * - Plain HTTP mode when certificates are not provided
 * - Reverse proxy to backend application
 * - WebSocket upgrade support
 * - Request header forwarding
 * - Graceful lifecycle management
 */
type HTTPProxy struct {
	mu                    sync.RWMutex
	config                HTTPProxyConfig
	server                *http.Server
	listener              net.Listener
	running               bool
	reverseProxy          *httputil.ReverseProxy
	startTime             time.Time
	procMgr               *ProcessManager
	startOnRequestEnabled bool
}

/**
 * HTTPProxyStatus represents the current status of the HTTP proxy
 */
type HTTPProxyStatus struct {
	Enabled    bool   `json:"enabled"`
	Running    bool   `json:"running"`
	ListenAddr string `json:"listen_addr,omitempty"`
	TargetURL  string `json:"target_url,omitempty"`
	Uptime     string `json:"uptime,omitempty"`
}

/**
 * ProxyHealthResponse represents the health check response
 */
type ProxyHealthResponse struct {
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

/**
 * responseWriter wraps http.ResponseWriter to capture status code and response size
 * Used by loggingMiddleware for request logging
 * Implements http.Hijacker and http.Flusher interfaces for WebSocket and SSE support
 */
type responseWriter struct {
	http.ResponseWriter

	statusCode int
	size       int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}

// Hijack implements http.Hijacker interface to support WebSocket upgrades
// Delegates to the underlying ResponseWriter if it implements Hijacker
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("underlying ResponseWriter does not implement http.Hijacker")
	}
	return hijacker.Hijack()
}

// Flush implements http.Flusher interface to support Server-Sent Events (SSE)
// and chunked transfer encoding. Delegates to underlying ResponseWriter if it implements Flusher.
func (rw *responseWriter) Flush() {
	if flusher, ok := rw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

/**
 * RequestRouter handles HTTP request routing based on configuration
 * Routes requests to static file handler, SPA fallback, or backend proxy
 */
type RequestRouter struct {
	staticHandler         http.Handler
	proxyHandler          http.Handler
	spaFallback           string
	apiPrefix             string
	isProductionMode      bool
	allowedOrigins        []string
	procMgr               *ProcessManager
	startOnRequestEnabled bool
}

/**
 * handleAutoStart handles requests when the app is stopped
 * Holds the request open, starts the process, and forwards when ready
 */
func (rr *RequestRouter) handleAutoStart(w http.ResponseWriter, r *http.Request) {
	slog.Info("autostart.triggered",
		"path", r.URL.Path,
		"method", r.Method,
		"remote_addr", r.RemoteAddr)

	// Get current process start request
	startReq := rr.procMgr.GetStartRequest()
	if startReq == nil {
		slog.Error("autostart.no_config")
		http.Error(w, "Service configuration error", http.StatusInternalServerError)
		return
	}

	// Start the process
	startTime := time.Now()
	err := rr.procMgr.Start(*startReq)
	// Accept benign race conditions (already starting, already running)
	// These are success signals - another concurrent request beat us to it
	if err != nil {
		// Use typed error checking instead of string matching for robustness
		if !errors.Is(err, ErrAlreadyStarting) && !errors.Is(err, ErrAlreadyRunning) {
			slog.Error("autostart.failed", "error", err)
			http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		// Log the benign race for observability
		slog.Info("autostart.concurrent_race", "error", err.Error())
	}

	// Wait for process to be ready (hold the request)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.After(60 * time.Second)

	for {
		select {
		case <-r.Context().Done():
			// Client disconnected or canceled the request
			slog.Info("autostart.client_canceled",
				"path", r.URL.Path,
				"method", r.Method,
				"reason", r.Context().Err())
			return

		case <-timeout:
			slog.Error("autostart.timeout",
				"path", r.URL.Path,
				"method", r.Method)
			http.Error(w, "Service startup timeout", http.StatusGatewayTimeout)
			return

		case <-ticker.C:
			status := rr.procMgr.GetStatus()

			switch status.State {
			case ProcessStateStopped, ProcessStateStopping:
				// Keep waiting - these states shouldn't happen during startup
				// but handle them gracefully
				slog.Debug("autostart.unexpected_state",
					"state", status.State,
					"path", r.URL.Path)

			case ProcessStateRunning:
				duration := time.Since(startTime)
				slog.Info("autostart.process_ready",
					"pid", status.PID,
					"startup_duration_ms", duration.Milliseconds(),
					"path", r.URL.Path,
					"method", r.Method)

				// Update activity before forwarding
				rr.procMgr.UpdateActivity()

				// Forward the original request to backend
				rr.proxyHandler.ServeHTTP(w, r)
				return

			case ProcessStateError:
				slog.Error("autostart.process_failed",
					"error", status.Error,
					"state", status.State,
					"path", r.URL.Path)
				http.Error(w, "Service startup failed", http.StatusBadGateway)
				return

			case ProcessStateStarting:
				// Keep waiting
				slog.Debug("autostart.waiting",
					"pid", status.PID,
					"state", status.State)
			}
		}
	}
}

// handleStaticRequest handles static file serving and SPA fallback
// Returns true if the request was handled, false if it should fall through to proxy
func (rr *RequestRouter) handleStaticRequest(w http.ResponseWriter, r *http.Request) bool {
	// Has file extension? Serve as static file directly
	if path.Ext(r.URL.Path) != "" {
		slog.Debug("serving static file", "path", r.URL.Path, "method", r.Method)
		rr.staticHandler.ServeHTTP(w, r)
		return true
	}

	// No extension - first try to serve as a real file (e.g., /.well-known/apple-app-site-association)
	// If the file doesn't exist (404), fall back to SPA for GET requests or proxy for HEAD/OPTIONS
	if rr.staticHandler != nil {
		if handled := rr.tryServeStaticFile(w, r); handled {
			return true
		}
	}

	// SPA fallback for GET requests (serve index.html with no-cache)
	if rr.spaFallback != "" && r.Method == http.MethodGet {
		slog.Debug("SPA fallback", "path", r.URL.Path)
		// Set no-cache headers for SPA shell (index.html should never be cached)
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		http.ServeFile(w, r, rr.spaFallback)
		return true
	}

	return false
}

// tryServeStaticFile attempts to serve a file from the static handler
// Returns true if the request was handled (file found or 404 returned), false if it should fall through
func (rr *RequestRouter) tryServeStaticFile(w http.ResponseWriter, r *http.Request) bool {
	// Use an isolated recorder to probe if the file exists without contaminating
	// the real response writer's headers (avoids Content-Type: text/plain leak)
	recorder := httptest.NewRecorder()
	rr.staticHandler.ServeHTTP(recorder, r)

	// If file was found (not 404), copy the response to the real writer
	if recorder.Code != http.StatusNotFound {
		// Copy headers from recorder to real response
		maps.Copy(w.Header(), recorder.Header())

		// If serving HTML (e.g., index.html from a directory request like /),
		// override with strict no-cache headers to prevent stale app shell.
		// This is critical for SPA deployments where the HTML shell must always
		// be fresh to load the correct versioned JS/CSS bundles.
		contentType := recorder.Header().Get("Content-Type")
		if strings.Contains(contentType, "text/html") {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
		}

		w.WriteHeader(recorder.Code)
		// Safe: Static file proxy serving disk content (images, CSS, JS), not user input.
		// Semgrep G203 false positive - HTML escaping would corrupt binary/structured files.
		if _, err := w.Write(recorder.Body.Bytes()); err != nil {
			slog.Error("failed to write response body", "error", err)
		}
		return true
	}

	// File not found - behavior depends on method and SPA mode:
	// - GET with SPA enabled: fall through to SPA fallback below
	// - GET without SPA: fall through to proxy backend
	// - HEAD/OPTIONS with SPA enabled: return 404 (client-side routes don't exist as files)
	// - HEAD/OPTIONS without SPA: fall through to proxy backend (for health checks, CORS preflight)
	if r.Method != http.MethodGet && rr.spaFallback != "" {
		http.NotFound(w, r)
		return true
	}

	return false
}

/**
 * activityTrackingMiddleware wraps an http.Handler to track in-flight requests
 * for idle monitoring. Only active when start-on-request is enabled.
 * Excludes health checks, monitoring paths, and CORS preflight from updating activity at request start.
 * Always updates activity on request completion (via UntrackRequest) to prevent shutdown during long requests.
 */
func activityTrackingMiddleware(next http.Handler, procMgr *ProcessManager, excludedPaths []string) http.Handler {
	// Return no-op if ProcessManager is nil or start-on-request is disabled
	if procMgr == nil || !procMgr.IsStartOnRequestEnabled() {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Track request start (always count in-flight requests)
		procMgr.TrackRequest()

		// Update activity at request start for non-excluded paths
		// Skip health checks and monitoring to prevent automated probes from keeping apps alive
		// Note: CORS preflight is handled by CORS middleware and never reaches here
		if !middleware.IsPathExcluded(r.URL.Path, excludedPaths) {
			procMgr.UpdateActivity()
		}

		// Ensure cleanup always happens, even on panic
		// UntrackRequest always calls UpdateActivity() to prevent shutdown during long requests
		defer procMgr.UntrackRequest()

		// Call next handler
		next.ServeHTTP(w, r)
	})
}

/**
 * loggingMiddleware wraps an http.Handler to log requests with response details
 * Single responsibility: Observe and record HTTP request/response details
 */
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap response writer to capture status and size
		rw := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK, // Default to 200 if WriteHeader not called
			size:           0,
		}

		// Call next handler
		next.ServeHTTP(rw, r)

		// Log request with response details
		duration := time.Since(start)
		clientIP := getClientIP(r)
		srcIP, srcPort := getSrcIPAndPort(r.RemoteAddr)
		rayID := getRayID(r)

		logAttrs := []any{
			"type", "http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.statusCode,
			"size", rw.size,
			"duration_ms", duration.Milliseconds(),
			"src_ip", srcIP,
			"src_port", srcPort,
		}

		// Add client_ip if present (Cloudflare CF-Connecting-IP)
		if clientIP != "" {
			logAttrs = append(logAttrs, "client_ip", clientIP)
		}

		// Add ray_id if present (Cloudflare CF-Ray for tracing)
		if rayID != "" {
			logAttrs = append(logAttrs, "ray_id", rayID)
		}

		slog.Info("http.request", logAttrs...)
	})
}

/**
 * ServeHTTP implements http.Handler interface for RequestRouter
 * Routes requests based on path, method, and configuration
 *
 * Note: CORS and HTTP method validation are handled by middleware layers
 */
func (rr *RequestRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Check if we need to auto-start (any request can trigger it)
	if rr.procMgr != nil && rr.startOnRequestEnabled {
		status := rr.procMgr.GetStatus()
		// Auto-start if process is stopped or errored
		// This allows crashed apps to auto-restart on next request
		// Note: We don't auto-start ProcessStateStopping to avoid race conditions
		// where the process is intentionally shutting down
		if status.State == ProcessStateStopped || status.State == ProcessStateError {
			// Auto-start for any request (hold and forward)
			rr.handleAutoStart(w, r)
			return
		}
	}

	// 1. API routes - always proxy to backend
	if strings.HasPrefix(r.URL.Path, rr.apiPrefix) {
		slog.Debug("routing to API backend", "path", r.URL.Path)
		// Update activity before proxying
		if rr.procMgr != nil && rr.startOnRequestEnabled {
			rr.procMgr.UpdateActivity()
		}
		rr.proxyHandler.ServeHTTP(w, r)
		return
	}

	// 2. Static serving disabled - proxy everything else to backend
	if !rr.isProductionMode {
		slog.Debug("proxying to backend (static serving disabled)", "path", r.URL.Path)
		// Update activity before proxying
		if rr.procMgr != nil && rr.startOnRequestEnabled {
			rr.procMgr.UpdateActivity()
		}
		rr.proxyHandler.ServeHTTP(w, r)
		return
	}

	// 3. Static serving enabled - handle safe HTTP methods for static content
	// Handle GET, HEAD, OPTIONS for static assets (browsers use HEAD for cache validation)
	// Note: CORS preflight is handled by CORS middleware before reaching here
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		if handled := rr.handleStaticRequest(w, r); handled {
			return
		}
	}

	// 4. Default - proxy to backend
	// Update activity before proxying
	if rr.procMgr != nil && rr.startOnRequestEnabled {
		rr.procMgr.UpdateActivity()
	}
	rr.proxyHandler.ServeHTTP(w, r)
}

/**
 * retryTransport wraps an http.RoundTripper with retry logic
 * Retries connection errors with exponential backoff
 */
type retryTransport struct {
	base           http.RoundTripper
	maxRetries     int
	initialBackoff time.Duration
	maxBackoff     time.Duration
}

/**
 * RoundTrip implements http.RoundTripper with retry logic
 * Retries connection errors with exponential backoff
 *
 * @param req - HTTP request
 * @returns HTTP response and error
 */
func (t *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// WebSocket upgrade requests cannot be retried - they require a unique connection
	// and the Upgrade handshake is stateful. Attempting to retry would fail.
	if isWebSocketUpgrade(req) {
		return t.base.RoundTrip(req)
	}

	var lastErr error
	backoff := t.initialBackoff

	for attempt := 0; attempt <= t.maxRetries; attempt++ {
		// Try the request
		resp, err := t.base.RoundTrip(req)

		// Success - return response
		if err == nil {
			return resp, nil
		}

		// Check if error is retryable
		if !isRetryableError(err) {
			// Non-retryable error - return immediately
			return nil, err
		}

		lastErr = err

		// Last attempt - don't wait
		if attempt == t.maxRetries {
			break
		}

		// Log retry attempt with grouped context
		slog.Debug("retrying request due to connection error",
			slog.GroupAttrs("retry",
				slog.Int("attempt", attempt+1),
				slog.Int("max", t.maxRetries),
				slog.Duration("backoff", backoff),
			),
			slog.GroupAttrs("request",
				slog.String("method", req.Method),
				slog.String("path", req.URL.Path),
			),
			slog.String("error", err.Error()),
		)

		// Wait before retry
		time.Sleep(backoff)

		// Exponential backoff with max cap
		backoff *= 2
		if backoff > t.maxBackoff {
			backoff = t.maxBackoff
		}
	}

	// All retries exhausted
	slog.Warn("all retry attempts exhausted",
		slog.GroupAttrs("retry",
			slog.Int("max", t.maxRetries),
		),
		slog.GroupAttrs("request",
			slog.String("method", req.Method),
			slog.String("path", req.URL.Path),
		),
		slog.String("error", lastErr.Error()),
	)

	return nil, lastErr
}

/**
 * NewHTTPProxy creates a new HTTP proxy instance
 *
 * @param config - HTTP proxy configuration
 * @returns Initialized HTTPProxy instance
 */
func NewHTTPProxy(cfg HTTPProxyConfig) *HTTPProxy {
	// Set defaults for retry configuration from environment variables or use hardcoded defaults
	if cfg.MaxRetries == 0 {
		envMaxRetries := config.GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_MAX_RETRIES", 5)
		if envMaxRetries <= 0 {
			slog.Warn("invalid DEV_SUPERVISOR_PROXY_MAX_RETRIES value, using default", "invalid_value", envMaxRetries)
			cfg.MaxRetries = 5
		} else {
			cfg.MaxRetries = envMaxRetries
		}
	}

	if cfg.InitialBackoff == 0 {
		envInitialBackoffMs := config.GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS", 100)
		if envInitialBackoffMs <= 0 {
			slog.Warn(
				"invalid DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS value, using default",
				"invalid_value",
				envInitialBackoffMs,
			)
			envInitialBackoffMs = 100
		}
		cfg.InitialBackoff = time.Duration(envInitialBackoffMs) * time.Millisecond
	}

	if cfg.MaxBackoff == 0 {
		envMaxBackoffMs := config.GetEnvIntWithDefault("DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS", 2000)
		if envMaxBackoffMs <= 0 {
			slog.Warn(
				"invalid DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS value, using default",
				"invalid_value",
				envMaxBackoffMs,
			)
			envMaxBackoffMs = 2000
		}
		cfg.MaxBackoff = time.Duration(envMaxBackoffMs) * time.Millisecond
	}

	slog.Info("HTTP proxy retry configuration",
		slog.GroupAttrs("retry",
			slog.Int("max", cfg.MaxRetries),
			slog.Duration("initial_backoff", cfg.InitialBackoff),
			slog.Duration("max_backoff", cfg.MaxBackoff),
		),
	)

	return &HTTPProxy{
		config:  cfg,
		running: false,
	}
}

/**
 * isWebSocketUpgrade checks if a request is attempting a WebSocket upgrade
 *
 * @param req - HTTP request to check
 * @returns true if this is a WebSocket upgrade request
 */
func isWebSocketUpgrade(req *http.Request) bool {
	connHeader := strings.ToLower(req.Header.Get("Connection"))
	upgradeHeader := strings.ToLower(req.Header.Get("Upgrade"))
	return strings.Contains(connHeader, "upgrade") && upgradeHeader == "websocket"
}

/**
 * isRetryableError checks if an error should trigger a retry
 * Returns true for connection errors (backend not ready)
 * Returns false for HTTP errors (backend responded with error)
 *
 * @param err - Error to check
 * @returns true if error is retryable, false otherwise
 */
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}

	errStr := err.Error()

	// Connection refused - backend not ready
	if strings.Contains(errStr, "connection refused") {
		return true
	}

	// Network unreachable
	if strings.Contains(errStr, "network is unreachable") {
		return true
	}

	// Host unreachable
	if strings.Contains(errStr, "no route to host") {
		return true
	}

	// Connection timeout
	if strings.Contains(errStr, "i/o timeout") {
		return true
	}

	// DNS lookup errors
	if strings.Contains(errStr, "no such host") {
		return true
	}

	// Check for net.OpError (low-level network errors)
	var opErr *net.OpError
	return errors.As(err, &opErr)
}

/**
 * Start initializes and starts the HTTP proxy server
 *
 * Performs the following operations:
 * 1. Validates configuration
 * 2. Loads TLS certificates (if provided)
 * 3. Creates reverse proxy to backend
 * 4. Starts HTTPS listener (or HTTP if no certificates)
 * 5. Begins serving requests
 *
 * @returns error if startup fails, nil on success
 */
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

	// Create ReverseProxy manually with only Rewrite (not Director)
	// Note: Must have exactly one of Director or Rewrite set
	p.reverseProxy = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			// Set the target URL
			r.SetURL(targetURL)

			// Preserve original Host header (required for Vite HMR and backend routing)
			// This proxy only accepts requests from trusted sources (internal network),
			// so preserving the original Host header is safe.
			r.Out.Host = r.In.Host
			r.Out.Header.Set("Host", r.In.Host)

			// Check if this is a WebSocket upgrade request (check once and reuse)
			isWebSocket := isWebSocketUpgrade(r.In)

			// Preserve WebSocket upgrade headers (critical for Vite HMR)
			// The Connection and Upgrade headers must be explicitly copied for WebSocket support
			if isWebSocket {
				// Copy WebSocket-specific headers using a loop to reduce duplication
				wsHeadersToCopy := []string{
					"Connection",
					"Upgrade",
					"Sec-WebSocket-Key",
					"Sec-WebSocket-Version",
					"Sec-WebSocket-Extensions",
					"Sec-WebSocket-Protocol",
				}
				for _, headerName := range wsHeadersToCopy {
					if value := r.In.Header.Get(headerName); value != "" {
						r.Out.Header.Set(headerName, value)
					}
				}

				slog.Debug("proxying WebSocket upgrade request",
					"method", r.In.Method,
					"path", r.In.URL.Path,
					"host", r.In.Host,
					"target", targetURL.String())
			}

			// Copy X-Forwarded-For unchanged from incoming request (if present)
			// By default, ReverseProxy removes X-Forwarded-* headers, so we explicitly copy it
			if xff := r.In.Header.Get("X-Forwarded-For"); xff != "" {
				r.Out.Header["X-Forwarded-For"] = []string{xff}
			}

			// Set X-Forwarded-Proto based on upstream input or actual scheme
			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))

			// Note: X-Forwarded-Host is not set (Host header is already correct)
			// Note: X-Real-IP is not set (only accessible by trusted sources)

			if !isWebSocket {
				clientIP := getClientIP(r.In)
				srcIP, srcPort := getSrcIPAndPort(r.In.RemoteAddr)
				rayID := getRayID(r.In)

				logAttrs := []any{
					"method", r.In.Method,
					"path", r.In.URL.Path,
					"host", r.In.Host,
					"target", targetURL.String(),
					"src_ip", srcIP,
					"src_port", srcPort,
				}

				if clientIP != "" {
					logAttrs = append(logAttrs, "client_ip", clientIP)
				}

				if rayID != "" {
					logAttrs = append(logAttrs, "ray_id", rayID)
				}

				slog.Debug("proxying request", logAttrs...)
			}
		},
		// ModifyResponse removes CORS headers from backend responses to prevent duplication
		// The rs/cors middleware (outer layer) will add the correct CORS headers
		// This handles cases where backends (like Vite) set their own CORS headers
		ModifyResponse: func(resp *http.Response) error {
			// Remove all CORS headers that backends might set
			// This prevents duplicate CORS headers when both proxy and backend set them
			resp.Header.Del("Access-Control-Allow-Origin")
			resp.Header.Del("Access-Control-Allow-Credentials")
			resp.Header.Del("Access-Control-Allow-Methods")
			resp.Header.Del("Access-Control-Allow-Headers")
			resp.Header.Del("Access-Control-Max-Age")
			resp.Header.Del("Access-Control-Expose-Headers")
			return nil
		},
		Transport: retryTransport,
		// FlushInterval enables streaming responses and is required for WebSockets
		// and Server-Sent Events (SSE). Without this, responses are buffered.
		FlushInterval: -1, // Flush immediately (required for WebSockets)
		// Note: CORS headers are set by CORS middleware (outermost layer)
	}

	// Custom error handler
	p.reverseProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		// Determine appropriate status code based on error type
		statusCode := http.StatusBadGateway

		// Check if this is a connection error (backend not ready)
		if isRetryableError(err) {
			// 503 Service Unavailable - backend is starting up or temporarily unavailable
			statusCode = http.StatusServiceUnavailable

			slog.Warn("backend not ready after retries",
				"error", err,
				"method", r.Method,
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr)
		} else {
			// 502 Bad Gateway - actual proxy error
			slog.Error("proxy error",
				"error", err,
				"method", r.Method,
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr)
		}

		// CORS headers are set by CORS middleware (outermost layer)
		// Return appropriate status code with generic error message to avoid information disclosure
		// Use http.Error to avoid XSS vulnerability from fmt.Fprintf
		// Detailed error information is already logged above
		http.Error(w, http.StatusText(statusCode), statusCode)
	}

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
	handler = connectionTrackingMiddleware(handler, p.procMgr)

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

		// Create JWT middleware (uses hybrid mode: redirects browsers, 401 for APIs)
		jwtMiddleware := auth.NewJWTMiddleware(auth.JWTMiddlewareConfig{
			Enabled:        true,
			Validator:      validator,
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
	handler = methodValidationMiddleware(handler)

	// CORS middleware using rs/cors library
	// Handles CORS for all requests (preflight, actual requests, errors)
	corsMiddleware := cors.New(cors.Options{
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
	handler = corsMiddleware.Handler(handler)

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

/**
 * EnableStartOnRequest enables start-on-request functionality
 * Must be called before Start()
 *
 * @param procMgr - Process manager instance
 * @param idleTimeout - Duration of inactivity before auto-stopping
 * @param checkInterval - How often to check for idle timeout
 */
func (p *HTTPProxy) EnableStartOnRequest(procMgr *ProcessManager, idleTimeout, checkInterval time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.procMgr = procMgr
	p.startOnRequestEnabled = true

	// Enable idle monitoring in ProcessManager
	// (ProcessManager will log the configuration)
	procMgr.EnableStartOnRequest(idleTimeout, checkInterval)
}

/**
 * Stop gracefully shuts down the HTTP proxy server
 *
 * @returns error if shutdown fails, nil on success
 */
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

/**
 * GetStatus returns the current status of the HTTP proxy
 *
 * @returns HTTPProxyStatus containing current state information
 */
func (p *HTTPProxy) GetStatus() HTTPProxyStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()

	status := HTTPProxyStatus{
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

/**
 * Addr returns the listener address if running
 *
 * @returns listener address string or empty string if not running
 */
func (p *HTTPProxy) Addr() string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if p.listener != nil {
		return p.listener.Addr().String()
	}
	return ""
}

/**
 * validateConfig validates the proxy configuration
 *
 * @returns error if configuration is invalid, nil if valid
 */
func (p *HTTPProxy) validateConfig() error {
	if p.config.ListenPort <= 0 || p.config.ListenPort > 65535 {
		return fmt.Errorf("invalid listen port: %d", p.config.ListenPort)
	}

	if p.config.TargetPort <= 0 || p.config.TargetPort > 65535 {
		return fmt.Errorf("invalid target port: %d", p.config.TargetPort)
	}

	if p.config.TargetHost == "" {
		return errors.New("target host cannot be empty")
	}

	// TLS certificates are optional - if provided, both cert and key must be specified
	hasCert := p.config.TLSCertPath != ""
	hasKey := p.config.TLSKeyPath != ""

	if hasCert != hasKey {
		return fmt.Errorf("both TLS certificate and key must be provided, or neither (cert=%q, key=%q)",
			p.config.TLSCertPath, p.config.TLSKeyPath)
	}

	// If TLS paths are provided, validate they exist
	if hasCert {
		if _, err := os.Stat(p.config.TLSCertPath); os.IsNotExist(err) {
			return fmt.Errorf("TLS certificate file not found: %s", p.config.TLSCertPath)
		}

		if _, err := os.Stat(p.config.TLSKeyPath); os.IsNotExist(err) {
			return fmt.Errorf("TLS key file not found: %s", p.config.TLSKeyPath)
		}
	}

	return nil
}

/**
 * validateStaticServingConfig validates static serving configuration after routing config is loaded
 *
 * This validation happens after routing.LoadConfig() so it can validate the merged configuration
 * (env vars + JSON config) rather than just env vars.
 *
 * @param routingConfig - The merged routing configuration to validate
 * @returns error if configuration is invalid
 */
func (p *HTTPProxy) validateStaticServingConfig(routingConfig routing.Config) error {
	if !p.config.EnableStaticServing {
		slog.Info("static file serving disabled, proxying all requests to backend")
		return nil
	}

	// Determine effective static root (from routingConfig or fallback to p.config)
	staticRoot := routingConfig.StaticRoot
	if staticRoot == "" {
		staticRoot = p.config.StaticRoot
	}

	if staticRoot == "" {
		return errors.New(
			"static root must be specified when static serving is enabled (via DEV_SUPERVISOR_STATIC_ROOT env var or static_root in routing config)",
		)
	}

	// Check if static root exists (warn but don't fail - directory may be created after startup)
	if _, err := os.Stat(staticRoot); os.IsNotExist(err) {
		slog.Warn("static root directory does not exist at startup, will be unavailable until created",
			"path", staticRoot)
	} else if routingConfig.SPAMode {
		// Only check index.html if directory exists and SPA mode is enabled
		indexPath := filepath.Join(staticRoot, "index.html")
		if _, err := os.Stat(indexPath); os.IsNotExist(err) {
			slog.Warn("index.html not found in static root, SPA fallback may not work",
				"path", indexPath)
		}
	}

	// Log whether using default or custom static root
	isDefault := staticRoot == "/app/dist/client"
	slog.Info("static file serving enabled",
		"root", staticRoot,
		"spa_mode", routingConfig.SPAMode,
		"using_default_root", isDefault)

	return nil
}

/**
 * loadTLSConfig loads and configures TLS settings
 *
 * @returns configured tls.Config or error
 */
func (p *HTTPProxy) loadTLSConfig() (*tls.Config, error) {
	// Load certificate and key
	cert, err := tls.LoadX509KeyPair(p.config.TLSCertPath, p.config.TLSKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load certificate pair: %w", err)
	}

	// Create TLS configuration
	// Only include cipher suites with forward secrecy (ECDHE)
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
		},
		PreferServerCipherSuites: true,
	}

	slog.Info("TLS configuration loaded",
		"cert_path", p.config.TLSCertPath,
		"min_tls_version", "1.2")

	return tlsConfig, nil
}

/**
 * handleHealthCheck handles health check requests for the proxy
 * Performs a TCP dial to the target to verify it's reachable
 *
 * For start-on-request mode: If the process is stopped but was healthy before being
 * idled due to inactivity, returns "healthy" with reason "idle" instead of probing
 * the backend. This allows health checks to pass for idled apps without waking them.
 *
 * @param w - Response writer
 * @param r - HTTP request
 */
func (p *HTTPProxy) handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	slog.Debug("proxy.health.check", "remote_addr", r.RemoteAddr)

	// CORS headers are set by CORS middleware (outermost layer)
	// Set content type and cache control headers
	// Health check responses should never be cached as they reflect real-time status
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check if proxy is enabled (shouldn't happen as handler is only registered when enabled)
	if !p.config.Enabled {
		resp := ProxyHealthResponse{
			Status: "unhealthy",
			Reason: "proxy not enabled",
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("proxy.health.encode_error", "error", err)
		}
		return
	}

	// Check if process is idled but was healthy before idle (start-on-request mode only)
	// This allows health checks to pass for idled apps without waking them
	if p.procMgr != nil && p.startOnRequestEnabled {
		status := p.procMgr.GetStatus()
		if status.State == ProcessStateStopped && p.procMgr.WasHealthyBeforeIdle() {
			slog.Debug("proxy.health.idle_healthy",
				"remote_addr", r.RemoteAddr,
				"state", status.State)

			resp := ProxyHealthResponse{
				Status: "healthy",
				Reason: "idle",
			}
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(resp); err != nil {
				slog.Error("proxy.health.encode_error", "error", err)
			}
			return
		}
	}

	// Perform HTTP GET to target with timeout
	targetURL := fmt.Sprintf(
		"http://%s/",
		net.JoinHostPort(p.config.TargetHost, strconv.Itoa(p.config.TargetPort)),
	)

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			// Don't follow redirects - 3xx responses are not considered healthy
			return http.ErrUseLastResponse
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		slog.Debug("proxy.health.request_error",
			"target", targetURL,
			"error", err.Error())

		resp := ProxyHealthResponse{
			Status: "unhealthy",
			Reason: "failed to create request",
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		if encodeErr := json.NewEncoder(w).Encode(resp); encodeErr != nil {
			slog.Error("proxy.health.encode_error", "error", encodeErr)
		}
		return
	}

	httpResp, err := client.Do(req)
	if err != nil {
		slog.Debug("proxy.health.target_unreachable",
			"target", targetURL,
			"error", err.Error())

		resp := ProxyHealthResponse{
			Status: "unhealthy",
			Reason: "target not reachable",
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		if encodeErr := json.NewEncoder(w).Encode(resp); encodeErr != nil {
			slog.Error("proxy.health.encode_error", "error", encodeErr)
		}
		return
	}
	defer httpResp.Body.Close()

	// Discard response body
	if _, discardErr := io.Copy(io.Discard, httpResp.Body); discardErr != nil {
		slog.Debug("proxy.health.discard_error", "error", discardErr.Error())
	}

	// Check status code - only 2xx is healthy (aligned with mhp-core SimpleDomainHealthService)
	if httpResp.StatusCode >= 200 && httpResp.StatusCode < 300 {
		// Target is healthy
		resp := ProxyHealthResponse{
			Status: "healthy",
		}
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("proxy.health.encode_error", "error", err)
		}
		return
	}

	// Target returned error status
	slog.Debug("proxy.health.target_error",
		"target", targetURL,
		"status", httpResp.StatusCode)

	resp := ProxyHealthResponse{
		Status: "unhealthy",
		Reason: fmt.Sprintf("target returned status %d", httpResp.StatusCode),
	}
	w.WriteHeader(http.StatusServiceUnavailable)
	if encodeErr := json.NewEncoder(w).Encode(resp); encodeErr != nil {
		slog.Error("proxy.health.encode_error", "error", encodeErr)
	}
}
