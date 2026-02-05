package auth

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

// Middleware provides HTTP middleware for JWT authentication.
type Middleware struct {
	validator *Validator
	authType  string
}

// NewMiddleware creates a new auth middleware.
// If authType is "jwt", a validator is created using the provided jwksURL.
// If authType is "none", authentication is bypassed entirely.
func NewMiddleware(authType, jwksURL, issuer, audience string) *Middleware {
	m := &Middleware{
		authType: authType,
	}

	if authType == "jwt" {
		m.validator = NewValidator(jwksURL, issuer, audience)
	}

	return m
}

// Authenticate returns HTTP middleware that validates JWT tokens.
// If authType is "none", all requests are allowed through without authentication.
// Otherwise, requests must include a valid Bearer token in the Authorization header.
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Bypass auth if authType is "none"
		if m.authType == "none" {
			next.ServeHTTP(w, r)
			return
		}

		// Extract Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			slog.Warn("auth.missing_header", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "missing authorization header")
			return
		}

		// Check for Bearer prefix
		if !strings.HasPrefix(authHeader, "Bearer ") {
			slog.Warn("auth.invalid_format", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "invalid authorization format")
			return
		}

		// Extract token
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == "" {
			slog.Warn("auth.empty_token", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "empty token")
			return
		}

		// Validate token
		_, err := m.validator.Validate(token)
		if err != nil {
			slog.Warn("auth.validation_failed", "path", r.URL.Path, "method", r.Method, "error", err.Error())
			writeUnauthorizedError(w, "invalid token")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// writeUnauthorizedError writes a JSON 401 Unauthorized error response.
func writeUnauthorizedError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
