package main

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
	"strings"
	"sync"
	"time"
)

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
}

/**
 * HTTPProxy provides HTTP reverse proxy with TLS termination
 *
 * Responsibilities:
 * - HTTPS termination using provided TLS certificates
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
 * 2. Loads TLS certificates
 * 3. Creates reverse proxy to backend
 * 4. Starts HTTPS listener
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

	// Load TLS certificates
	tlsConfig, err := p.loadTLSConfig()
	if err != nil {
		return fmt.Errorf("failed to load TLS certificates: %w", err)
	}

	// Create reverse proxy to backend
	targetURL := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%d", p.config.TargetHost, p.config.TargetPort),
	}

	p.reverseProxy = httputil.NewSingleHostReverseProxy(targetURL)

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
	p.reverseProxy.Transport = &retryTransport{
		base:           baseTransport,
		maxRetries:     p.config.MaxRetries,
		initialBackoff: p.config.InitialBackoff,
		maxBackoff:     p.config.MaxBackoff,
	}

	// Customize proxy behavior
	originalDirector := p.reverseProxy.Director
	p.reverseProxy.Director = func(req *http.Request) {
		// Capture original host before originalDirector rewrites it
		originalHost := req.Host

		// Call original director (this will rewrite req.Host to backend)
		originalDirector(req)

		// Restore original host to preserve host-based logic in the app
		// This preserves the original Host header value for the proxied request
		req.Host = originalHost
		req.Header.Set("Host", originalHost)

		// Set X-Forwarded-Host header for additional context
		req.Header.Set("X-Forwarded-Host", originalHost)

		// Set forwarding headers
		if clientIP, _, splitErr := net.SplitHostPort(req.RemoteAddr); splitErr == nil {
			// Set X-Forwarded-For header
			if prior, ok := req.Header["X-Forwarded-For"]; ok {
				clientIP = prior[0] + ", " + clientIP
			}
			req.Header.Set("X-Forwarded-For", clientIP)
		}

		// Set X-Real-IP header
		if clientIP, _, splitErr := net.SplitHostPort(req.RemoteAddr); splitErr == nil {
			req.Header.Set("X-Real-IP", clientIP)
		}

		// Set X-Forwarded-Proto header
		if req.TLS != nil {
			req.Header.Set("X-Forwarded-Proto", "https")
		} else {
			req.Header.Set("X-Forwarded-Proto", "http")
		}

		slog.Debug("proxying request",
			"method", req.Method,
			"path", req.URL.Path,
			"host", originalHost,
			"target", targetURL.String(),
			"remote_addr", req.RemoteAddr)
	}

	// Custom error handler
	p.reverseProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		// Determine appropriate status code based on error type
		statusCode := http.StatusBadGateway
		statusText := "Bad Gateway"

		// Check if this is a connection error (backend not ready)
		if isRetryableError(err) {
			// 503 Service Unavailable - backend is starting up or temporarily unavailable
			statusCode = http.StatusServiceUnavailable
			statusText = "Service Unavailable"

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

		// Return appropriate status code
		// Use http.Error to avoid XSS vulnerability from fmt.Fprintf
		errorMsg := fmt.Sprintf("%d %s: %v", statusCode, statusText, err)
		http.Error(w, errorMsg, statusCode)
	}

	// Create HTTP server with reverse proxy handler
	p.server = &http.Server{
		Handler:      p.reverseProxy,
		TLSConfig:    tlsConfig,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Create TLS listener
	listenAddr := fmt.Sprintf(":%d", p.config.ListenPort)
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to create listener on port %d: %w", p.config.ListenPort, err)
	}

	// Wrap with TLS
	tlsListener := tls.NewListener(listener, tlsConfig)
	p.listener = tlsListener
	p.running = true
	p.startTime = time.Now()

	actualAddr := p.listener.Addr().String()
	slog.Info("HTTP proxy started",
		"listen_addr", actualAddr,
		"target_url", targetURL.String(),
		"tls_cert", p.config.TLSCertPath)

	// Start serving in background
	go func() {
		if err := p.server.Serve(tlsListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
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

	if p.config.TLSCertPath == "" {
		return fmt.Errorf("TLS certificate path cannot be empty")
	}

	if p.config.TLSKeyPath == "" {
		return fmt.Errorf("TLS key path cannot be empty")
	}

	// Validate cert and key files exist and are readable
	if _, err := os.Stat(p.config.TLSCertPath); os.IsNotExist(err) {
		return fmt.Errorf("TLS certificate file not found: %s", p.config.TLSCertPath)
	}

	if _, err := os.Stat(p.config.TLSKeyPath); os.IsNotExist(err) {
		return fmt.Errorf("TLS key file not found: %s", p.config.TLSKeyPath)
	}

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
