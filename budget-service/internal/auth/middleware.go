// Package auth provides HTTP middleware for GoDaddy authentication using gd-auth-lib.
//
// SIEM hygiene note: gd-auth-lib's `ParseToken`, `GetAwsIamArn`, and
// `GetCommonName` errors are forwarded into seclog events as `error.message`.
// Audited at gd-auth-lib v0.11.0: TokenValidationError and FFIError formats
// are static (`"token validation error: <static-msg> (code: <int>)"` and
// `"FFI error: <int>"`), with no token bytes / kid / claim values echoed.
// Re-audit if go.mod bumps gd-auth-lib; if a new version starts echoing
// input into error strings, drop seclog.Event.Err for the INVALID_TOKEN /
// *_EXTRACT_FAILED paths and rely on Reason alone.
package auth

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/seclog"
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
			seclog.AuthFailure(r, seclog.Event{
				Reason: "AUTH_MISCONFIGURED",
				Status: http.StatusUnauthorized,
				Labels: []slog.Attr{slog.String("cause", "client_nil")},
			})
			writeAuthError(w, http.StatusUnauthorized, "AUTH_MISCONFIGURED", "auth misconfigured")
		})
	}
	g := m.gdAuth()
	if g == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seclog.AuthFailure(r, seclog.Event{
				Reason: "AUTH_MISCONFIGURED",
				Status: http.StatusUnauthorized,
				Labels: []slog.Attr{slog.String("cause", "gdauth_nil")},
			})
			writeAuthError(w, http.StatusUnauthorized, "AUTH_MISCONFIGURED", "auth misconfigured")
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			seclog.AuthFailure(r, seclog.Event{
				Reason: "MISSING_AUTHORIZATION",
				Status: http.StatusUnauthorized,
			})
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
			seclog.AuthFailure(r, seclog.Event{
				Reason: "INVALID_TOKEN",
				Status: http.StatusUnauthorized,
				Err:    err,
			})
			writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", "invalid token")
			return
		}

		// Verify the token type is one of the allowed types: awsiam, cert.
		// Cert2S tokens have typ=cert but auth=cert2s, which is already covered by Auths config.
		// The token validates — only its type is rejected for this route — so this is
		// authorization, not authentication. Routing as AuthzFailure (event.category=iam)
		// matches SIEM allowlist-violation rules.
		tokenType := claims.GetType()
		if tokenType != string(gdauth.AuthTypeAWSIAM) && tokenType != string(gdauth.AuthTypeCERT) {
			seclog.AuthzFailure(r, seclog.Event{
				Reason: "UNAUTHORIZED_TOKEN_TYPE",
				Status: http.StatusUnauthorized,
				Labels: []slog.Attr{
					slog.String("token_type", tokenType),
					slog.String("expected", "awsiam or cert"),
				},
			})
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED_TOKEN_TYPE", "unauthorized token type")
			return
		}

		// Fail closed when authType is "jwt": config.Load already requires non-empty
		// allowlists, but defending here avoids any future regression where the slice
		// is empty in JWT mode (security review follow-up).
		resolvedUser, handled := m.resolveUserForToken(w, r, g, claims, tokenType)
		if handled {
			return
		}

		seclog.AuthSuccess(r, seclog.Event{
			Reason: "AUTH_SUCCESS",
			User:   resolvedUser,
			Labels: []slog.Attr{slog.String("token_type", tokenType)},
		})

		// Store claims in context for downstream handlers
		ctx := context.WithValue(r.Context(), ClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// resolveUserForToken extracts the principal identity from claims and verifies
// it matches the configured allowlist for the given token type. On any failure
// it writes the seclog event AND the HTTP error response, then returns
// handled=true; the caller must return without further work. On success it
// returns the resolved principal (IAM ARN or cert CN) and handled=false.
func (m *Middleware) resolveUserForToken(
	w http.ResponseWriter, r *http.Request, g gdAuthValidator, claims *gdauth.TokenClaims, tokenType string,
) (user string, handled bool) {
	tokenLabel := slog.String("token_type", tokenType)

	switch tokenType {
	case string(gdauth.AuthTypeAWSIAM):
		if len(m.allowedRoles) == 0 {
			seclog.AuthzFailure(r, seclog.Event{
				Reason: "IAM_ALLOWLIST_NOT_CONFIGURED",
				Status: http.StatusForbidden,
				Labels: []slog.Attr{tokenLabel},
			})
			writeAuthError(w, http.StatusForbidden, "IAM_ALLOWLIST_NOT_CONFIGURED", "forbidden: IAM role allowlist not configured")
			return "", true
		}
		arn, err := g.GetAwsIamArn(claims)
		if err != nil {
			seclog.AuthzFailure(r, seclog.Event{
				Reason: "IAM_ROLE_EXTRACT_FAILED",
				Status: http.StatusForbidden,
				Err:    err,
				Labels: []slog.Attr{tokenLabel},
			})
			writeAuthError(w, http.StatusForbidden, "IAM_ROLE_EXTRACT_FAILED", "forbidden: unable to extract IAM role")
			return "", true
		}
		if !matchesAllowlist(arn, m.allowedRoles) {
			seclog.AuthzFailure(r, seclog.Event{
				Reason: "IAM_ROLE_DENIED",
				Status: http.StatusForbidden,
				User:   arn,
				Labels: []slog.Attr{tokenLabel},
			})
			writeAuthError(w, http.StatusForbidden, "IAM_ROLE_DENIED", "forbidden: IAM role not in allowlist")
			return "", true
		}
		return arn, false

	case string(gdauth.AuthTypeCERT):
		if len(m.allowedCerts) == 0 {
			seclog.AuthzFailure(r, seclog.Event{
				Reason: "CERT_ALLOWLIST_NOT_CONFIGURED",
				Status: http.StatusForbidden,
				Labels: []slog.Attr{tokenLabel},
			})
			writeAuthError(w, http.StatusForbidden, "CERT_ALLOWLIST_NOT_CONFIGURED", "forbidden: cert allowlist not configured")
			return "", true
		}
		cn, err := g.GetCommonName(claims)
		if err != nil {
			seclog.AuthzFailure(r, seclog.Event{
				Reason: "CERT_CN_EXTRACT_FAILED",
				Status: http.StatusForbidden,
				Err:    err,
				Labels: []slog.Attr{tokenLabel},
			})
			writeAuthError(w, http.StatusForbidden, "CERT_CN_EXTRACT_FAILED", "forbidden: unable to extract cert CommonName")
			return "", true
		}
		if !matchesAllowlist(cn, m.allowedCerts) {
			seclog.AuthzFailure(r, seclog.Event{
				Reason: "CERT_CN_DENIED",
				Status: http.StatusForbidden,
				User:   cn,
				Labels: []slog.Attr{tokenLabel},
			})
			writeAuthError(w, http.StatusForbidden, "CERT_CN_DENIED", "forbidden: cert CommonName not in allowlist")
			return "", true
		}
		return cn, false
	}

	// Caller has already verified tokenType is one of the cases above. This
	// default leg should be unreachable today, but if a future refactor
	// relaxes the tokenType gate at AuthenticateAWSIAMService, we fail closed
	// loudly rather than silently allowing the request through with an empty
	// principal.
	seclog.AuthFailure(r, seclog.Event{
		Reason: "UNEXPECTED_TOKEN_TYPE_PATH",
		Status: http.StatusInternalServerError,
		Labels: []slog.Attr{slog.String("token_type", tokenType)},
	})
	writeAuthError(w, http.StatusInternalServerError, "UNEXPECTED_TOKEN_TYPE_PATH", "internal error: unexpected token type")
	return "", true
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
