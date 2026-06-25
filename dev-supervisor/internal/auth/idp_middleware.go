package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
)

// IDPAuthMiddlewareConfig defines configuration for IDP OAuth middleware.
//
// The middleware lazy-loads credentials from auth.json on every request via
// the supplied loader (which caches reads on its own TTL). This is what
// closes the boot-time race where dev-supervisor (PID 1) starts before the
// hosting secrets-tar extracts /alloc/auth.json: the file appearing at
// second N takes effect on the next request, not on the next container
// restart.
//
// Per mhp-core §3.5.1 the dev-supervisor IDP gate is the bypass-surface
// backstop, not the canonical authority — hosting + publish-prerequisite
// enforcement is. So when auth.json is missing or malformed, the middleware
// passes through (fail-open). When auth.json clearly says ssoRequired=true
// but the OAuth handler can't be initialized (e.g., malformed issuer), we
// fail closed with 503: we know SSO is required, just can't enforce it
// safely right now.
type IDPAuthMiddlewareConfig struct {
	Enabled       bool           // Master switch (kept for symmetry with JWT middleware)
	AuthLoader    *SecretsLoader // Loader reads auth.json with TTL caching
	ExcludedPaths []string       // Paths excluded from auth (e.g. /airo/health, /airo/idp/callback)
}

// IDPAuthMiddleware wraps HTTP handlers with IDP OAuth session-based
// authentication. The OAuth handler is built lazily the first time a request
// requires enforcement, then cached. It is rebuilt automatically when the
// client_secret rotates (existing session cookies become invalid; this is
// the acceptable rotation cost — fresh logins re-derive a cookie with the
// new encryption key).
type IDPAuthMiddleware struct {
	config IDPAuthMiddlewareConfig

	// mu guards handler + handlerFingerprint. Read-locked for the hot path
	// (cache hit on rotation check); write-locked only on first build or
	// after a detected rotation.
	mu                 sync.RWMutex
	handler            *IDPOAuthHandler
	handlerFingerprint string // hex-encoded sha256(client_secret) of the current handler
}

// NewIDPAuthMiddleware creates a new IDP auth middleware. The supplied
// AuthLoader determines when SSO enforcement is active — see the struct
// doc for the full contract.
func NewIDPAuthMiddleware(config IDPAuthMiddlewareConfig) *IDPAuthMiddleware {
	return &IDPAuthMiddleware{config: config}
}

// Wrap wraps an http.Handler with IDP OAuth session authentication. The
// loader is consulted on every request (results are TTL-cached inside the
// loader, so the hot path is a map lookup). Three terminal states:
//
//   - auth.json missing / malformed / ssoRequired=false → passthrough to next
//   - auth.json says ssoRequired=true + valid session cookie    → passthrough
//   - auth.json says ssoRequired=true + no/expired session
//   - API/JSON request: 401 Unauthorized
//   - Browser navigation: 302 to the IDP authorization endpoint
//
// Excluded paths (health, IDP callback) short-circuit BEFORE the loader is
// consulted so basic liveness checks never block on file I/O even if the
// loader is wedged.
func (m *IDPAuthMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.config.Enabled {
			next.ServeHTTP(w, r)
			return
		}

		// Excluded paths bypass enforcement (and bypass loader I/O).
		if middleware.IsPathExcluded(r.URL.Path, m.config.ExcludedPaths) {
			slog.DebugContext(r.Context(), "idp.middleware.path_excluded", "path", r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}

		if m.config.AuthLoader == nil {
			// Programming error: middleware wired without a loader. Per the
			// fail-open contract (we cannot determine SSO state), pass
			// through. The canonical hosting gate still applies.
			slog.ErrorContext(r.Context(), "idp.middleware.no_loader_configured", "path", r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}

		entry, err := m.config.AuthLoader.Load()
		if err != nil {
			// File missing (genuine non-ent app) OR boot-window-before-secrets
			// path. Both fail-open by design — see header doc. Log at Debug
			// because non-ent apps hit this on every request.
			slog.DebugContext(r.Context(), "idp.middleware.no_auth_secrets",
				"path", r.URL.Path,
				"error", err.Error())
			next.ServeHTTP(w, r)
			return
		}

		if !entry.SSORequired {
			// Cache row says SSO not required for this app — passthrough.
			slog.DebugContext(r.Context(), "idp.middleware.sso_not_required", "path", r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}

		// At this point we KNOW SSO is required. From here on, failures must
		// fail closed (503) rather than fall through, to avoid silently
		// serving the app un-authenticated when policy says auth is required.
		oauthHandler, hErr := m.resolveHandler(entry)
		if hErr != nil {
			slog.ErrorContext(r.Context(), "idp.middleware.handler_init_failed",
				"path", r.URL.Path,
				"error", hErr.Error())
			http.Error(w, "Service Unavailable: SSO authentication not ready", http.StatusServiceUnavailable)
			return
		}

		// Valid session cookie → authorized.
		encryptor := oauthHandler.GetEncryptor()
		if session := encryptor.GetSessionFromCookie(r); session != nil {
			slog.DebugContext(r.Context(), "idp.middleware.authorized", "path", r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}

		slog.DebugContext(r.Context(), "idp.middleware.no_session",
			"path", r.URL.Path,
			"remoteAddr", r.RemoteAddr)

		if isAPIOrJSONReq(r) {
			slog.InfoContext(r.Context(), "idp.middleware.returning_401", "path", r.URL.Path)
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Browser navigation → redirect to IDP.
		oauthHandler.RedirectToIDP(w, r)
	})
}

// GetOAuthHandler returns the cached OAuth handler keyed to the current
// auth.json contents. Used by the /airo/idp/callback HTTP route (which is
// excluded from enforcement but still needs to drive the code-exchange
// step). Returns an error when SSO is not required or the loader can't
// resolve credentials yet — both cases the caller maps to 503.
func (m *IDPAuthMiddleware) GetOAuthHandler() (*IDPOAuthHandler, error) {
	if m.config.AuthLoader == nil {
		return nil, errors.New("idp middleware: auth loader not configured")
	}
	entry, err := m.config.AuthLoader.Load()
	if err != nil {
		return nil, fmt.Errorf("idp middleware: load auth.json: %w", err)
	}
	if !entry.SSORequired {
		return nil, errors.New("idp middleware: SSO not required for this app")
	}
	return m.resolveHandler(entry)
}

// resolveHandler returns the cached OAuth handler for the current secrets
// entry, building it lazily on first call and rebuilding on client_secret
// rotation (which changes the cookie encryption key derivation).
//
// Concurrent first callers serialize on the write lock; only one builds
// the handler. Subsequent requests take the read-lock fast path.
func (m *IDPAuthMiddleware) resolveHandler(entry *SecretsEntry) (*IDPOAuthHandler, error) {
	// Fingerprint the client_secret so we can detect rotation without
	// holding a lock across handler construction. sha256 is constant-time
	// against the secret bytes; comparing fingerprints leaks no information.
	hash := sha256.Sum256([]byte(entry.ClientSecret))
	fingerprint := hex.EncodeToString(hash[:])

	m.mu.RLock()
	if m.handler != nil && m.handlerFingerprint == fingerprint {
		h := m.handler
		m.mu.RUnlock()
		return h, nil
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()

	// Double-check after acquiring the write lock — another goroutine may
	// have just built it.
	if m.handler != nil && m.handlerFingerprint == fingerprint {
		return m.handler, nil
	}

	// CookieEncryptionKey is the hex-encoded sha256 of the client_secret —
	// SAME derivation as the previous boot-time init flow, so existing
	// session cookies survive a binary upgrade as long as the secret is
	// unchanged.
	newHandler, err := NewIDPOAuthHandler(IDPOAuthConfig{
		Issuer:              entry.Issuer,
		ClientID:            entry.ClientID,
		ClientSecret:        entry.ClientSecret,
		Scopes:              "openid email profile",
		CookieEncryptionKey: fingerprint,
	})
	if err != nil {
		return nil, fmt.Errorf("build IDP OAuth handler: %w", err)
	}

	rotated := m.handler != nil
	m.handler = newHandler
	m.handlerFingerprint = fingerprint
	slog.Info("idp.auth.handler_initialized",
		"issuer", entry.Issuer,
		"rotated", rotated,
		// Log only an 8-char prefix of the fingerprint — enough to correlate
		// rotation events in Loki without leaking the full hash.
		"fingerprint_prefix", fingerprint[:8])

	return newHandler, nil
}

// isAPIOrJSONReq determines whether the request is a programmatic API call
// (should receive 401) vs a browser navigation (should receive 302 to IDP).
// Uses standard headers instead of path prefixes because in publish mode the
// proxy fronts an arbitrary customer app that may own /api/* routes.
func isAPIOrJSONReq(r *http.Request) bool {
	// XMLHttpRequest / fetch calls typically set X-Requested-With
	if r.Header.Get("X-Requested-With") == "XMLHttpRequest" {
		return true
	}

	// Sec-Fetch-Mode: navigate indicates a top-level browser navigation —
	// anything else (cors, no-cors, same-origin, websocket) is programmatic.
	if mode := r.Header.Get("Sec-Fetch-Mode"); mode != "" {
		return mode != "navigate"
	}

	// Fallback: check Accept header — browsers navigating send text/html first
	accept := r.Header.Get("Accept")
	if contains(accept, "text/html") {
		return false
	}

	// JSON content type is definitively an API call
	if contains(accept, "application/json") {
		return true
	}
	contentType := r.Header.Get("Content-Type")
	if contains(contentType, "application/json") {
		return true
	}

	// Default: treat as API (safer to return 401 than redirect fetch calls)
	return true
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
