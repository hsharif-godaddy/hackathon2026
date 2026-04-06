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
	authenticate          func(http.Handler) http.Handler
	authenticateIAMOnly   func(http.Handler) http.Handler
	authenticateCertOnly  func(http.Handler) http.Handler
	authenticateAWSIAMSvc func(http.Handler) http.Handler
	authType              string
}

// NewMiddleware creates auth middleware backed by gdcorp-golang/auth.
// authType: "jwt" to enforce validation, "none" to bypass (local dev only).
// ssoHost: GoDaddy SSO hostname, e.g. "sso.dev-godaddy.com" or "sso.godaddy.com".
func NewMiddleware(authType, ssoHost string) *Middleware {
	m := &Middleware{authType: authType}

	if authType == "none" {
		slog.Debug("goauth.init", "auth_type", "none", "message", "sso_and_iam_handlers_disabled")
		noop := func(next http.Handler) http.Handler { return next }
		m.authenticate = noop
		m.authenticateIAMOnly = noop
		m.authenticateCertOnly = noop
		m.authenticateAWSIAMSvc = noop
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
		m.authenticateCertOnly = reject
		m.authenticateAWSIAMSvc = reject
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

	// AuthenticateWithKind("awsiam"): accepts only AWS IAM tokens (e.g. agents, mint-iam-jwt).
	// Same extractors as service SSO so Bearer and sso-jwt work; wrong kind still fails validation.
	iamOnly, err := gdhttp.NewHandler(
		validator,
		gdhttp.WithRequirements(gdhttp.Active(gdtoken.Low), gdhttp.Kind(gdtoken.AWSIAMKind)),
		gdhttp.WithTokenExtractors(
			gdhttp.ModeDistinct,
			gdhttp.NewHeaderExtractor("Authorization", "Bearer"),
			gdhttp.NewHeaderExtractor("Authorization", "sso-jwt"),
		),
	)
	if err != nil {
		slog.Error("goauth.init.iam_handler_failed", "error", err)
		m.authenticateIAMOnly = reject
	} else {
		m.authenticateIAMOnly = iamOnly
	}

	// AWS IAM, Cert, and Cert2S for service callers (Bearer or sso-jwt): GoCode auth-client, cert-based S2S, etc.
	iamSvc, err := gdhttp.NewHandler(
		validator,
		gdhttp.WithRequirements(
			gdhttp.Active(gdtoken.Low),
			gdhttp.Or(
				gdhttp.Kind(gdtoken.AWSIAMKind),
				gdhttp.Kind(gdtoken.CertKind),
				gdhttp.Kind(gdtoken.Cert2SDelegationKind),
			),
		),
		gdhttp.WithTokenExtractors(
			gdhttp.ModeDistinct,
			gdhttp.NewHeaderExtractor("Authorization", "Bearer"),
			gdhttp.NewHeaderExtractor("Authorization", "sso-jwt"),
		),
	)
	if err != nil {
		slog.Error("goauth.init.iam_service_handler_failed", "error", err)
		m.authenticateAWSIAMSvc = reject
	} else {
		m.authenticateAWSIAMSvc = iamSvc
	}

	certOnly, err := gdhttp.NewHandler(
		validator,
		gdhttp.WithRequirements(
			gdhttp.Active(gdtoken.Low),
			gdhttp.Or(
				gdhttp.Kind(gdtoken.CertKind),
				gdhttp.Kind(gdtoken.Cert2SDelegationKind),
			),
		),
		gdhttp.WithTokenExtractors(
			gdhttp.ModeDistinct,
			gdhttp.NewHeaderExtractor("Authorization", "Bearer"),
			gdhttp.NewHeaderExtractor("Authorization", "sso-jwt"),
			gdhttp.NewCookieExtractor("auth_idp"),
		),
	)
	if err != nil {
		slog.Error("goauth.init.cert_handler_failed", "error", err)
		m.authenticateCertOnly = reject
	} else {
		m.authenticateCertOnly = certOnly
	}

	slog.Debug("goauth.init", "auth_type", authType, "sso_host", ssoHost)
	return m
}

// Authenticate returns HTTP middleware that validates any GoDaddy SSO token.
// Default extractors: Authorization: sso-jwt <token> and auth_idp cookie (see gdhttp.NewHandler).
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

// AuthenticateAWSIAMService validates service SSO JWTs from Authorization: Bearer (GoCode S2S)
// or Authorization: sso-jwt. Allowed kinds: AWS IAM, Cert, Cert2S delegation (see gdtoken).
func (m *Middleware) AuthenticateAWSIAMService(next http.Handler) http.Handler {
	return m.authenticateAWSIAMSvc(next)
}

// AuthenticateCert requires a certificate-class SSO JWT (Cert or Cert2S delegation).
// Token extractors: Authorization Bearer, Authorization sso-jwt, auth_idp cookie (first match wins, ModeDistinct).
func (m *Middleware) AuthenticateCert(next http.Handler) http.Handler {
	return m.authenticateCertOnly(next)
}
