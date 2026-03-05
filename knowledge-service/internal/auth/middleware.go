package auth

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
)

var base64urlPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

const maxJWTPartLength = 8192

// Middleware provides HTTP middleware for JWT authentication.
type Middleware struct {
	airoValidator  *Validator
	jomaxValidator *JomaxValidator
	authType       string
}

// NewMiddleware creates a new auth middleware.
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
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.authType == "none" {
			next.ServeHTTP(w, r)
			return
		}

		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			slog.Warn("auth.missing_header", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "missing authorization header")
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			slog.Warn("auth.invalid_format", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "invalid authorization format")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == "" {
			slog.Warn("auth.empty_token", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "empty token")
			return
		}

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

// AuthenticateAPIKey returns HTTP middleware that validates API key from X-API-Key header.
func (m *Middleware) AuthenticateAPIKey(apiKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if m.authType == "none" {
				next.ServeHTTP(w, r)
				return
			}
			key := r.Header.Get("X-API-Key")
			if key == "" || key != apiKey {
				slog.Warn("auth.apikey.invalid", "path", r.URL.Path)
				writeUnauthorizedError(w, "invalid or missing API key")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeUnauthorizedError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func detectTokenType(tokenString string) string {
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return TokenTypeUnknown
	}

	for _, part := range parts {
		if len(part) == 0 || len(part) > maxJWTPartLength {
			return TokenTypeUnknown
		}
		if !base64urlPattern.MatchString(part) {
			return TokenTypeUnknown
		}
	}

	payload := parts[1]
	if l := len(payload) % 4; l > 0 {
		payload += strings.Repeat("=", 4-l)
	}

	decoded, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return TokenTypeUnknown
		}
	}

	var claims map[string]any
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return TokenTypeUnknown
	}

	return detectTokenTypeFromClaims(claims)
}
