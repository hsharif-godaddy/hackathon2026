package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
)

// newTestRouterServer returns a *Server populated for router-level tests.
// authType "none" bypasses gd-auth so handler-behavior tests don't need to
// mint real SSO tokens. Pass "jwt" to exercise the real auth path.
//
// Stripe and Sandboxes default to a zero-value fakeStripe / empty fakeStore
// so tests that don't care about them (e.g. /health) get sensible defaults.
func newTestRouterServer(env, version, authType string) *Server {
	return &Server{
		Environment: env,
		Version:     version,
		Auth:        goauth.NewMiddleware(authType, "sso.dev-godaddy.com"),
		Stripe:      &fakeStripe{},
		Sandboxes:   newFakeStore(),
	}
}

// fakeStripe is an api-package test double for stripeclient.Client.
type fakeStripe struct {
	out       stripeclient.Sandbox
	err       error
	callCount int
	lastInput stripeclient.CreateSandboxInput
}

func (f *fakeStripe) CreateClaimableSandbox(_ context.Context, in stripeclient.CreateSandboxInput) (stripeclient.Sandbox, error) {
	f.callCount++
	f.lastInput = in
	return f.out, f.err
}

// fakeStore is a test double for the api-internal sandboxStore interface.
type fakeStore struct {
	byApp    map[string][]store.Sandbox
	puts     []store.Sandbox
	putErr   error
	queryErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		byApp: map[string][]store.Sandbox{},
	}
}

func (f *fakeStore) Put(_ context.Context, s store.Sandbox) error {
	if f.putErr != nil {
		return f.putErr
	}
	f.puts = append(f.puts, s)
	f.byApp[s.AppID] = append(f.byApp[s.AppID], s)
	return nil
}

func (f *fakeStore) QueryByAppID(_ context.Context, appID string) ([]store.Sandbox, error) {
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	return f.byApp[appID], nil
}

// TestPostSandboxesRequiresAuth — auth layer rejects before handler logic runs.
func TestPostSandboxesRequiresAuth(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "jwt")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: want 401 with no Authorization header, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestHealthUnauthenticatedEvenWhenJwtEnforced(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "jwt")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("/health should be public; got %d", rec.Code)
	}
}

func TestPostSandboxes_Creates_WhenNoExistingSandbox(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	stripe := srv.Stripe.(*fakeStripe)
	// Stripe returns all three keys (sk/pk/mcp); setting them here
	// exercises the "don't persist them" path in the handler.
	stripe.out = stripeclient.Sandbox{
		SandboxID:      "cbsbx_fake_X",
		AccountID:      "acct_fake_X",
		PublishableKey: "pk_test_fake_X",
		SecretKey:      "sk_test_fake_X",
		MCPKey:         "ek_test_fake_X",
		ClaimURL:       "https://dashboard.stripe.com/fake-claim/cbsbx_fake_X",
	}
	st := srv.Sandboxes.(*fakeStore)
	h := NewRouter(srv)

	body := `{"appId":"app-1","email":"a@b.c","country":"US"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status: want 201, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp sandboxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.SandboxID != "cbsbx_fake_X" || resp.AccountID != "acct_fake_X" || !strings.HasSuffix(resp.ClaimURL, "cbsbx_fake_X") {
		t.Errorf("response body unexpected: %+v", resp)
	}
	if stripe.callCount != 1 {
		t.Errorf("stripe.callCount: want 1, got %d", stripe.callCount)
	}
	if stripe.lastInput.AppID != "app-1" || stripe.lastInput.Email != "a@b.c" || stripe.lastInput.Country != "US" {
		t.Errorf("stripe input forwarded wrong: %+v", stripe.lastInput)
	}
	if len(st.puts) != 1 {
		t.Fatalf("store.puts: want 1, got %d", len(st.puts))
	}
	p := st.puts[0]
	if p.AppID != "app-1" {
		t.Errorf("persisted AppID: want app-1, got %q", p.AppID)
	}
	if p.ClaimStatus != store.ClaimStatusProvisioned {
		t.Errorf("persisted ClaimStatus: want provisioned, got %q", p.ClaimStatus)
	}
	if p.CreatedAt.IsZero() || p.UpdatedAt.IsZero() {
		t.Errorf("timestamps should be non-zero; got %v / %v", p.CreatedAt, p.UpdatedAt)
	}
	if time.Since(p.CreatedAt) > time.Minute {
		t.Errorf("CreatedAt should be recent; got %v", p.CreatedAt)
	}
}

func TestPostSandboxes_ReturnsExisting_WhenSandboxExistsForApp(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	stripe := srv.Stripe.(*fakeStripe)
	st := srv.Sandboxes.(*fakeStore)
	existing := store.Sandbox{
		SandboxID: "cbsbx_fake_existing",
		AppID:     "app-1",
		AccountID: "acct_fake_existing",
		ClaimURL:  "https://dashboard.stripe.com/fake-claim/cbsbx_fake_existing",
	}
	st.byApp["app-1"] = []store.Sandbox{existing}
	h := NewRouter(srv)

	body := `{"appId":"app-1","email":"a@b.c","country":"US"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 (idempotent), got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp sandboxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.SandboxID != "cbsbx_fake_existing" {
		t.Errorf("response.SandboxID: want existing, got %q", resp.SandboxID)
	}
	if stripe.callCount != 0 {
		t.Errorf("stripe.callCount: want 0 on idempotent path, got %d", stripe.callCount)
	}
	if len(st.puts) != 0 {
		t.Errorf("store.puts: want 0 on idempotent path, got %d", len(st.puts))
	}
}

func TestPostSandboxes_RejectsMissingAppID(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"email":"a@b.c"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MISSING_APP_ID") {
		t.Errorf("body should mention MISSING_APP_ID; got %q", rec.Body.String())
	}
}

func TestPostSandboxes_RejectsInvalidJSON(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{not valid json`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("body should mention INVALID_JSON; got %q", rec.Body.String())
	}
}

func TestPostSandboxes_PropagatesStripeError(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.Stripe.(*fakeStripe).err = errors.New("stripe boom")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"appId":"app-1"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502 on stripe failure, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestPostSandboxes_PropagatesStoreQueryError(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.Sandboxes.(*fakeStore).queryErr = errors.New("ddb query boom")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"appId":"app-1"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500 on store query failure, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "STORE_QUERY_FAILED") {
		t.Errorf("body should mention STORE_QUERY_FAILED; got %q", rec.Body.String())
	}
	// Stripe must not have been called when the pre-check failed.
	if srv.Stripe.(*fakeStripe).callCount != 0 {
		t.Errorf("stripe.callCount: want 0 after store query failure, got %d", srv.Stripe.(*fakeStripe).callCount)
	}
}

func TestPostSandboxes_PropagatesStorePutError(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.Stripe.(*fakeStripe).out = stripeclient.Sandbox{
		SandboxID: "cbsbx_fake_X",
		AccountID: "acct_fake_X",
		ClaimURL:  "https://example.com/fake-claim/cbsbx_fake_X",
	}
	srv.Sandboxes.(*fakeStore).putErr = errors.New("ddb put boom")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"appId":"app-1"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500 on store put failure, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "STORE_PUT_FAILED") {
		t.Errorf("body should mention STORE_PUT_FAILED; got %q", rec.Body.String())
	}
	// Stripe *was* called (the failure is downstream); this is the
	// "orphaned Stripe sandbox" case the design accepts per §6.1.
	if srv.Stripe.(*fakeStripe).callCount != 1 {
		t.Errorf("stripe.callCount: want 1 (create ran before put failed), got %d", srv.Stripe.(*fakeStripe).callCount)
	}
}

func TestPostSandboxes_RejectsOversizedBody(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	// Slightly over the 1 MiB cap — pad an otherwise-valid body with a
	// long ignored field. http.MaxBytesReader fails the decode with
	// *http.MaxBytesError before the handler ever sees the payload.
	pad := strings.Repeat("a", (1<<20)+1)
	body := `{"appId":"app-1","email":"a@b.c","_pad":"` + pad + `"}`

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status: want 413 on oversized body, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "PAYLOAD_TOO_LARGE") {
		t.Errorf("body should mention PAYLOAD_TOO_LARGE; got %q", rec.Body.String())
	}
	// Stripe and store must not be touched when the body is rejected.
	if srv.Stripe.(*fakeStripe).callCount != 0 {
		t.Errorf("stripe.callCount: want 0 on oversized body, got %d", srv.Stripe.(*fakeStripe).callCount)
	}
}

func TestPostSandboxes_RejectsUnknownFields(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	// An unrecognized field should be rejected by DisallowUnknownFields.
	// Note: Go's JSON decoder does case-insensitive struct-field matching
	// by default, so e.g. "appID" would quietly alias to AppID — the guard
	// only catches fields that don't match any case-insensitive variant.
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"appId":"app-1","typoed_field":"x"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 on unknown field, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("body should mention INVALID_JSON; got %q", rec.Body.String())
	}
}

func TestGetStatus_ReturnsSandbox(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	st := srv.Sandboxes.(*fakeStore)
	st.byApp["app-1"] = []store.Sandbox{{
		SandboxID:   "cbsbx_fake_abc",
		AppID:       "app-1",
		ClaimStatus: store.ClaimStatusProvisioned,
	}}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status?appId=app-1", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.SandboxID != "cbsbx_fake_abc" {
		t.Errorf("SandboxID: want cbsbx_fake_abc, got %q", resp.SandboxID)
	}
	if resp.ClaimStatus != store.ClaimStatusProvisioned {
		t.Errorf("ClaimStatus: want provisioned, got %q", resp.ClaimStatus)
	}
	if resp.LiveAccountID != "" {
		t.Errorf("LiveAccountID should be empty pre-claim; got %q", resp.LiveAccountID)
	}
	// omitempty: liveAccountId should not appear at all in the raw body.
	if strings.Contains(rec.Body.String(), "liveAccountId") {
		t.Errorf("body should omit liveAccountId when empty; got %q", rec.Body.String())
	}
}

func TestGetStatus_ReturnsLiveAccountID_WhenPresent(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	st := srv.Sandboxes.(*fakeStore)
	st.byApp["app-1"] = []store.Sandbox{{
		SandboxID:     "cbsbx_fake_abc",
		AppID:         "app-1",
		ClaimStatus:   store.ClaimStatusLive,
		LiveAccountID: "acct_live_xyz",
	}}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status?appId=app-1", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"liveAccountId":"acct_live_xyz"`) {
		t.Errorf("body should include liveAccountId when set; got %q", rec.Body.String())
	}
}

func TestGetStatus_404WhenNone(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status?appId=missing", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", rec.Code)
	}
}

func TestGetStatus_400WhenMissingAppID(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "MISSING_APP_ID") {
		t.Errorf("body should mention MISSING_APP_ID; got %q", rec.Body.String())
	}
}

func TestGetStatus_500OnStoreQueryError(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.Sandboxes.(*fakeStore).queryErr = errors.New("ddb query boom")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status?appId=app-1", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500 on store failure, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "STORE_QUERY_FAILED") {
		t.Errorf("body should mention STORE_QUERY_FAILED; got %q", rec.Body.String())
	}
}
