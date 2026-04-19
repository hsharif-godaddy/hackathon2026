package auth

import (
	"log/slog"
	"net/http"

	"github.com/gdcorp-golang/auth/gdhttp"
	"github.com/gdcorp-golang/auth/gdsso"
	"github.com/gdcorp-golang/auth/gdtoken"
	"github.com/gorilla/mux"
)

// highRiskRoutes maps "METHOD /path/template" to true for routes classified as
// HIGH RISK per the mhp-airo Management API Auth Classification. These require
// SecurityLevelHigh (HBI-based, 12h) instead of the default SecurityLevelLow.
var highRiskRoutes = map[string]bool{
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps":                       true,
	"PATCH /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}":              true,
	"DELETE /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}":             true,
	"PUT /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/deploy":         true,
	"PUT /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/publish":        true,
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/unpublish":     true,
	"POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/secrets":       true,
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

	m.lowRisk, err = gdhttp.NewHandler(validator,
		gdhttp.WithRequirements(gdhttp.Active(gdtoken.Low)),
	)
	if err != nil {
		return nil, err
	}

	m.highRisk, err = gdhttp.NewHandler(validator,
		gdhttp.WithRequirements(gdhttp.Active(gdtoken.High)),
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
