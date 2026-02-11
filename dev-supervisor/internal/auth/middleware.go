package auth

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
)

var siteIDPattern = regexp.MustCompile(`^[a-zA-Z0-9-]+$`)

// JWTMiddlewareConfig defines configuration for JWT middleware
// Authentication failure handling uses hybrid mode:
// - Browser requests (text/html): Redirect to SSO login page
// - API/JSON requests: Return 401 Unauthorized with JSON error
type JWTMiddlewareConfig struct {
	Enabled        bool // Enable JWT validation
	Validator      *JWTValidator
	ShareValidator *ShareValidator // Share token validator (optional, for public preview links)
	RedirectURL    string          // URL to redirect to on auth failure (supports {url} placeholder)
	BuilderBaseURL string          // Builder app base URL for smart redirects (e.g., https://airo-builder.test-godaddy.com)
	SiteID         string          // Site ID for smart redirects (from SITE_ID env var, e.g., "41gb5nrnyl" or UUID)
	ExcludedPaths  []string        // Paths to exclude from JWT validation (e.g., /health, /api/health)
	APIPrefix      string          // API route prefix for hybrid mode (default: /api)
	AllowedOrigins []string        // CORS allowed origins (whitelist)
}

// JWTMiddleware wraps HTTP handlers with JWT authentication
type JWTMiddleware struct {
	config JWTMiddlewareConfig
}

// NewJWTMiddleware creates a new JWT middleware
func NewJWTMiddleware(config JWTMiddlewareConfig) *JWTMiddleware {
	// Set defaults
	if config.APIPrefix == "" {
		config.APIPrefix = "/api"
	}

	return &JWTMiddleware{
		config: config,
	}
}

// Wrap wraps an http.Handler with JWT authentication
func (m *JWTMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip JWT validation if disabled
		if !m.config.Enabled {
			next.ServeHTTP(w, r)
			return
		}

		// Check if path is excluded from validation
		if middleware.IsPathExcluded(r.URL.Path, m.config.ExcludedPaths) {
			slog.Debug("jwt.middleware.path_excluded", "path", r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}

		// Priority 1: Check for share token (if ShareValidator is configured)
		if m.config.ShareValidator != nil {
			// Try share token validation from query param or cookie
			if handled := m.tryShareTokenAuth(w, r, next); handled {
				return // Share token handled the request
			}
			// Share token validation failed, fall through to JWT
		}

		// Priority 2: Fall back to JWT validation
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

// tryShareTokenAuth attempts to authenticate using share token from query param or cookie
// Returns true if request was handled (success or error), false to fall through to JWT
func (m *JWTMiddleware) tryShareTokenAuth(
	w http.ResponseWriter,
	r *http.Request,
	next http.Handler,
) bool {
	// Check query param first
	if shareToken := r.URL.Query().Get("airoShareToken"); shareToken != "" {
		if m.handleShareToken(w, r, shareToken, "query_param", next) {
			return true // Successfully handled
		}
		// If share token validation failed, fall through to cookie/JWT
	}

	// Check cookie second
	if cookie, err := r.Cookie("airo_share_token"); err == nil && cookie.Value != "" {
		if m.handleShareToken(w, r, cookie.Value, "cookie", next) {
			return true // Successfully handled
		}
		// If share token validation failed, fall through to JWT
	}

	return false // No share token found or validation failed, try JWT
}

// handleShareToken validates a share token and handles the request if valid
// Returns true if the request was handled (either successfully or with error), false to fall through to JWT
func (m *JWTMiddleware) handleShareToken(
	w http.ResponseWriter,
	r *http.Request,
	shareToken string,
	source string,
	next http.Handler,
) bool {
	valid, appID, err := m.config.ShareValidator.ValidateToken(shareToken)

	if err != nil {
		// Validation error (network/API issue)
		slog.Error("share.validation.error",
			"error", err.Error(),
			"share_token", shareToken,
			"source", source)
		m.handleAuthFailure(w, r, "validation error")
		return true // Handled with error
	}

	if !valid {
		// Invalid token - clear cookie if present and fall through to JWT
		if source == "cookie" {
			http.SetCookie(w, &http.Cookie{
				Name:   "airo_share_token",
				Value:  "",
				Path:   "/",
				MaxAge: -1, // Delete cookie
			})
		}
		slog.Warn("share.validation.failed",
			"share_token", shareToken,
			"source", source)
		// Return false to fall through to JWT validation
		return false
	}

	// Validate appID matches site (authorization check)
	if m.config.SiteID != "" && appID != m.config.SiteID {
		slog.Warn("share.siteid_mismatch",
			"share_token", shareToken,
			"expected_site_id", m.config.SiteID,
			"actual_site_id", appID)
		m.handleAuthFailure(w, r, "token not valid for this site")
		return true // Handled with error
	}

	// Valid token - set cookie on first access (query param)
	if source == "query_param" {
		expiresAt := m.config.ShareValidator.GetTokenExpiration(shareToken)
		http.SetCookie(w, &http.Cookie{
			Name:     "airo_share_token",
			Value:    shareToken,
			Path:     "/",
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
			Expires:  expiresAt,
		})
	}

	// Log for analytics (Elasticsearch)
	slog.Info("share.token.authorized",
		"app_id", appID,
		"share_token", shareToken,
		"source", source,
		"path", r.URL.Path,
		"method", r.Method,
		"remote_addr", r.RemoteAddr,
		"user_agent", r.UserAgent(),
		"referer", r.Referer())

	// Continue to next handler
	next.ServeHTTP(w, r)
	return true // Successfully handled
}

// handleAuthFailure handles authentication failures using hybrid mode
// Hybrid mode behavior:
// - Browser requests (Accept: text/html): Redirect to SSO login page
// - API/JSON requests: Return 401 Unauthorized with JSON error
func (m *JWTMiddleware) handleAuthFailure(w http.ResponseWriter, r *http.Request, reason string) {
	// Hybrid mode: redirect browsers, return 401 for APIs
	if m.isAPIOrJSONRequest(r) {
		m.returnError(w, r, reason)
	} else {
		m.redirect(w, r, reason)
	}
}

// returnError returns a 401 Unauthorized error
func (m *JWTMiddleware) returnError(w http.ResponseWriter, r *http.Request, reason string) {
	slog.Info("jwt.middleware.returning_401",
		"path", r.URL.Path,
		"reason", reason)

	// CORS headers are set by CORS middleware (outermost layer)
	w.Header().Set("WWW-Authenticate", "Bearer")
	http.Error(w, "Unauthorized", http.StatusUnauthorized)
}

// redirect redirects to configured login page
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

	// CORS headers are set by CORS middleware (outermost layer)
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// buildSmartRedirectURL builds a smart redirect URL for preview app access
// When users access preview apps directly, we want to redirect them to the builder
// with that specific app open, not just the homepage.
// Works for both:
// - localhost:5001 (local development) - SITE_ID from docker-compose
// - 41gb5nrnyl.c4.test-airoapp.ai (production) - SITE_ID from deployment config
// Builder URL format (root with redirect query so SSO allowlists the origin):
// - https://airo-builder.{env}-godaddy.com/?redirect=%2Fdevelop%2F{siteId}%3FsiteId%3D{siteId}
func (m *JWTMiddleware) buildSmartRedirectURL() string {
	// Use SITE_ID from environment (set by docker-compose or production deployment)
	siteID := m.config.SiteID
	if siteID == "" {
		slog.Debug("jwt.middleware.smart_redirect.no_site_id",
			"message", "SITE_ID not configured, using default redirect")
		return ""
	}
	if !siteIDPattern.MatchString(siteID) {
		slog.Warn("jwt.middleware.smart_redirect.invalid_site_id",
			"siteID", siteID)
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
	// Format: https://airo-builder.{env}-godaddy.com/?redirect=%2Fdevelop%2F{siteId}%3FsiteId%3D{siteId}
	escapedSiteID := url.QueryEscape(siteID)

	basePath := builderBaseURL.Path
	if basePath == "" {
		basePath = "/"
	}
	if !strings.HasSuffix(basePath, "/") {
		basePath += "/"
	}

	redirectPath := fmt.Sprintf("/develop/%s?siteId=%s", escapedSiteID, escapedSiteID)
	smartURL := fmt.Sprintf("%s://%s%s?redirect=%s",
		builderBaseURL.Scheme,
		builderBaseURL.Host,
		basePath,
		url.QueryEscape(redirectPath))

	return smartURL
}

// isAllowedRedirectHost validates if a host is allowed for redirects
// Prevents open redirect vulnerabilities by checking against configured redirect URL
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

// isAPIOrJSONRequest checks if the request is an API or JSON request
// Used in hybrid mode to determine whether to redirect or return 401
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

// CORS utility functions removed - CORS is now handled by rs/cors middleware
// See http_proxy.go middleware chain setup for CORS configuration
