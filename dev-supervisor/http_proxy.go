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
	"strings"
	"sync"
	"time"
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
	return strings.TrimSpace(req.Header.Get("CF-Connecting-IP"))
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
	return strings.TrimSpace(req.Header.Get("CF-Ray"))
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
 * Implements http.Hijacker to support WebSocket upgrades through the proxy
 */
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	size       int
	procMgr    *ProcessManager // For WebSocket tracking
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
// This is required for the reverse proxy to upgrade HTTP connections to WebSocket
// Also registers the hijacked connection with ProcessManager for idle tracking
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
	}
	conn, buf, err := hijacker.Hijack()
	if err != nil {
		return nil, nil, err
	}

	// Wrap connection to track WebSocket lifecycle if ProcessManager is available
	if rw.procMgr != nil {
		conn = &trackedConn{
			Conn:    conn,
			procMgr: rw.procMgr,
		}
		rw.procMgr.RegisterWebSocket(conn)
	}

	return conn, buf, nil
}

/**
 * trackedConn wraps net.Conn to automatically unregister WebSocket connections
 * when they close, ensuring accurate idle tracking
 */
type trackedConn struct {
	net.Conn
	procMgr *ProcessManager
	once    sync.Once
}

func (tc *trackedConn) Close() error {
	// Unregister exactly once, even if Close is called multiple times
	tc.once.Do(func() {
		if tc.procMgr != nil {
			tc.procMgr.UnregisterWebSocket(tc)
		}
	})
	return tc.Conn.Close()
}

// Flush implements http.Flusher interface to support Server-Sent Events (SSE)
// and chunked transfer encoding. This is required for streaming responses.
func (rw *responseWriter) Flush() {
	flusher, ok := rw.ResponseWriter.(http.Flusher)
	if ok {
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

func (rr *RequestRouter) writeStaticOptionsResponse(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")

	// Validate origin against whitelist
	if !isOriginAllowed(origin, rr.allowedOrigins) {
		// Origin not in whitelist - return without CORS headers
		slog.Debug("cors.static.origin.rejected", "origin", origin)
		w.WriteHeader(http.StatusForbidden)
		return
	}

	// Set CORS headers
	if len(rr.allowedOrigins) > 0 {
		// Whitelist mode - echo the validated origin
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Origin", origin)
	} else {
		// Permissive mode - use wildcard or echo origin
		if origin == "" {
			origin = "*"
		} else {
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}

	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	if reqHeaders := r.Header.Get("Access-Control-Request-Headers"); reqHeaders != "" {
		w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
	}

	w.Header().Set("Allow", "GET, HEAD, OPTIONS")
	w.WriteHeader(http.StatusNoContent)
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

/**
 * loggingMiddleware wraps an http.Handler to log requests with response details
 * Optionally tracks WebSocket connections if procMgr is provided
 */
func loggingMiddleware(next http.Handler, procMgr *ProcessManager) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap response writer to capture status and size
		rw := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK, // Default to 200 if WriteHeader not called
			size:           0,
			procMgr:        procMgr, // Enable WebSocket tracking if available
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
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		// Has file extension? Serve as static file directly
		if path.Ext(r.URL.Path) != "" {
			if r.Method == http.MethodOptions {
				rr.writeStaticOptionsResponse(w, r)
				return
			}
			slog.Debug("serving static file", "path", r.URL.Path, "method", r.Method)
			rr.staticHandler.ServeHTTP(w, r)
			return
		}

		// No extension - first try to serve as a real file (e.g., /.well-known/apple-app-site-association)
		// If the file doesn't exist (404), fall back to SPA for GET requests or proxy for HEAD/OPTIONS
		if rr.staticHandler != nil {
			// Use an isolated recorder to probe if the file exists without contaminating
			// the real response writer's headers (avoids Content-Type: text/plain leak)
			recorder := httptest.NewRecorder()
			rr.staticHandler.ServeHTTP(recorder, r)

			// If file was found (not 404), copy the response to the real writer
			if recorder.Code != http.StatusNotFound {
				if r.Method == http.MethodOptions {
					rr.writeStaticOptionsResponse(w, r)
					return
				}
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
				if _, err := w.Write(recorder.Body.Bytes()); err != nil {
					slog.Error("failed to write response body", "error", err)
				}
				return
			}

			// File not found - behavior depends on method and SPA mode:
			// - GET with SPA enabled: fall through to SPA fallback below
			// - GET without SPA: fall through to proxy backend
			// - HEAD/OPTIONS with SPA enabled: return 404 (client-side routes don't exist as files)
			// - HEAD/OPTIONS without SPA: fall through to proxy backend (for health checks, CORS preflight)
			if r.Method != http.MethodGet && rr.spaFallback != "" {
				http.NotFound(w, r)
				return
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
 * RoutingConfig defines advanced routing rules loaded from JSON file (optional)
 */
type RoutingConfig struct {
	StaticRoot   string        `json:"static_root"`
	SPAMode      bool          `json:"spa_mode"`
	APIPrefix    string        `json:"api_prefix"`
	ForwardRules []ForwardRule `json:"forward_rules"`
	CacheControl CacheSettings `json:"cache_control"`
}

/**
 * routingConfigJSON is used for unmarshalling JSON with optional fields
 * Uses pointers so we can distinguish between "not set" and "set to false/zero"
 */
type routingConfigJSON struct {
	StaticRoot    *string            `json:"static_root"`
	SPAMode       *bool              `json:"spa_mode"`
	APIPrefix     *string            `json:"api_prefix"`
	ForwardRules  []ForwardRule      `json:"forward_rules"`
	CacheControl  *cacheSettingsJSON `json:"cache_control"`
	EnableCaching *bool              `json:"enable_caching"` // Deprecated, use cache_control.enable_caching
}

/**
 * cacheSettingsJSON is used for unmarshalling cache settings from JSON
 * Uses pointers so we can distinguish between "not set" and "set to false/zero"
 */
type cacheSettingsJSON struct {
	EnableCaching *bool           `json:"enable_caching"`
	MaxAge        *map[string]int `json:"max_age"` // file extension -> seconds
}

/**
 * ForwardRule defines a custom routing rule for advanced request forwarding
 */
type ForwardRule struct {
	PathPattern string   `json:"path_pattern"` // Regex or glob pattern
	TargetURL   string   `json:"target_url"`   // Where to forward
	Rewrite     string   `json:"rewrite"`      // Optional path rewrite
	Methods     []string `json:"methods"`      // HTTP methods (default: all)
}

/**
 * CacheSettings defines cache control headers for static assets
 */
type CacheSettings struct {
	EnableCaching bool           `json:"enable_caching"`
	MaxAge        map[string]int `json:"max_age"` // file extension -> seconds
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
func NewHTTPProxy(config HTTPProxyConfig) *HTTPProxy {
	// Set defaults for retry configuration from environment variables or use hardcoded defaults
	if config.MaxRetries == 0 {
		envMaxRetries := getEnvIntWithDefault("DEV_SUPERVISOR_PROXY_MAX_RETRIES", 5)
		if envMaxRetries <= 0 {
			slog.Warn("invalid DEV_SUPERVISOR_PROXY_MAX_RETRIES value, using default", "invalid_value", envMaxRetries)
			config.MaxRetries = 5
		} else {
			config.MaxRetries = envMaxRetries
		}
	}

	if config.InitialBackoff == 0 {
		envInitialBackoffMs := getEnvIntWithDefault("DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS", 100)
		if envInitialBackoffMs <= 0 {
			slog.Warn("invalid DEV_SUPERVISOR_PROXY_INITIAL_BACKOFF_MS value, using default", "invalid_value", envInitialBackoffMs)
			envInitialBackoffMs = 100
		}
		config.InitialBackoff = time.Duration(envInitialBackoffMs) * time.Millisecond
	}

	if config.MaxBackoff == 0 {
		envMaxBackoffMs := getEnvIntWithDefault("DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS", 2000)
		if envMaxBackoffMs <= 0 {
			slog.Warn("invalid DEV_SUPERVISOR_PROXY_MAX_BACKOFF_MS value, using default", "invalid_value", envMaxBackoffMs)
			envMaxBackoffMs = 2000
		}
		config.MaxBackoff = time.Duration(envMaxBackoffMs) * time.Millisecond
	}

	slog.Info("HTTP proxy retry configuration",
		slog.GroupAttrs("retry",
			slog.Int("max", config.MaxRetries),
			slog.Duration("initial_backoff", config.InitialBackoff),
			slog.Duration("max_backoff", config.MaxBackoff),
		),
	)

	return &HTTPProxy{
		config:  config,
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
		return fmt.Errorf("HTTP proxy already running")
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
		Transport: retryTransport,
		// FlushInterval enables streaming responses and is required for WebSockets
		// and Server-Sent Events (SSE). Without this, responses are buffered.
		FlushInterval: -1, // Flush immediately (required for WebSockets)
		// ModifyResponse sets CORS headers on all successful responses
		// This enables cross-origin requests from the builder app to preview apps
		ModifyResponse: func(resp *http.Response) error {
			// Set CORS headers for cross-origin requests
			origin := resp.Request.Header.Get("Origin")
			setCORSHeadersOnHeader(resp.Header, origin, p.config.AllowedOrigins)
			return nil
		},
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

		// Set CORS headers for cross-origin requests
		SetCORSHeaders(w, r, p.config.AllowedOrigins)

		// Return appropriate status code with generic error message to avoid information disclosure
		// Use http.Error to avoid XSS vulnerability from fmt.Fprintf
		// Detailed error information is already logged above
		http.Error(w, http.StatusText(statusCode), statusCode)
	}

	// Load routing configuration (with error handling)
	routingConfig, err := p.loadRoutingConfig()
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

		router.staticHandler = newStaticFileHandler(staticRoot, routingConfig.CacheControl)

		if routingConfig.SPAMode {
			router.spaFallback = filepath.Join(staticRoot, "index.html")
		}
	}

	// Build middleware chain: logging -> JWT -> mux
	handler := http.Handler(mux)

	// Add JWT middleware if enabled
	if p.config.JWTEnabled {
		if p.config.JWKSUrl == "" {
			return fmt.Errorf("JWT authentication enabled but JWKS_URL not configured")
		}
		if p.config.SiteID == "" {
			return fmt.Errorf("JWT authentication enabled but SITE_ID not configured")
		}
		if p.config.JWTBuilderBaseURL == "" {
			return fmt.Errorf("JWT authentication enabled but DEV_SUPERVISOR_JWT_BUILDER_BASE_URL not configured")
		}

		// Create JWT validator
		validator := NewJWTValidator(JWTValidatorConfig{
			JWKSUrl:       p.config.JWKSUrl,
			SkipTLSVerify: p.config.JWKSSkipTLSVerify,
		})

		// Create JWT middleware (uses hybrid mode: redirects browsers, 401 for APIs)
		jwtMiddleware := NewJWTMiddleware(JWTMiddlewareConfig{
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

	// Wrap with logging middleware (outermost layer)
	// Pass procMgr for WebSocket connection tracking
	handler = loggingMiddleware(handler, p.procMgr)

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
		targetURL := fmt.Sprintf("http://%s:%d", p.config.TargetHost, p.config.TargetPort)
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
		return fmt.Errorf("target host cannot be empty")
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
 * This validation happens after loadRoutingConfig() so it can validate the merged configuration
 * (env vars + JSON config) rather than just env vars.
 *
 * @param routingConfig - The merged routing configuration to validate
 * @returns error if configuration is invalid
 */
func (p *HTTPProxy) validateStaticServingConfig(routingConfig RoutingConfig) error {
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
		return fmt.Errorf("static root must be specified when static serving is enabled (via DEV_SUPERVISOR_STATIC_ROOT env var or static_root in routing config)")
	}

	// Check if static root exists (warn but don't fail - directory may be created after startup)
	if _, err := os.Stat(staticRoot); os.IsNotExist(err) {
		slog.Warn("static root directory does not exist at startup, will be unavailable until created",
			"path", staticRoot)
	} else {
		// Only check index.html if directory exists and SPA mode is enabled
		if routingConfig.SPAMode {
			indexPath := filepath.Join(staticRoot, "index.html")
			if _, err := os.Stat(indexPath); os.IsNotExist(err) {
				slog.Warn("index.html not found in static root, SPA fallback may not work",
					"path", indexPath)
			}
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
 * newStaticFileHandler creates an http.Handler for serving static files with caching
 *
 * @param root - Root directory for static files
 * @param cacheSettings - Cache control settings for different file types
 * @returns http.Handler that serves static files with appropriate cache headers
 */
func newStaticFileHandler(root string, cacheSettings CacheSettings) http.Handler {
	fs := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ensure intermediaries cache distinct variants per negotiated encoding
		w.Header().Add("Vary", "Accept-Encoding")

		// Set cache headers based on file extension
		if cacheSettings.EnableCaching {
			ext := path.Ext(r.URL.Path)
			if maxAge, ok := cacheSettings.MaxAge[ext]; ok {
				w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
			}
		}

		fs.ServeHTTP(w, r)
	})
}

/**
 * loadRoutingConfig loads routing configuration from file or returns defaults
 *
 * @returns RoutingConfig with merged settings or error if file operations fail
 */
func (p *HTTPProxy) loadRoutingConfig() (RoutingConfig, error) {
	// Default config
	config := RoutingConfig{
		APIPrefix: "/api",
		SPAMode:   true,
		CacheControl: CacheSettings{
			EnableCaching: true,
			MaxAge: map[string]int{
				".js":    31536000, // 1 year (content-hashed)
				".css":   31536000,
				".woff2": 31536000,
				".png":   2592000, // 30 days
				".jpg":   2592000,
				".svg":   2592000,
				".html":  0, // Never cache (SPA shell)
				".json":  0,
			},
		},
	}

	// Apply environment variable overrides to defaults
	if p.config.APIPrefix != "" {
		config.APIPrefix = p.config.APIPrefix
	}
	if p.config.StaticRoot != "" {
		config.StaticRoot = p.config.StaticRoot
	}
	config.SPAMode = p.config.SPAMode

	// Load from JSON file if specified (JSON config takes precedence over env vars)
	if p.config.ConfigPath != "" {
		slog.Info("loading routing config from file", "path", p.config.ConfigPath)

		// Check if file exists
		if _, err := os.Stat(p.config.ConfigPath); os.IsNotExist(err) {
			return config, fmt.Errorf("routing config file not found: %s", p.config.ConfigPath)
		}

		// Read file
		data, err := os.ReadFile(p.config.ConfigPath)
		if err != nil {
			return config, fmt.Errorf("failed to read routing config file: %w", err)
		}

		// Unmarshal JSON using pointer struct to distinguish "not set" from "set to false/zero"
		var fileConfig routingConfigJSON
		if err := json.Unmarshal(data, &fileConfig); err != nil {
			return config, fmt.Errorf("failed to parse routing config JSON: %w", err)
		}

		// Merge file config with defaults (file config takes precedence)
		// Only override values that were explicitly set in JSON (non-nil pointers)
		if fileConfig.StaticRoot != nil && *fileConfig.StaticRoot != "" {
			config.StaticRoot = *fileConfig.StaticRoot
		}
		if fileConfig.APIPrefix != nil && *fileConfig.APIPrefix != "" {
			config.APIPrefix = *fileConfig.APIPrefix
		}
		if fileConfig.SPAMode != nil {
			config.SPAMode = *fileConfig.SPAMode
		}

		// Merge cache control settings
		if fileConfig.CacheControl != nil {
			// Copy EnableCaching only if explicitly set in JSON
			if fileConfig.CacheControl.EnableCaching != nil {
				config.CacheControl.EnableCaching = *fileConfig.CacheControl.EnableCaching
			}

			// Copy MaxAge only if explicitly set in JSON
			if fileConfig.CacheControl.MaxAge != nil {
				config.CacheControl.MaxAge = *fileConfig.CacheControl.MaxAge
			}
		} else if fileConfig.EnableCaching != nil {
			// Support deprecated top-level enable_caching for backward compatibility
			config.CacheControl.EnableCaching = *fileConfig.EnableCaching
		}

		if fileConfig.ForwardRules != nil {
			config.ForwardRules = fileConfig.ForwardRules
			slog.Warn("forward_rules are not yet implemented and will be ignored",
				"rule_count", len(fileConfig.ForwardRules))
		}

		slog.Info("routing config loaded successfully",
			"api_prefix", config.APIPrefix,
			"spa_mode", config.SPAMode)
	}

	return config, nil
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
 * @param w - Response writer
 * @param r - HTTP request
 */
func (p *HTTPProxy) handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	slog.Debug("proxy.health.check", "remote_addr", r.RemoteAddr)

	// Allow cross-origin health checks from the builder UI (e.g. local.gasket.dev-godaddy.com)
	// so client-side polling can determine when the preview app is ready.
	SetCORSHeaders(w, r, p.config.AllowedOrigins)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Set content type
	w.Header().Set("Content-Type", "application/json")

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

	// Perform HTTP GET to target with timeout
	targetURL := fmt.Sprintf("http://%s/", net.JoinHostPort(p.config.TargetHost, fmt.Sprintf("%d", p.config.TargetPort)))

	client := &http.Client{
		Timeout: 3 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			// Don't follow redirects, just accept them as healthy
			return http.ErrUseLastResponse
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
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

	// Check status code - 2xx and 3xx are healthy
	if httpResp.StatusCode >= 200 && httpResp.StatusCode < 400 {
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
