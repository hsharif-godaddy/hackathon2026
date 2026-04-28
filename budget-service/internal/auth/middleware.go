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

// Middleware provides HTTP middleware for GoDaddy SSO JWT authentication.
type Middleware struct {
	client       *Client
	authType     string
	allowedRoles []string
	allowedCerts []string
}

// NewMiddleware creates auth middleware using the singleton GDAuth client.
// authType: "jwt" to enforce validation, "none" to bypass (local dev only).
// allowedRoles: IAM ARN patterns; empty slice skips role filtering (config.Load requires non-empty when JWT auth is on).
// allowedCerts: cert CommonName patterns; empty slice skips CN filtering (config.Load requires non-empty when JWT auth is on).
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

	// Reject all requests if client initialization failed
	if m.client == nil || m.client.GDAuth == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"auth misconfigured"}`, http.StatusUnauthorized)
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
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

		claims, err := m.client.GDAuth.ParseToken(token, authOptions)
		if err != nil {
			slog.Debug("auth.validate.failed", "error", err)
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		// Verify the token type is one of the allowed types: awsiam, cert
		// Cert2S tokens have typ=cert but auth=cert2s, which is already covered by Auths config
		tokenType := claims.GetType()
		if tokenType != string(gdauth.AuthTypeAWSIAM) && tokenType != string(gdauth.AuthTypeCERT) {
			slog.Debug("auth.validate.wrong_type", "tokenType", tokenType, "expected", "awsiam or cert")
			http.Error(w, `{"error":"unauthorized token type"}`, http.StatusUnauthorized)
			return
		}

		if tokenType == string(gdauth.AuthTypeAWSIAM) && len(m.allowedRoles) > 0 {
			arn, err := m.client.GDAuth.GetAwsIamArn(claims)
			if err != nil {
				slog.Warn("auth.validate.arn_extraction_failed", "error", err, "method", r.Method, "path", r.URL.Path)
				http.Error(w, `{"error":"forbidden: unable to extract IAM role"}`, http.StatusForbidden)
				return
			}
			if !matchesAllowlist(arn, m.allowedRoles) {
				slog.Warn("auth.validate.role_denied", "arn", arn, "method", r.Method, "path", r.URL.Path)
				http.Error(w, `{"error":"forbidden: IAM role not in allowlist"}`, http.StatusForbidden)
				return
			}
		}

		if tokenType == string(gdauth.AuthTypeCERT) && len(m.allowedCerts) > 0 {
			cn, err := m.client.GDAuth.GetCommonName(claims)
			if err != nil {
				slog.Warn("auth.validate.cn_extraction_failed", "error", err, "method", r.Method, "path", r.URL.Path)
				http.Error(w, `{"error":"forbidden: unable to extract cert CommonName"}`, http.StatusForbidden)
				return
			}
			if !matchesAllowlist(cn, m.allowedCerts) {
				slog.Warn("auth.validate.cert_denied", "commonName", cn, "method", r.Method, "path", r.URL.Path)
				http.Error(w, `{"error":"forbidden: cert CommonName not in allowlist"}`, http.StatusForbidden)
				return
			}
		}

		// Store claims in context for downstream handlers
		ctx := context.WithValue(r.Context(), ClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

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
