package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gdcorp-golang/auth/gdhttp"
	"github.com/gdcorp-golang/auth/gdsso"
	"github.com/gdcorp-golang/auth/gdtoken"
	"github.com/gorilla/mux"
)

// hbiWindow matches the production frontdoor's `use-12hr-strategy: optin`
// setting for `/api/airo/` write routes (pioneermgmt config.yml). Without
// this, gdtoken.High enforces a 1-hour HBI window which is stricter than
// what production accepts and forces users to re-authenticate hourly.
const hbiWindow = 12 * time.Hour

var errHbiExpired = errors.New("token HBI claim is expired or missing")

// activeHighWith12HrHbi matches production's level-3 + 12hr-strategy gating.
// Only "basic" customer/employee/pass tokens carry HBI claims and get the
// 12-hour window. All other kinds (delegation chains, cert, AWSIAM, OAuth,
// etc.) have no HBI claim by design -- CLAUDE.md documents e2s as "2 hours
// (no HBI)" -- so they delegate to gdtoken.High, which applies each kind's
// documented expiry rules.
func activeHighWith12HrHbi() gdhttp.Requirement {
	return gdhttp.RequirementFunc(func(_ context.Context, token *gdtoken.Token) error {
		kind := token.Kind()
		hasHbi := kind == gdtoken.ShopperKind || kind == gdtoken.EmployeeKind || kind == gdtoken.PassKind
		if !hasHbi {
			if token.IsExpired(gdtoken.High) {
				return errHbiExpired
			}
			return nil
		}

		base := token.BaseToken
		if base.ExpiresAtTime > 0 && time.Unix(base.ExpiresAtTime, 0).Before(time.Now().UTC()) {
			return errHbiExpired
		}
		if base.HbiClaim == 0 {
			return errHbiExpired
		}
		if time.Unix(base.HbiClaim, 0).Add(hbiWindow).Before(time.Now().UTC()) {
			return errHbiExpired
		}
		return nil
	})
}

// highRiskRoutes maps "METHOD /path/template" to true for routes classified as
// HIGH RISK per the mhp-airo Management API Auth Classification. These require
// SecurityLevelHigh (HBI-based, 12h) instead of the default SecurityLevelLow.
// Secrets GET+POST are both HBI so a stale JWT surfaces 401 at read time,
// triggering SSO re-auth before any token-refresh burns a single-use token.
var highRiskRoutes = map[string]bool{
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps":                       true,
	"PATCH /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}":              true,
	"DELETE /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}":             true,
	"PUT /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/deploy":         true,
	"PUT /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/publish":        true,
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/unpublish":     true,
	"GET /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/secrets":        true,
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/secrets":       true,
	"GET /hosting/v1/apps/{appId}/secrets":                                               true,
	"POST /hosting/v1/apps/{appId}/secrets":                                              true,
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/reload":        true,
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/exports":       true,
	"PUT /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/project-domain": true,
	"PUT /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domains":        true,
	"PUT /api/airo/v1/subscriptions/{subId}/entitlement":                                 true,
	"POST /api/airo/v1/subscriptions/{subId}/builder-plan":                               true,
	"PATCH /api/airo/v1/subscriptions/{subId}":                                           true,
	"POST /api/airo/v1/apps/{appId}/transfer/initiate":                                   true,
	"DELETE /api/airo/v1/apps/{appId}/transfer":                                          true,
	"POST /api/airo/v1/transfer/accept":                                                  true,
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/purge-cache":   true,
}

// SSOMiddleware wraps gdhttp auth handlers for low-risk and high-risk routes.
type SSOMiddleware struct {
	authType string
	lowRisk  func(http.Handler) http.Handler
	highRisk func(http.Handler) http.Handler
}

// NewSSOMiddleware creates auth middleware for GoDaddy SSO JWT validation.
// authType "jwt" enables validation; "none" passes all requests through.
func NewSSOMiddleware(authType, ssoHost string) (*SSOMiddleware, error) {
	m := &SSOMiddleware{authType: authType}

	if authType != "jwt" {
		slog.Debug("sso.auth.disabled")
		return m, nil
	}

	client, err := gdsso.NewClient(gdsso.WithHost(ssoHost))
	if err != nil {
		return nil, err
	}
	validator := gdsso.NewValidator(client)

	m.lowRisk, err = gdhttp.NewHandler(
		validator,
		gdhttp.WithRequirements(gdhttp.Active(gdtoken.Low)),
	)
	if err != nil {
		return nil, err
	}

	m.highRisk, err = gdhttp.NewHandler(
		validator,
		gdhttp.WithRequirements(activeHighWith12HrHbi()),
	)
	if err != nil {
		return nil, err
	}

	slog.Info("sso.auth.enabled", "sso_host", ssoHost)
	return m, nil
}

// Authenticate is gorilla/mux-compatible middleware. It determines risk level
// from the matched route template and applies the appropriate handler.
func (m *SSOMiddleware) Authenticate(next http.Handler) http.Handler {
	if m.authType != "jwt" {
		return next
	}

	lowRisk := m.lowRisk(next)
	highRisk := m.highRisk(next)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		route := mux.CurrentRoute(r)
		if route == nil {
			lowRisk.ServeHTTP(w, r)
			return
		}

		tmpl, err := route.GetPathTemplate()
		if err != nil {
			lowRisk.ServeHTTP(w, r)
			return
		}

		key := r.Method + " " + tmpl
		if highRiskRoutes[key] {
			slog.Debug("sso.auth.high_risk", "method", r.Method, "path", tmpl)
			highRisk.ServeHTTP(w, r)
		} else {
			lowRisk.ServeHTTP(w, r)
		}
	})
}

// AuthenticateOptional validates the SSO token if one is present and propagates
// the resulting context to next; if no token is supplied (or validation fails)
// it still calls next without any token context, so customerIDFromRequest falls
// back to DefaultCustomerID. This exists for the public /signup route, which
// production mgmt-airo always sees with an SSO session — locally we want both:
// authenticated callers (so DPP-shape repros land under the real shopper) and
// unauthenticated callers (so existing scripts keep working).
func (m *SSOMiddleware) AuthenticateOptional(next http.Handler) http.Handler {
	if m.authType != "jwt" {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var authedReq *http.Request
		sentinel := http.HandlerFunc(func(_ http.ResponseWriter, ar *http.Request) {
			authedReq = ar
		})

		// Discard whatever the lowRisk handler writes — it will write 401 if
		// the token is missing or invalid, and we want to swallow that and
		// proceed unauthenticated rather than reject the request. Capture the
		// status so we can emit a debug breadcrumb when a cookie was sent but
		// rejected (the stale-AIRO_COOKIE case during local DPP testing).
		drw := &discardingResponseWriter{}
		m.lowRisk(sentinel).ServeHTTP(drw, r)

		if authedReq != nil {
			next.ServeHTTP(w, authedReq)
			return
		}

		// Only log when a cookie was actually offered. No-cookie callers are
		// the documented happy path for unauthenticated /signup, and logging
		// every one of those would be noise.
		if drw.status >= 400 && r.Header.Get("Cookie") != "" {
			slog.Debug("sso.auth.optional.rejected", "status", drw.status)
		}
		next.ServeHTTP(w, r)
	})
}

// discardingResponseWriter swallows all writes. Used by AuthenticateOptional
// to suppress the lowRisk handler's 401 response when no token is present,
// while still letting the caller observe whether the lowRisk handler set a
// status (so it can distinguish "no token offered" from "token rejected").
type discardingResponseWriter struct {
	header http.Header
	status int
}

func (d *discardingResponseWriter) Header() http.Header {
	if d.header == nil {
		d.header = http.Header{}
	}
	return d.header
}

func (d *discardingResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (d *discardingResponseWriter) WriteHeader(code int) {
	if d.status == 0 {
		d.status = code
	}
}
