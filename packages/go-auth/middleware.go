package goauth

import (
	"log/slog"
	"net/http"

	"github.com/gdcorp-golang/auth/gdhttp"
	"github.com/gdcorp-golang/auth/gdsso"
	"github.com/gdcorp-golang/auth/gdtoken"
)

// Middleware provides HTTP middleware for GoDaddy SSO JWT authentication.
type Middleware struct {
	authenticate        func(http.Handler) http.Handler
	authenticateIAMOnly func(http.Handler) http.Handler
	authType            string
}

// NewMiddleware creates auth middleware backed by gdcorp-golang/auth.
// authType: "jwt" to enforce validation, "none" to bypass (local dev only).
// ssoHost: GoDaddy SSO hostname, e.g. "sso.dev-godaddy.com" or "sso.godaddy.com".
func NewMiddleware(authType, ssoHost string) *Middleware {
	m := &Middleware{authType: authType}

	if authType == "none" {
		noop := func(next http.Handler) http.Handler { return next }
		m.authenticate = noop
		m.authenticateIAMOnly = noop
		return m
	}

	client, err := gdsso.NewClient(gdsso.WithHost(ssoHost))
	if err != nil {
		slog.Error("goauth.init.sso_client_failed", "error", err)
		// Fallback: reject all tokens when SSO host is misconfigured
		reject := func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, `{"error":"auth misconfigured"}`, http.StatusUnauthorized)
			})
		}
		m.authenticate = reject
		m.authenticateIAMOnly = reject
		return m
	}

	validator := gdsso.NewValidator(client)

	reject := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"auth misconfigured"}`, http.StatusUnauthorized)
		})
	}

	// Authenticate: accepts any valid SSO token kind
	authenticate, err := gdhttp.NewHandler(validator)
	if err != nil {
		slog.Error("goauth.init.handler_failed", "error", err)
		m.authenticate = reject
	} else {
		m.authenticate = authenticate
	}

	// AuthenticateWithKind("awsiam"): accepts only AWS IAM tokens (for ingest)
	iamOnly, err := gdhttp.NewHandler(
		validator,
		gdhttp.WithRequirements(gdhttp.Active(gdtoken.Low), gdhttp.Kind(gdtoken.AWSIAMKind)),
	)
	if err != nil {
		slog.Error("goauth.init.iam_handler_failed", "error", err)
		m.authenticateIAMOnly = reject
	} else {
		m.authenticateIAMOnly = iamOnly
	}

	return m
}

// Authenticate returns HTTP middleware that validates any GoDaddy SSO token.
// Expects: Authorization: sso-jwt <token>
// Returns 401 for missing or invalid tokens.
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return m.authenticate(next)
}

// AuthenticateWithKind returns HTTP middleware that validates a token
// AND enforces it is of the given kind (e.g. "awsiam" for ingest endpoints).
// tokenKind: "awsiam" → requires AWS IAM token (for ingest).
// Returns 401 for invalid tokens, 403 if token is wrong kind.
// Returns 500 for unknown token kinds to prevent silent auth misconfiguration.
func (m *Middleware) AuthenticateWithKind(tokenKind string) func(http.Handler) http.Handler {
	switch tokenKind {
	case "awsiam":
		return m.authenticateIAMOnly
	default:
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, `{"error":"auth misconfigured"}`, http.StatusInternalServerError)
			})
		}
	}
}
