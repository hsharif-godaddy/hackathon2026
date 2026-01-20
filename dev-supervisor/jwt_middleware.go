package main

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
)

/**
 * JWTMiddlewareConfig defines configuration for JWT middleware
 *
 * Authentication failure handling uses hybrid mode:
 * - Browser requests (text/html): Redirect to SSO login page
 * - API/JSON requests: Return 401 Unauthorized with JSON error
 */
type JWTMiddlewareConfig struct {
	Enabled        bool // Enable JWT validation
	Validator      *JWTValidator
	RedirectURL    string   // URL to redirect to on auth failure (supports {url} placeholder)
	BuilderBaseURL string   // Builder app base URL for smart redirects (e.g., https://airo-builder.test-godaddy.com)
	SiteID         string   // Site ID for smart redirects (from SITE_ID env var, e.g., "41gb5nrnyl" or UUID)
	ExcludedPaths  []string // Paths to exclude from JWT validation (e.g., /health, /api/health)
	APIPrefix      string   // API route prefix for hybrid mode (default: /api)
	AllowedOrigins []string // CORS allowed origins (whitelist)
}

/**
 * JWTMiddleware wraps HTTP handlers with JWT authentication
 */
type JWTMiddleware struct {
	config JWTMiddlewareConfig
}

/**
 * NewJWTMiddleware creates a new JWT middleware
 *
 * @param config - Middleware configuration
 * @returns Initialized JWTMiddleware
 */
func NewJWTMiddleware(config JWTMiddlewareConfig) *JWTMiddleware {
	// Set defaults
	if config.APIPrefix == "" {
		config.APIPrefix = "/api"
	}

	return &JWTMiddleware{
		config: config,
	}
}

/**
 * Wrap wraps an http.Handler with JWT authentication
 *
 * @param next - Next handler in the chain
 * @returns Wrapped handler
 */
func (m *JWTMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip if JWT validation is disabled
		if !m.config.Enabled {
			next.ServeHTTP(w, r)
			return
		}

		// Handle OPTIONS preflight requests without authentication
		// Preflight requests don't carry Authorization headers by design
		if r.Method == "OPTIONS" {
			slog.Debug("jwt.middleware.preflight", "path", r.URL.Path)
			SetCORSHeaders(w, r, m.config.AllowedOrigins)
			w.Header().Set("Access-Control-Max-Age", "86400") // Cache preflight for 24 hours
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Check if path is excluded from validation
		if m.isPathExcluded(r.URL.Path) {
			slog.Debug("jwt.middleware.path_excluded", "path", r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}

		// Extract token from Authorization header or cookie
		authHeader := r.Header.Get("Authorization")
		token := ExtractTokenFromHeader(authHeader)

		// Fallback to cookie if no Authorization header (for iframe navigation)
		// GoDaddy SSO uses "auth_idp" cookie name
		if token == "" {
			if cookie, err := r.Cookie("auth_idp"); err == nil && cookie.Value != "" {
				token = cookie.Value
				slog.Debug("jwt.middleware.token_from_cookie", "path", r.URL.Path)
			}
		}

		if token == "" {
			slog.Debug("jwt.middleware.no_token", "path", r.URL.Path, "remoteAddr", r.RemoteAddr)
			m.handleAuthFailure(w, r, "missing authorization token")
			return
		}

		// Validate token
		result := m.config.Validator.ValidateToken(token)
		if !result.Valid {
			slog.Warn("jwt.middleware.validation_failed",
				"path", r.URL.Path,
				"remoteAddr", r.RemoteAddr,
				"reason", result.Reason)
			m.handleAuthFailure(w, r, result.Reason)
			return
		}

		// Validate siteId claim matches SITE_ID (authorization check)
		// This prevents authorization bypass where a valid JWT for site A
		// could be used to access site B
		if m.config.SiteID != "" && result.Claims != nil {
			if result.Claims.SiteID != m.config.SiteID {
				slog.Warn("jwt.middleware.siteid_mismatch",
					"path", r.URL.Path,
					"remoteAddr", r.RemoteAddr,
					"expectedSiteID", m.config.SiteID,
					"actualSiteID", result.Claims.SiteID)
				m.handleAuthFailure(w, r, "token not valid for this site")
				return
			}
		}

		// Token is valid - authentication and authorization successful
		slog.Debug("jwt.middleware.authorized",
			"path", r.URL.Path,
			"siteID", result.Claims.SiteID)

		// Set cookie on localhost domain for iframe navigation
		// The GoDaddy SSO auth_idp cookie is on .dev-godaddy.com and won't be sent to localhost
		// So we need to set a cookie on the preview app's domain when valid auth is received
		if authHeader != "" {
			// Only set cookie if token came from Authorization header (not from cookie itself to avoid loops)
			// SameSite=None is required for cross-site iframe loads (builder on .dev-godaddy.com, preview on localhost)
			http.SetCookie(w, &http.Cookie{
				Name:     "auth_idp",
				Value:    token,
				Path:     "/",
				HttpOnly: true,
				Secure:   true,
				SameSite: http.SameSiteNoneMode, // None required for cross-site iframe navigation
				MaxAge:   43200,                 // 12 hours (typical JWT expiry)
			})
		}

		// Continue to next handler
		next.ServeHTTP(w, r)
	})
}

/**
 * handleAuthFailure handles authentication failures using hybrid mode
 *
 * Hybrid mode behavior:
 * - Browser requests (Accept: text/html): Redirect to SSO login page
 * - API/JSON requests: Return 401 Unauthorized with JSON error
 *
 * @param w - Response writer
 * @param r - HTTP request
 * @param reason - Reason for auth failure
 */
func (m *JWTMiddleware) handleAuthFailure(w http.ResponseWriter, r *http.Request, reason string) {
	// Hybrid mode: redirect browsers, return 401 for APIs
	if m.isAPIOrJSONRequest(r) {
		m.returnError(w, r, reason)
	} else {
		m.redirect(w, r, reason)
	}
}

/**
 * returnError returns a 401 Unauthorized error
 *
 * @param w - Response writer
 * @param r - HTTP request
 * @param reason - Reason for auth failure
 */
func (m *JWTMiddleware) returnError(w http.ResponseWriter, r *http.Request, reason string) {
	slog.Info("jwt.middleware.returning_401",
		"path", r.URL.Path,
		"reason", reason)

	// Set CORS headers for cross-origin requests
	// Dev-supervisor only listens on internal loopback and sits behind a trusted proxy,
	// so we echo the Origin header when provided (same pattern as static file handler)
	m.setCORSHeaders(w, r)

	w.Header().Set("WWW-Authenticate", "Bearer")
	http.Error(w, "Unauthorized", http.StatusUnauthorized)
}

/**
 * redirect redirects to configured login page
 *
 * @param w - Response writer
 * @param r - HTTP request
 * @param reason - Reason for auth failure
 */
func (m *JWTMiddleware) redirect(w http.ResponseWriter, r *http.Request, reason string) {
	redirectURL := m.config.RedirectURL

	// Fallback to 401 if no redirect URL configured
	if redirectURL == "" {
		slog.Warn("jwt.middleware.no_redirect_url",
			"path", r.URL.Path,
			"reason", reason)
		m.returnError(w, r, reason)
		return
	}

	// Build the current URL (for return_to parameter)
	currentURL := r.URL.String()
	if r.TLS != nil {
		currentURL = "https://" + r.Host + currentURL
	} else {
		// Check X-Forwarded-Proto header
		if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" {
			currentURL = "https://" + r.Host + currentURL
		} else {
			currentURL = "http://" + r.Host + currentURL
		}
	}

	// Smart redirect: If this is a preview app, redirect to builder with specific app
	// Works for both localhost:5001 and 41gb5nrnyl.preview.c4.test-airoapp.ai
	// Builder URL format: https://airo-builder.{env}-godaddy.com/develop/{appId}?siteId={appId}
	smartURL := m.buildSmartRedirectURL()
	if smartURL != "" {
		currentURL = smartURL
		slog.Info("jwt.middleware.smart_redirect",
			"originalHost", r.Host,
			"smartURL", smartURL)
	}

	// Replace {url} placeholder with URL-encoded current URL (or smart URL)
	redirectURL = strings.ReplaceAll(redirectURL, "{url}", url.QueryEscape(currentURL))

	// Validate redirect URL to prevent open redirect vulnerability
	parsedURL, err := url.Parse(redirectURL)
	if err != nil {
		slog.Warn("jwt.middleware.invalid_redirect_url",
			"url", redirectURL,
			"error", err.Error())
		m.returnError(w, r, reason)
		return
	}

	// Only allow https:// scheme for security
	if parsedURL.Scheme != "https" {
		slog.Warn("jwt.middleware.insecure_redirect_scheme",
			"url", redirectURL,
			"scheme", parsedURL.Scheme)
		m.returnError(w, r, reason)
		return
	}

	// Validate that the redirect host is allowed
	if !m.isAllowedRedirectHost(parsedURL.Host) {
		slog.Warn("jwt.middleware.untrusted_redirect_host",
			"url", redirectURL,
			"host", parsedURL.Host)
		m.returnError(w, r, reason)
		return
	}

	slog.Info("jwt.middleware.redirecting",
		"path", r.URL.Path,
		"reason", reason,
		"redirectURL", redirectURL)

	// Set CORS headers for cross-origin requests before redirect
	m.setCORSHeaders(w, r)

	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

/**
 * buildSmartRedirectURL builds a smart redirect URL for preview app access
 *
 * When users access preview apps directly, we want to redirect them to the builder
 * with that specific app open, not just the homepage.
 *
 * Works for both:
 * - localhost:5001 (local development) - SITE_ID from docker-compose
 * - 41gb5nrnyl.c4.test-airoapp.ai (production) - SITE_ID from deployment config
 *
 * Builder URL format:
 * - https://airo-builder.{env}-godaddy.com/develop/{siteId}?siteId={siteId}
 *
 * @returns Smart redirect URL or empty string if SITE_ID not configured
 */
func (m *JWTMiddleware) buildSmartRedirectURL() string {
	// Use SITE_ID from environment (set by docker-compose or production deployment)
	siteID := m.config.SiteID
	if siteID == "" {
		slog.Debug("jwt.middleware.smart_redirect.no_site_id",
			"message", "SITE_ID not configured, using default redirect")
		return ""
	}

	// Check if builder base URL is configured
	if m.config.BuilderBaseURL == "" {
		slog.Warn("jwt.middleware.smart_redirect.no_builder_url",
			"message", "BuilderBaseURL not configured, cannot build smart redirect")
		return ""
	}

	// Parse builder base URL
	builderBaseURL, err := url.Parse(m.config.BuilderBaseURL)
	if err != nil {
		slog.Warn("jwt.middleware.smart_redirect.parse_error",
			"builderBaseURL", m.config.BuilderBaseURL,
			"error", err.Error())
		return ""
	}

	// Build the smart redirect URL with URL-encoded siteID
	// Format: https://airo-builder.{env}-godaddy.com/develop/{siteId}?siteId={siteId}
	escapedSiteID := url.QueryEscape(siteID)
	smartURL := fmt.Sprintf("%s://%s/develop/%s?siteId=%s",
		builderBaseURL.Scheme,
		builderBaseURL.Host,
		escapedSiteID,
		escapedSiteID)

	return smartURL
}

/**
 * isAllowedRedirectHost validates if a host is allowed for redirects
 * Prevents open redirect vulnerabilities by checking against configured redirect URL
 *
 * @param host - Host to validate
 * @returns true if host is allowed
 */
func (m *JWTMiddleware) isAllowedRedirectHost(host string) bool {
	// Parse the configured redirect URL to get the base host
	configuredURL, err := url.Parse(m.config.RedirectURL)
	if err != nil {
		return false
	}

	// Extract host without port for comparison
	configuredHost := configuredURL.Hostname()
	testHost := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		testHost = h
	}

	// Allow exact match
	if testHost == configuredHost {
		return true
	}

	// Allow subdomains of the configured host (e.g., app.airo.ai allows *.airo.ai)
	if strings.HasSuffix(testHost, "."+configuredHost) {
		return true
	}

	return false
}

/**
 * isAPIOrJSONRequest checks if the request is an API or JSON request
 * Used in hybrid mode to determine whether to redirect or return 401
 *
 * @param r - HTTP request
 * @returns true if this is an API/JSON request
 */
func (m *JWTMiddleware) isAPIOrJSONRequest(r *http.Request) bool {
	// Check if path starts with API prefix
	if strings.HasPrefix(r.URL.Path, m.config.APIPrefix) {
		return true
	}

	// Check Accept header for JSON preference
	accept := r.Header.Get("Accept")
	if strings.Contains(accept, "application/json") {
		return true
	}

	// Check Content-Type for JSON
	contentType := r.Header.Get("Content-Type")
	return strings.Contains(contentType, "application/json")
}

/**
 * isPathExcluded checks if a path should be excluded from JWT validation
 *
 * @param path - Request path
 * @returns true if path is excluded
 */
func (m *JWTMiddleware) isPathExcluded(path string) bool {
	for _, excluded := range m.config.ExcludedPaths {
		// Exclude exact path matches
		if path == excluded {
			return true
		}

		// For directory-style exclusions (ending with "/"), use prefix matching.
		// This avoids unintentionally excluding paths like "/healthcheck" when
		// only "/health" is configured as an excluded path.
		if strings.HasSuffix(excluded, "/") && strings.HasPrefix(path, excluded) {
			return true
		}
	}
	return false
}

/**
 * setCORSHeaders sets CORS headers for cross-origin requests with origin validation
 *
 * @param w - Response writer
 * @param r - HTTP request
 */
func (m *JWTMiddleware) setCORSHeaders(w http.ResponseWriter, r *http.Request) {
	SetCORSHeaders(w, r, m.config.AllowedOrigins)
}

/**
 * isOriginAllowed checks if an origin is allowed based on whitelist
 *
 * @param origin - Origin header value
 * @param allowedOrigins - Whitelist of allowed origins (empty = allow all)
 * @returns true if origin is allowed, false otherwise
 */
func isOriginAllowed(origin string, allowedOrigins []string) bool {
	// If no whitelist configured, allow all
	if len(allowedOrigins) == 0 {
		return true
	}

	// Check if origin is in whitelist
	for _, allowedOrigin := range allowedOrigins {
		if origin == allowedOrigin {
			return true
		}
	}

	return false
}

/**
 * setCORSHeadersOnHeader sets CORS headers directly on an http.Header
 *
 * @param header - Response header to modify
 * @param origin - Origin header value from request
 * @param allowedOrigins - Whitelist of allowed origins (empty = allow all)
 */
func setCORSHeadersOnHeader(header http.Header, origin string, allowedOrigins []string) {
	// Only set CORS headers (or log) for actual cross-origin browser requests.
	// If Origin is empty, the request is not a CORS request.
	if origin == "" {
		return
	}

	// Validate origin against whitelist
	if !isOriginAllowed(origin, allowedOrigins) {
		// Origin not in whitelist - don't set CORS headers
		slog.Debug("cors.origin.rejected", "origin", origin)
		return
	}

	// Set CORS headers
	if len(allowedOrigins) > 0 {
		// Whitelist mode - echo the validated origin
		header.Add("Vary", "Origin")
		header.Set("Access-Control-Allow-Origin", origin)
	} else {
		// Permissive mode - use wildcard or echo origin
		if origin == "" {
			origin = "*"
		} else {
			header.Add("Vary", "Origin")
		}
		header.Set("Access-Control-Allow-Origin", origin)
	}

	header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
	header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
	header.Set("Access-Control-Allow-Credentials", "true")
}

/**
 * SetCORSHeaders sets CORS headers for cross-origin requests with origin validation
 *
 * @param w - Response writer
 * @param r - HTTP request
 * @param allowedOrigins - Whitelist of allowed origins (empty = allow all)
 */
func SetCORSHeaders(w http.ResponseWriter, r *http.Request, allowedOrigins []string) {
	origin := r.Header.Get("Origin")
	setCORSHeadersOnHeader(w.Header(), origin, allowedOrigins)
}
