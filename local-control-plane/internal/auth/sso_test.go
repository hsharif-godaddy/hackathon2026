package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestSSOMiddleware_AuthDisabled(t *testing.T) {
	t.Parallel()

	mw, err := NewSSOMiddleware("none", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	handler := mw.Authenticate(okHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (auth disabled), got %d", rec.Code)
	}
}

func TestSSOMiddleware_MissingToken(t *testing.T) {
	t.Parallel()

	mw, err := newTestSSOMiddleware(t)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	r := mux.NewRouter()
	r.Handle("/api/airo/v1/customers/me", mw.Authenticate(okHandler())).Methods("GET")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/airo/v1/customers/me", nil)
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

// AuthenticateOptional must let unauthenticated requests through (so the
// existing public /signup behavior is preserved) — even with AUTH_TYPE=jwt,
// callers without a cookie should reach the handler unchanged.
func TestSSOMiddleware_AuthenticateOptional_NoToken(t *testing.T) {
	t.Parallel()

	mw, err := newTestSSOMiddleware(t)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	handler := mw.AuthenticateOptional(okHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/airo/v1/signup", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (optional auth, no token), got %d", rec.Code)
	}
}

// AuthenticateOptional must propagate the lowRisk-authenticated request to
// next on the success path, so the handler observes whatever context the
// validator put in (token, customer ID, etc.). Constructed with a stub
// lowRisk so we don't need a real SSO server to mint a token — the test
// targets the sentinel-capture + request-substitution plumbing, which is
// the bit that wouldn't be caught by the failure-path tests if it regressed.
func TestSSOMiddleware_AuthenticateOptional_PropagatesAuthedContext(t *testing.T) {
	t.Parallel()

	type ctxKey string
	const markerKey ctxKey = "marker"

	stubLowRisk := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), markerKey, "authed")
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}

	mw := &SSOMiddleware{authType: "jwt", lowRisk: stubLowRisk}

	var captured any
	handler := mw.AuthenticateOptional(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Context().Value(markerKey)
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/airo/v1/signup", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if captured != "authed" {
		t.Errorf("expected authed-ctx propagated to next handler, got %v", captured)
	}
}

// With AUTH_TYPE=none, AuthenticateOptional is a passthrough.
func TestSSOMiddleware_AuthenticateOptional_AuthDisabled(t *testing.T) {
	t.Parallel()

	mw, err := NewSSOMiddleware("none", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	handler := mw.AuthenticateOptional(okHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/airo/v1/signup", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (auth disabled), got %d", rec.Code)
	}
}

func TestHighRiskRoutes_Coverage(t *testing.T) {
	t.Parallel()

	expected := []struct {
		method string
		path   string
	}{
		{"POST", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps"},
		{"PATCH", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}"},
		{"DELETE", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}"},
		{"PUT", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/deploy"},
		{"PUT", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/publish"},
		{"POST", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/unpublish"},
		{"POST", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/secrets"},
		{"POST", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/reload"},
		{"POST", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/exports"},
		{"PUT", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/project-domain"},
		{"PUT", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domains"},
		{"PUT", "/api/airo/v1/subscriptions/{subId}/entitlement"},
		{"POST", "/api/airo/v1/subscriptions/{subId}/builder-plan"},
		{"PATCH", "/api/airo/v1/subscriptions/{subId}"},
		{"POST", "/api/airo/v1/apps/{appId}/transfer/initiate"},
		{"DELETE", "/api/airo/v1/apps/{appId}/transfer"},
		{"POST", "/api/airo/v1/transfer/accept"},
		{"POST", "/api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/purge-cache"},
	}

	for _, tc := range expected {
		key := tc.method + " " + tc.path
		if !highRiskRoutes[key] {
			t.Errorf("expected high-risk route: %s", key)
		}
	}

	if len(highRiskRoutes) != len(expected) {
		t.Errorf("expected %d high-risk routes, got %d", len(expected), len(highRiskRoutes))
	}
}

func TestHighRiskRoutes_ReadOnlyNotIncluded(t *testing.T) {
	t.Parallel()

	readOnlyRoutes := []string{
		"GET /api/airo/v1/customers/me",
		"GET /api/airo/v1/subscriptions/{subId}",
		"GET /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}",
		"GET /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domain-job",
		"GET /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/domain-dns-ownership",
		"GET /api/airo/v1/jobs/{jobId}",
		"GET /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/secrets",
	}

	for _, key := range readOnlyRoutes {
		if highRiskRoutes[key] {
			t.Errorf("read-only route should not be high-risk: %s", key)
		}
	}
}

// newTestSSOMiddleware creates an SSOMiddleware configured for testing.
// It uses a local HTTP server that returns valid SSO public key responses.
func newTestSSOMiddleware(t *testing.T) (*SSOMiddleware, error) {
	t.Helper()

	// Start a mock SSO server that returns 404 for key lookups,
	// which will cause signature validation to fail for any token.
	// This is sufficient to test that missing tokens get 401.
	ssoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	t.Cleanup(ssoServer.Close)

	return NewSSOMiddleware("jwt", ssoServer.URL)
}
