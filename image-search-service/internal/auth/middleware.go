package auth

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
)

// base64urlPattern validates base64url-encoded strings (no padding required).
// Used to validate JWT parts before decoding to prevent processing malicious input.
var base64urlPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// maxJWTPartLength limits the size of JWT parts to prevent DoS attacks.
const maxJWTPartLength = 8192

// Middleware provides HTTP middleware for JWT authentication.
type Middleware struct {
	airoValidator  *Validator      // validator for airo-app tokens
	jomaxValidator *JomaxValidator // validator for JOMAX tokens
	authType       string
}

// NewMiddleware creates a new auth middleware.
// If authType is "jwt", validators are created for both airo-app and JOMAX tokens.
// If authType is "none", authentication is bypassed entirely.
func NewMiddleware(authType, jwksURL, issuer, audience, ssoHost string) *Middleware {
	m := &Middleware{
		authType: authType,
	}

	if authType == "jwt" {
		m.airoValidator = NewValidator(jwksURL, issuer, audience)
		if ssoHost != "" {
			m.jomaxValidator = NewJomaxValidator(ssoHost)
		}
	}

	return m
}

// Authenticate returns HTTP middleware that validates JWT tokens.
// If authType is "none", all requests are allowed through without authentication.
// Otherwise, requests must include a valid Bearer token in the Authorization header.
// Supports both airo-app tokens (validated via JWKS) and JOMAX tokens (validated via SSO).
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

		// Detect token type and validate with appropriate validator
		tokenType := detectTokenType(token)
		var err error

		switch tokenType {
		case TokenTypeAiroApp:
			_, err = m.airoValidator.Validate(token)
		case TokenTypeJomax:
			if m.jomaxValidator != nil {
				_, err = m.jomaxValidator.Validate(token)
			} else {
				slog.Warn("auth.jomax_not_configured", "path", r.URL.Path, "method", r.Method)
				writeUnauthorizedError(w, "JOMAX authentication not configured")
				return
			}
		default:
			slog.Warn("auth.unknown_token_type", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "unknown token type")
			return
		}

		if err != nil {
			slog.Warn("auth.validation_failed", "path", r.URL.Path, "method", r.Method, "tokenType", tokenType, "error", err.Error())
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

// detectTokenType determines the token type from a JWT token string.
// It first validates JWT structure, then decodes the payload without signature verification
// to determine which validator should be used.
// Returns TokenTypeUnknown on any error or invalid input.
func detectTokenType(tokenString string) string {
	// JWT format: header.payload.signature
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return TokenTypeUnknown
	}

	// Validate all parts before any decoding to prevent processing malicious input
	for _, part := range parts {
		// Check length to prevent DoS
		if len(part) == 0 || len(part) > maxJWTPartLength {
			return TokenTypeUnknown
		}
		// Validate base64url format (prevents control characters, path traversal, etc.)
		if !base64urlPattern.MatchString(part) {
			return TokenTypeUnknown
		}
	}

	// Decode payload (second part) - handle both standard and URL-safe base64
	payload := parts[1]
	// Add padding if necessary
	if l := len(payload) % 4; l > 0 {
		payload += strings.Repeat("=", 4-l)
	}

	decoded, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		// Try standard base64 as fallback
		decoded, err = base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return TokenTypeUnknown
		}
	}

	// Parse JSON claims - only extract fields needed for type detection
	var claims map[string]any
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return TokenTypeUnknown
	}

	return detectTokenTypeFromClaims(claims)
}
