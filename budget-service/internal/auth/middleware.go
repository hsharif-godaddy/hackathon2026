// Package auth provides HTTP middleware for GoDaddy authentication using gd-auth-lib.
package auth

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
)

// contextKey is used for context values to avoid collisions.
type contextKey string

const (
	// ClaimsKey is the context key for storing validated token claims.
	ClaimsKey contextKey = "auth_claims"
)

// gdAuthValidator is the subset of gd-auth-lib GDAuth used by the middleware.
// *gdauth.GDAuth satisfies it; tests may inject a stub via Middleware.validator.
type gdAuthValidator interface {
	ParseToken(token string, opts *gdauth.AuthOptions) (*gdauth.TokenClaims, error)
	GetAwsIamArn(claims *gdauth.TokenClaims) (string, error)
	GetCommonName(claims *gdauth.TokenClaims) (string, error)
}

// Middleware provides HTTP middleware for GoDaddy SSO JWT authentication.
type Middleware struct {
	client       *Client
	validator    gdAuthValidator // non-nil in tests only; production uses client.GDAuth
	authType     string
	allowedRoles []string
	allowedCerts []string
}

// NewMiddleware creates auth middleware using the singleton GDAuth client.
// authType: "jwt" to enforce validation, "none" to bypass (local dev only).
// allowedRoles: IAM ARN patterns; must be non-empty when authType=="jwt" (config.Load enforces this; the
// middleware also fails closed at request time with HTTP 403 if empty in JWT mode).
// allowedCerts: cert CommonName patterns; same non-empty contract as allowedRoles when authType=="jwt".
// Requires InitClient() to have been called first when authType is "jwt".
func NewMiddleware(authType string, allowedRoles []string, allowedCerts []string) *Middleware {
	m := &Middleware{
		authType:     authType,
		allowedRoles: allowedRoles,
		allowedCerts: allowedCerts,
	}

	if authType == "none" {
		slog.Debug("auth.init", "authType", "none", "message", "authentication disabled")
		return m
	}

	// Use the singleton client
	m.client = GetClient()
	if m.client == nil {
		slog.Error("auth.init.client_not_initialized", "message", "call InitClient() before NewMiddleware()")
		return m
	}

	slog.Debug("auth.init", "authType", authType, "ssoHost", m.client.SSOHost, "allowedRoles", len(m.allowedRoles), "allowedCerts", len(m.allowedCerts))
	return m
}

func (m *Middleware) gdAuth() gdAuthValidator {
	if m.validator != nil {
		return m.validator
	}
	// Do not return m.client.GDAuth when nil: a typed nil *gdauth.GDAuth in an interface
	// is not == nil and would panic on ParseToken.
	if m.client != nil && m.client.GDAuth != nil {
		return m.client.GDAuth
	}
	return nil
}

// extractToken extracts the JWT token from the request.
// Supports: Authorization: Bearer <token> and Authorization: sso-jwt <token>.
func extractToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}

	// Try Bearer prefix first
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}

	// Try sso-jwt prefix
	if strings.HasPrefix(auth, "sso-jwt ") {
		return strings.TrimPrefix(auth, "sso-jwt ")
	}

	return ""
}

// AuthenticateAWSIAMService validates service SSO JWTs from Authorization: Bearer
// or Authorization: sso-jwt. Allowed token types: AWS IAM, Cert, Cert2S delegation.
func (m *Middleware) AuthenticateAWSIAMService(next http.Handler) http.Handler {
	// No-op when auth is disabled
	if m.authType == "none" {
		return next
	}

	// Reject if no client (SSO host) or no token validator (real GDAuth or test stub).
	if m.client == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slog.Error("auth.validate.client_nil", "method", r.Method, "path", r.URL.Path)
			writeAuthError(w, http.StatusUnauthorized, "AUTH_MISCONFIGURED", "auth misconfigured")
		})
	}
	g := m.gdAuth()
	if g == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slog.Error("auth.validate.gdauth_nil", "method", r.Method, "path", r.URL.Path)
			writeAuthError(w, http.StatusUnauthorized, "AUTH_MISCONFIGURED", "auth misconfigured")
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			writeAuthError(w, http.StatusUnauthorized, "MISSING_AUTHORIZATION", "missing authorization token")
			return
		}

		// Configure auth options for AWS IAM, Cert, and Cert2S tokens
		// We accept multiple token types, so we don't filter by AuthType
		authOptions := &gdauth.AuthOptions{
			GoDaddySSO: &gdauth.GoDaddySSOConfig{
				Host:          m.client.SSOHost,
				SecurityLevel: gdauth.SecurityLevelLow,
				Auths: []gdauth.Auths{
					gdauth.AuthsBasic,  // Standard auth (for IAM and Cert)
					gdauth.AuthsCert2S, // Cert to Shopper delegation
				},
				FilterByAuthType: false, // Accept multiple token types
				AllowHeartbeat:   false,
			},
		}

		claims, err := g.ParseToken(token, authOptions)
		if err != nil {
			slog.Warn("auth.validate.failed", "error", err)
			writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", "invalid token")
			return
		}

		// Verify the token type is one of the allowed types: awsiam, cert
		// Cert2S tokens have typ=cert but auth=cert2s, which is already covered by Auths config
		tokenType := claims.GetType()
		if tokenType != string(gdauth.AuthTypeAWSIAM) && tokenType != string(gdauth.AuthTypeCERT) {
			slog.Warn("auth.validate.wrong_type", "tokenType", tokenType, "expected", "awsiam or cert")
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED_TOKEN_TYPE", "unauthorized token type")
			return
		}

		// Fail closed when authType is "jwt": config.Load already requires non-empty
		// allowlists, but defending here avoids any future regression where the slice
		// is empty in JWT mode (security review follow-up).
		if tokenType == string(gdauth.AuthTypeAWSIAM) {
			if len(m.allowedRoles) == 0 {
				slog.Error("auth.validate.role_allowlist_empty", "method", r.Method, "path", r.URL.Path)
				writeAuthError(w, http.StatusForbidden, "IAM_ALLOWLIST_NOT_CONFIGURED", "forbidden: IAM role allowlist not configured")
				return
			}
			arn, err := g.GetAwsIamArn(claims)
			if err != nil {
				slog.Warn("auth.validate.arn_extraction_failed", "error", err, "method", r.Method, "path", r.URL.Path)
				writeAuthError(w, http.StatusForbidden, "IAM_ROLE_EXTRACT_FAILED", "forbidden: unable to extract IAM role")
				return
			}
			if !matchesAllowlist(arn, m.allowedRoles) {
				slog.Warn("auth.validate.role_denied", "arn", arn, "method", r.Method, "path", r.URL.Path)
				writeAuthError(w, http.StatusForbidden, "IAM_ROLE_DENIED", "forbidden: IAM role not in allowlist")
				return
			}
		}

		if tokenType == string(gdauth.AuthTypeCERT) {
			if len(m.allowedCerts) == 0 {
				slog.Error("auth.validate.cert_allowlist_empty", "method", r.Method, "path", r.URL.Path)
				writeAuthError(w, http.StatusForbidden, "CERT_ALLOWLIST_NOT_CONFIGURED", "forbidden: cert allowlist not configured")
				return
			}
			cn, err := g.GetCommonName(claims)
			if err != nil {
				slog.Warn("auth.validate.cn_extraction_failed", "error", err, "method", r.Method, "path", r.URL.Path)
				writeAuthError(w, http.StatusForbidden, "CERT_CN_EXTRACT_FAILED", "forbidden: unable to extract cert CommonName")
				return
			}
			if !matchesAllowlist(cn, m.allowedCerts) {
				slog.Warn("auth.validate.cert_denied", "commonName", cn, "method", r.Method, "path", r.URL.Path)
				writeAuthError(w, http.StatusForbidden, "CERT_CN_DENIED", "forbidden: cert CommonName not in allowlist")
				return
			}
		}

		// Store claims in context for downstream handlers
		ctx := context.WithValue(r.Context(), ClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// matchesAllowlist matches value against patterns: exact string equality, or prefix match when the
// pattern ends with '*'. Leading '*' (e.g. "*.example.com") is not supported — use a trailing '*'.
func matchesAllowlist(value string, patterns []string) bool {
	for _, p := range patterns {
		if strings.HasSuffix(p, "*") {
			if strings.HasPrefix(value, strings.TrimSuffix(p, "*")) {
				return true
			}
		} else if value == p {
			return true
		}
	}
	return false
}

// GetClaims retrieves the validated token claims from the request context.
func GetClaims(r *http.Request) *gdauth.TokenClaims {
	claims, _ := r.Context().Value(ClaimsKey).(*gdauth.TokenClaims)
	return claims
}
