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
	"golang.org/x/net/netutil"

	"github.com/airo-ai-builder/dev-supervisor/internal/auth"
	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing"
	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
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
	// signer is the JWS Signer used by /airo/jws-debug to produce a
	// dry-run signing preview. nil when JWS_PRIVATE_KEY_PATH is unset
	// — the debug handler then surfaces "signing disabled" so the
	// operator can tell the difference between "feature off" and
	// "keys missing." Wired by SetSigner from main.go after Load().
	signer *signing.Signer
	// idpMiddleware handles IDP OAuth Authorization Code flow for enterprise
	// published apps. The middleware lazy-loads auth.json on every request
	// via its embedded SecretsLoader (TTL-cached), so it works correctly when
	// dev-supervisor PID 1 starts BEFORE the hosting secrets-tar extracts
	// /alloc/auth.json — the file appearing at second N takes effect on the
	// next request, no container restart.
	//
	// Always wired (not gated on auth.json existence at boot). When auth.json
	// is missing or ssoRequired=false, the middleware is a passthrough.
	idpMiddleware *auth.IDPAuthMiddleware
}

// SetSigner installs the JWS signer the /airo/jws-debug endpoint
// uses to produce a dry-run signing preview. nil signer is allowed
// (matches the SignMessage no-op contract) — the debug endpoint
// will surface signing_enabled=false in that case so operators can
// tell key-not-loaded apart from feature-flag-off.
//
// Must be called before Start(); the registered handler captures the
// HTTPProxy receiver and reads p.signer at request time. Wiring after
// Start would race with handler registration on the mux.
func (p *HTTPProxy) SetSigner(s *signing.Signer) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.signer = s
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
		// ResponseHeaderTimeout caps how long we wait for the backend to send
		// response headers. Without it, a wedged app (e.g. a handler stuck in a
		// retry loop) holds the proxied connection open indefinitely, letting a
		// modest request rate balloon into tens of thousands of stuck sockets.
		// The resulting "timeout awaiting response headers" error is NOT matched
		// by isRetryableError, so it returns 502 without triggering the retry
		// loop. It does not affect WebSocket/SSE body streaming, since those
		// headers (101/200) arrive promptly before the long-lived stream begins.
		// 0 disables the timeout.
		ResponseHeaderTimeout: p.config.ResponseHeaderTimeout,
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

	// Determine API prefix (default: /api)
	apiPrefix := p.config.APIPrefix
	if apiPrefix == "" {
		apiPrefix = "/api"
	}

	// Create HTTP server mux
	mux := http.NewServeMux()

	// Add health check endpoint (unauthenticated, always available)
	mux.HandleFunc("/airo/health", handlerWithName("health", p.handleHealthCheck))

	// Add canary checks endpoint for infrastructure verification
	mux.HandleFunc("/airo/canary_checks", handlerWithName("health", handleCanaryChecks))

	// Storage Access bootstrap (unauthenticated — in JWT_EXCLUDED_PATHS).
	// Loaded inside the preview iframe when the cross-site preview_auth cookie
	// is blocked by Safari ITP; calls document.requestStorageAccess() from a
	// user gesture, then redirects into the authenticated app. Must be
	// excluded because the broken state is "no usable credential present".
	mux.HandleFunc("/airo/storage-access", handlerWithName("storage-access", handleStorageAccess))

	// Add auth-check endpoint (behind JWT middleware - NOT excluded)
	// Used by builder to verify cookie was stored after auth bootstrap
	mux.HandleFunc("/airo/auth-check", handlerWithName("auth-check", handleAuthCheck))

	// IDP OAuth callback endpoint (excluded from middleware enforcement —
	// the user isn't authenticated yet by definition). Handles the redirect
	// back from the IDP carrying ?code=&state=. The OAuth handler is
	// resolved lazily from the middleware's secrets loader, so this route
	// works whether or not auth.json was present when dev-supervisor booted.
	mux.HandleFunc(
		"/airo/idp/callback",
		handlerWithName("idp-callback", p.handleIDPCallback),
	)

	// Email test-send proxy. Inert by default — returns 404 when
	// DEV_SUPERVISOR_SIGN_DEBUG_ENABLED != "true" so a misconfigured
	// alloc never exposes the proxy path. Forwards the request body
	// verbatim to the existing http://localhost:2525/api/email/send
	// gateway (the same handler customer apps call via nodemailer).
	// The response includes the upstream send result PLUS a flag
	// telling the caller whether JWS signing was active when the
	// gateway processed the message — read from the wired-in signer
	// at request time. Used to confirm signing fires end-to-end on a
	// cell where the customer-domain attach flow can't be exercised.
	//
	// Behind JWT middleware (not in JWT_EXCLUDED_PATHS). The BFF wraps
	// this behind switchboard `appbuilder-jws-signing-debug` for
	// operator-facing flag control.
	//
	// See airo-app-builder/docs/jws-email-signing.md §8 for the full
	// debug-API spec and gate ladder.
	mux.HandleFunc("/airo/email/test-send", handlerWithName("email-test-send", p.handleEmailTestSend))

	// Add media slot handlers - use app directory for manifest (not static root)
	// The manifest is written to the app root by the agents service, not to the build output
	appDir := os.Getenv("CUSTOMER_APP_DIR")
	if appDir == "" {
		appDir = "/app" // Default app directory in container
	}

	// Shared storage directory (future CephFS mount in production)
	// PersistentAssetsHandler serves static files like Vite's express.static(publicDir)
	sharedStorageDir := os.Getenv("SHARED_STORAGE_DIR")
	var persistentDir string
	if sharedStorageDir != "" {
		// Shared storage layout: serve from {SHARED_STORAGE_DIR}/public
		// Files at /shared-storage/public/assets/foo.png serve as /assets/foo.png
		persistentDir = filepath.Join(sharedStorageDir, "public")
	} else {
		// V4 default: serve from /app/public (Vite static root)
		// Files at /app/public/assets/foo.png serve as /assets/foo.png
		// Note: persistent storage is bind-mounted at /app/public/assets, so they overlay
		persistentDir = filepath.Join(appDir, "public")
	}

	// Define media search paths for all handlers - single source of truth.
	mediaSearchPaths := buildMediaSearchPaths(appDir, sharedStorageDir)

	// Manifest paths - check multiple locations for different deployment modes:
	// - Preview mode: {appDir}/airo-media.json (agents write here directly)
	// - Publish mode: {appDir}/dist/airo-media.json (copied into dist/ during archive creation)
	manifestPath := filepath.Join(appDir, "airo-media.json")
	manifestFallbackPath := filepath.Join(appDir, "dist", "airo-media.json")
	mediaSlotCache := NewManifestCache(manifestPath, manifestFallbackPath)
	mux.Handle("/airo-assets/images/", NewImageSlotHandler(mediaSlotCache, mediaSearchPaths))
	mux.Handle("/airo-assets/videos/", NewVideoSlotHandler(mediaSlotCache, mediaSearchPaths))
	slog.Debug("media_slot.handlers_registered",
		"manifest_path", manifestPath,
		"manifest_fallback", manifestFallbackPath)

	// Add uploaded media handler - uses same search paths
	uploadedMediaHandler := NewUploadedMediaHandler(mediaSearchPaths)
	mux.Handle(uploadedMediaPrefix, uploadedMediaHandler)
	slog.Debug("uploaded_media.handler_registered",
		"prefix", uploadedMediaPrefix,
		"search_paths", mediaSearchPaths)

	// Add catch-all for /airo/* that returns 404 for unmatched paths
	// This MUST come after specific /airo/* handlers but before the / catch-all
	mux.HandleFunc("/airo/", handlerWithName("not_found", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))

	// Persistent assets handler — serves /assets/* from CephFS mount,
	// falling through to proxy (Vite) on miss.
	persistentAssetsHandler := NewPersistentAssetsHandler(persistentDir, p.reverseProxy)
	mux.Handle("/assets/", persistentAssetsHandler)
	slog.Debug("persistent_assets.handler_registered",
		"persistent_dir", persistentDir)

	// Create request router
	router := &RequestRouter{
		proxyHandler:          p.reverseProxy,
		apiPrefix:             apiPrefix,
		allowedOrigins:        p.config.AllowedOrigins,
		procMgr:               p.procMgr,
		startOnRequestEnabled: p.startOnRequestEnabled,
		backendAddr:           targetURL.Host, // host:port for TCP readiness probes
	}

	// Route all other requests to the router
	mux.Handle("/", router)

	// Build middleware chain (outermost to innermost):
	// logging -> responseHeaders -> CORS -> method validation -> JWT -> connection tracking -> activity -> router
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

	// Edge-auth mode selection. JWT is for preview containers (builder
	// customer JWT); IDP OAuth is for published enterprise apps (end-user
	// SSO at the customer's IdP). The two modes are mutually exclusive by
	// container type — physically different Nomad tasks — and the wiring
	// below enforces that exclusivity using the canonical preview signal
	// already used elsewhere in this repo (`config.ShouldStartSMTPProxy`,
	// `allocconfig/migrate.go`): NOMAD_TASK_NAME == "preview" → JWT only,
	// IDP skipped; otherwise → IDP wired. The previous boot-time
	// os.Stat-on-auth.json guard false-positived when a preview alloc
	// happened to ship a stale or unrelated file; the task-name gate
	// replaces it without that brittleness.
	authSecretsPath := auth.DefaultAuthSecretsPath()
	isPreviewTask := os.Getenv("NOMAD_TASK_NAME") == config.PreviewTaskName

	// JWT middleware (if enabled)
	if p.config.JWTEnabled {
		if p.config.JWKSUrl == "" {
			return errors.New("JWT authentication enabled but JWKS_URL not configured")
		}
		if p.config.SiteID == "" {
			return errors.New("JWT authentication enabled but SITE_ID not configured")
		}
		// Note: JWT_REDIRECT_URL is read from /alloc/config.json at runtime, not validated at startup

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

		// Create JWT middleware (uses hybrid mode: redirects browsers to builder, 401 for APIs)
		jwtMiddleware := auth.NewJWTMiddleware(auth.JWTMiddlewareConfig{
			Enabled:        true,
			Validator:      validator,
			ShareValidator: shareValidator,
			SiteID:         p.config.SiteID,
			ExcludedPaths:  p.config.JWTExcludedPaths,
			APIPrefix:      apiPrefix,
			AllowedOrigins: p.config.AllowedOrigins,
		})

		// Wrap handler with JWT middleware
		handler = jwtMiddleware.Wrap(handler)

		slog.Info("JWT authentication enabled (hybrid mode)",
			"jwksURL", p.config.JWKSUrl,
			"excludedPaths", p.config.JWTExcludedPaths)
	}

	// IDP OAuth authentication middleware (for published enterprise apps).
	// Skipped entirely on preview tasks — JWT and IDP are mutually
	// exclusive by container type, enforced here so a preview alloc that
	// happens to ship an auth.json never activates the IDP path.
	//
	// When wired, the middleware lazy-loads auth.json on every request
	// via its SecretsLoader (TTL-cached). When the file is absent or
	// ssoRequired=false the middleware is a passthrough; only when the
	// cache row says ssoRequired=true does enforcement activate. This
	// closes the boot-time race where dev-supervisor (PID 1) starts
	// before the hosting secrets-tar extracts /alloc/auth.json — the
	// file appearing at second N takes effect on the next request, no
	// container restart required.
	if !isPreviewTask {
		idpLoader := auth.NewSecretsLoader(authSecretsPath)
		p.idpMiddleware = auth.NewIDPAuthMiddleware(auth.IDPAuthMiddlewareConfig{
			Enabled:       true,
			AuthLoader:    idpLoader,
			ExcludedPaths: p.config.JWTExcludedPaths,
		})
		handler = p.idpMiddleware.Wrap(handler)
		slog.Info("IDP OAuth middleware wired (lazy)",
			"path", authSecretsPath,
			"excludedPaths", p.config.JWTExcludedPaths)
	} else {
		slog.Info("IDP OAuth middleware skipped (preview task)",
			"reason", "JWT and IDP are mutually exclusive by container type")
	}

	// Per-IP concurrency limiting. Placed OUTSIDE JWT (wraps the JWT handler, so
	// it runs first) to reject abusive IPs before spending JWKS signature
	// verification on them, but INSIDE method-validation/CORS so the 429 still
	// gets CORS headers. Health/canary probes (JWTExcludedPaths) bypass it.
	// 0 disables the layer.
	if p.config.MaxConnsPerIP > 0 {
		ipLimiter := middleware.NewIPConnLimiter(p.config.MaxConnsPerIP, p.config.JWTExcludedPaths, rateLimitKey)
		handler = ipLimiter.Wrap(handler)
		slog.Info("per-IP connection limiting enabled",
			"max_conns_per_ip", p.config.MaxConnsPerIP,
			"excluded_paths", p.config.JWTExcludedPaths)
	}

	// Status-page fallback middleware. When p.config.StatusPage.Active(),
	// the cached "Coming Soon" / "Suspended" HTML is served in place of
	// the proxy chain (and child app). /airo/health and /airo/canary_checks
	// bypass this so infra/load-balancer probes keep working.
	// Placed inside MethodValidation but outside JWT so status pages
	// remain reachable without authentication.
	handler = statusPageMiddleware(p.config.StatusPage)(handler)

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

	// Response headers middleware (injects X-Product-Id and other custom headers)
	handler = responseHeadersMiddleware(handler)

	// Logging middleware (outermost layer)
	// Logs all requests with response details
	handler = loggingMiddleware(handler)

	// Create HTTP server with middleware-wrapped handler
	p.server = &http.Server{
		Handler:     handler,
		TLSConfig:   tlsConfig,
		ReadTimeout: 30 * time.Second,
		// ReadHeaderTimeout guards against slow-loris clients that dribble
		// request headers to hold connections open. 0 disables it.
		ReadHeaderTimeout: p.config.ReadHeaderTimeout,
		// WriteTimeout intentionally omitted - would break WebSockets and SSE
		// WebSocket and SSE connections are long-lived and can't have write timeouts
		IdleTimeout: 120 * time.Second,
	}

	// Bound request header size to blunt header-stuffing abuse.
	// <=0 leaves net/http's default (1 MiB).
	if p.config.MaxHeaderBytes > 0 {
		p.server.MaxHeaderBytes = p.config.MaxHeaderBytes
	}

	// Create listener (TLS or plain HTTP)
	listenAddr := fmt.Sprintf(":%d", p.config.ListenPort)
	//nolint:noctx // Long-lived server listener, no request context available
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to create listener on port %d: %w", p.config.ListenPort, err)
	}

	// Cap concurrent accepted connections. Wrapping the RAW TCP listener (before
	// tls.NewListener) means the cap also bounds concurrent TLS handshakes - the
	// expensive per-connection work - not just post-handshake connections. This
	// prevents a flood from exhausting CPU/file descriptors. 0 = unlimited.
	//
	// Note: the cap counts every accepted connection, including idle HTTP
	// keep-alive sockets between requests (server IdleTimeout is 120s). A small
	// set of clients holding many idle keep-alives therefore consumes slots; the
	// per-IP limiter and IdleTimeout bound that, but tune MaxConnections with the
	// keep-alive population in mind, not just the active-request count.
	if p.config.MaxConnections > 0 {
		listener = netutil.LimitListener(listener, p.config.MaxConnections)
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
			"tls_cert", p.config.TLSCertPath,
			"max_connections", p.config.MaxConnections)
	} else {
		slog.Info("HTTP proxy started without TLS",
			"listen_addr", actualAddr,
			"target_url", targetURL.String(),
			"max_connections", p.config.MaxConnections)
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

// handleIDPCallback proxies the OAuth callback to the IDP handler.
// The handler is resolved lazily from the middleware so the route works
// even when auth.json wasn't present at dev-supervisor boot. Returns
// 503 when SSO is not required for the app, when auth.json isn't on
// disk yet, or when the OAuth handler cannot be constructed.
func (p *HTTPProxy) handleIDPCallback(w http.ResponseWriter, r *http.Request) {
	if p.idpMiddleware == nil {
		http.Error(w, "IDP OAuth not configured", http.StatusServiceUnavailable)
		return
	}
	oauthHandler, err := p.idpMiddleware.GetOAuthHandler()
	if err != nil {
		slog.WarnContext(r.Context(), "idp.callback.handler_unavailable",
			"error", err.Error())
		http.Error(w, "Service Unavailable", http.StatusServiceUnavailable)
		return
	}
	oauthHandler.HandleCallback(w, r)
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
