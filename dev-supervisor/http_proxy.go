package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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
	StaticRoot          string // Root directory for static files (required if EnableStaticServing=true)
	EnableStaticServing bool   // Enable static file serving (explicit, default: false)
	SPAMode             bool   // Enable SPA fallback (default: true when static serving enabled)
	APIPrefix           string // API route prefix (default: "/api")
	ConfigPath          string // Optional path to routing config file
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
	mu           sync.RWMutex
	config       HTTPProxyConfig
	server       *http.Server
	listener     net.Listener
	running      bool
	reverseProxy *httputil.ReverseProxy
	startTime    time.Time
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
 * responseWriter wraps http.ResponseWriter to capture status code and response size
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

/**
 * RequestRouter handles HTTP request routing based on configuration
 * Routes requests to static file handler, SPA fallback, or backend proxy
 */
type RequestRouter struct {
	staticHandler    http.Handler
	proxyHandler     http.Handler
	spaFallback      string
	apiPrefix        string
	isProductionMode bool
}

func (rr *RequestRouter) writeStaticOptionsResponse(w http.ResponseWriter, r *http.Request) {
	// Dev-supervisor only listens on the internal loopback interface and sits behind
	// a trusted proxy in production, so we simply echo the Origin when provided.
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	} else {
		w.Header().Add("Vary", "Origin")
	}

	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	if reqHeaders := r.Header.Get("Access-Control-Request-Headers"); reqHeaders != "" {
		w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
	}

	w.Header().Set("Allow", "GET, HEAD, OPTIONS")
	w.WriteHeader(http.StatusNoContent)
}

/**
 * loggingMiddleware wraps an http.Handler to log requests with response details
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
		slog.Info("http.request",
			"type", "http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.statusCode,
			"size", rw.size,
			"duration_ms", duration.Milliseconds(),
			"remote_addr", r.RemoteAddr,
		)
	})
}

/**
 * ServeHTTP implements http.Handler interface for RequestRouter
 * Routes requests based on path, method, and configuration
 */
func (rr *RequestRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1. API routes - always proxy to backend
	if strings.HasPrefix(r.URL.Path, rr.apiPrefix) {
		slog.Debug("routing to API backend", "path", r.URL.Path)
		rr.proxyHandler.ServeHTTP(w, r)
		return
	}

	// 2. Static serving disabled - proxy everything else to backend
	if !rr.isProductionMode {
		slog.Debug("proxying to backend (static serving disabled)", "path", r.URL.Path)
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
				for k, v := range recorder.Header() {
					w.Header()[k] = v
				}

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

			// Copy X-Forwarded-For unchanged from incoming request (if present)
			// By default, ReverseProxy removes X-Forwarded-* headers, so we explicitly copy it
			if xff := r.In.Header.Get("X-Forwarded-For"); xff != "" {
				r.Out.Header["X-Forwarded-For"] = []string{xff}
			}

			// Set X-Forwarded-Proto based on upstream input or actual scheme
			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))

			// Note: X-Forwarded-Host is not set (Host header is already correct)
			// Note: X-Real-IP is not set (only accessible by trusted sources)

			slog.Debug("proxying request",
				"method", r.In.Method,
				"path", r.In.URL.Path,
				"host", r.In.Host,
				"target", targetURL.String(),
				"remote_addr", r.In.RemoteAddr)
		},
		Transport: retryTransport,
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

	// Create request router
	router := &RequestRouter{
		proxyHandler:     p.reverseProxy,
		apiPrefix:        routingConfig.APIPrefix,
		isProductionMode: p.config.EnableStaticServing,
	}

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

	// Wrap router with logging middleware
	handler := loggingMiddleware(router)

	// Create HTTP server with router (instead of reverse proxy directly)
	p.server = &http.Server{
		Handler:      handler,
		TLSConfig:    tlsConfig,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
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
