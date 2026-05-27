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
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/hosting"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
	stripeclient "github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripe"
)

// newTestRouterServer returns a *Server populated for router-level tests.
// authType "none" bypasses gd-auth so handler-behavior tests don't need to
// mint real SSO tokens. Pass "jwt" to exercise the real auth path.
//
// Stripe, Sandboxes, and Secrets default to test doubles so tests that
// don't care about them (e.g. /health) get sensible defaults. Tests that
// want to assert push behavior override srv.Secrets with a fake that
// records calls or returns an error.
func newTestRouterServer(env, version, authType string) *Server {
	return &Server{
		Environment: env,
		Version:     version,
		Auth:        goauth.NewMiddleware(authType, "sso.dev-godaddy.com"),
		Stripe:      &fakeStripe{},
		Sandboxes:   newFakeStore(),
		Secrets:     &fakeSecretsPusher{},
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
	byApp          map[string][]store.Sandbox
	bySandboxID    map[string]store.Sandbox
	puts           []store.Sandbox
	updates        []fakeStoreUpdate
	putErr         error
	queryErr       error
	updateErr      error
	updateNotFound bool
}

type fakeStoreUpdate struct {
	SandboxID     string
	ClaimStatus   store.ClaimStatus
	LiveAccountID string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		byApp:       map[string][]store.Sandbox{},
		bySandboxID: map[string]store.Sandbox{},
	}
}

func (f *fakeStore) Put(_ context.Context, s store.Sandbox) error {
	if f.putErr != nil {
		return f.putErr
	}
	f.puts = append(f.puts, s)
	f.byApp[s.AppID] = append(f.byApp[s.AppID], s)
	f.bySandboxID[s.SandboxID] = s
	return nil
}

func (f *fakeStore) QueryByAppID(_ context.Context, appID string) ([]store.Sandbox, error) {
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	return f.byApp[appID], nil
}

func (f *fakeStore) UpdateClaimStatus(_ context.Context, sandboxID string, status store.ClaimStatus, liveAccountID string) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	if f.updateNotFound {
		return store.ErrSandboxNotFound
	}
	f.updates = append(f.updates, fakeStoreUpdate{SandboxID: sandboxID, ClaimStatus: status, LiveAccountID: liveAccountID})
	return nil
}

// fakeSecretsPusher is an api-package test double for the secretsPusher
// interface (subset of hosting.Client). Records call args so tests can
// assert the exact bulk-operations payload, and surfaces an error when
// pushErr is set.
type fakeSecretsPusher struct {
	calls   int
	lastApp string
	lastOps []hosting.SecretOp
	pushErr error
}

func (f *fakeSecretsPusher) UpdateSecrets(_ context.Context, appID string, ops []hosting.SecretOp) error {
	f.calls++
	f.lastApp = appID
	f.lastOps = ops
	return f.pushErr
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

// --- Secrets push (hosting integration) ---

// stripeSandboxFixture is the Stripe-side response we feed into postSandboxes
// for push tests. Kept here so the per-test setup is concise.
var stripeSandboxFixture = stripeclient.Sandbox{
	SandboxID:      "cbsbx_fake_X",
	AccountID:      "acct_fake_X",
	PublishableKey: "pk_test_fake_X",
	SecretKey:      "sk_test_fake_X",
	MCPKey:         "ek_test_fake_X",
	ClaimURL:       "https://dashboard.stripe.com/fake-claim/cbsbx_fake_X",
}

// TestPostSandboxes_PushesAllFiveOps_OnFreshCreate pins the on-the-wire
// shape: hosting must receive five ops (MCP protected, sk preview, sk publish,
// pk preview, pk publish), with the right routing flags and the right
// values. This is the load-bearing assertion for the
// "preview never sees live keys" invariant we'll add at go-live.
func TestPostSandboxes_PushesAllFiveOps_OnFreshCreate(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.Stripe.(*fakeStripe).out = stripeSandboxFixture
	pusher := &fakeSecretsPusher{}
	srv.Secrets = pusher
	h := NewRouter(srv)

	body := `{"appId":"app-1","email":"a@b.c","country":"US"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status: want 201, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if pusher.calls != 1 {
		t.Fatalf("Secrets.UpdateSecrets calls: want 1, got %d", pusher.calls)
	}
	if pusher.lastApp != "app-1" {
		t.Errorf("appId: want app-1, got %q", pusher.lastApp)
	}
	if len(pusher.lastOps) != 5 {
		t.Fatalf("ops count: want 5, got %d", len(pusher.lastOps))
	}

	// Index ops by (name, variant) so order doesn't make the assertion brittle.
	type key struct {
		name, variant string
	}
	byKey := map[key]hosting.SecretOp{}
	for _, op := range pusher.lastOps {
		v := ""
		if len(op.Secret.Variants) == 1 {
			v = op.Secret.Variants[0]
		}
		byKey[key{op.Secret.Name, v}] = op
	}

	mcp, ok := byKey[key{"STRIPE_MCP_KEY", ""}]
	if !ok {
		t.Fatalf("missing MCP op (no variant); got keys=%+v", byKey)
	}
	if mcp.Secret.Protected == nil || !*mcp.Secret.Protected {
		t.Errorf("MCP op must set protected:true; got %+v", mcp.Secret.Protected)
	}
	if mcp.Secret.Value != "ek_test_fake_X" {
		t.Errorf("MCP value: want ek_test_fake_X, got %q", mcp.Secret.Value)
	}
	if !mcp.Secret.SystemManaged {
		t.Errorf("MCP op should be systemManaged")
	}
	if len(mcp.Secret.Variants) != 0 {
		t.Errorf("MCP op should not carry variants (protected supersedes); got %v", mcp.Secret.Variants)
	}

	// Assert each variant op carries the right Stripe-issued value.
	// Decoupling values per-variant lets the go-live follow-up flip
	// publish to *_live_* without changing this test's preview rows.
	wantValues := map[key]string{
		{"STRIPE_SECRET_KEY", "preview"}:      stripeSandboxFixture.SecretKey,
		{"STRIPE_SECRET_KEY", "publish"}:      stripeSandboxFixture.SecretKey,
		{"STRIPE_PUBLISHABLE_KEY", "preview"}: stripeSandboxFixture.PublishableKey,
		{"STRIPE_PUBLISHABLE_KEY", "publish"}: stripeSandboxFixture.PublishableKey,
	}
	for k, wantVal := range wantValues {
		op, ok := byKey[k]
		if !ok {
			t.Errorf("missing op for %+v", k)
			continue
		}
		if op.Secret.Value != wantVal {
			t.Errorf("op %+v value: want %q, got %q", k, wantVal, op.Secret.Value)
		}
		if op.Secret.Protected != nil && *op.Secret.Protected {
			t.Errorf("non-MCP op %+v should not be protected", k)
		}
		if !op.Secret.SystemManaged {
			t.Errorf("op %+v should be systemManaged", k)
		}
	}

	// Sandbox row was persisted only after a successful push.
	if puts := srv.Sandboxes.(*fakeStore).puts; len(puts) != 1 {
		t.Errorf("store.puts: want 1 after successful push, got %d", len(puts))
	}
}

// TestPostSandboxes_502OnSecretsPushFailure pins the failure semantics:
// if hosting rejects the push, we MUST NOT persist the DDB row (would leave
// the agent thinking the sandbox is ready while the alloc env has no keys),
// MUST return 502 with code SECRETS_PUSH_FAILED so the agent retries, and
// MUST NOT have called Stripe more than once (no retry-on-Stripe-side here).
func TestPostSandboxes_502OnSecretsPushFailure(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.Stripe.(*fakeStripe).out = stripeSandboxFixture
	pusher := &fakeSecretsPusher{pushErr: errors.New("hosting boom")}
	srv.Secrets = pusher
	h := NewRouter(srv)

	body := `{"appId":"app-1"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "SECRETS_PUSH_FAILED") {
		t.Errorf("body should mention SECRETS_PUSH_FAILED; got %q", rec.Body.String())
	}
	if pusher.calls != 1 {
		t.Errorf("pusher.calls: want 1, got %d", pusher.calls)
	}
	if puts := srv.Sandboxes.(*fakeStore).puts; len(puts) != 0 {
		t.Errorf("store.puts: want 0 after push failure, got %d", len(puts))
	}
}

// TestBuildSecretsOps_FiveOpShape pins the canonical wire shape for the
// hosting bulk push: 5 ops, MCP protected, sk/pk × {preview, publish}.
// Each variant op MUST carry the value the caller passed for that key —
// at sandbox creation both variants get the *_test_* value; at go-live the
// caller will pair *_live_* (publish) with *_test_* (preview) keeping
// preview test-mode forever. This test pins the shape so a future refactor
// of buildSecretsOps can't silently drop a variant op or swap values.
func TestBuildSecretsOps_FiveOpShape(t *testing.T) {
	ops := buildSecretsOps("sk_test_X", "pk_test_X", "ek_test_X")
	if len(ops) != 5 {
		t.Fatalf("ops count: want 5, got %d", len(ops))
	}

	type key struct {
		name, variant string
	}
	byKey := map[key]hosting.SecretOp{}
	for _, op := range ops {
		v := ""
		if len(op.Secret.Variants) == 1 {
			v = op.Secret.Variants[0]
		}
		byKey[key{op.Secret.Name, v}] = op
	}

	// MCP: protected, no variants, value pinned.
	mcp, ok := byKey[key{"STRIPE_MCP_KEY", ""}]
	if !ok {
		t.Fatalf("missing MCP op (no variant); got keys=%+v", byKey)
	}
	if mcp.Secret.Protected == nil || !*mcp.Secret.Protected {
		t.Errorf("MCP op must set protected:true")
	}
	if len(mcp.Secret.Variants) != 0 {
		t.Errorf("MCP op should not carry variants (protected supersedes); got %v", mcp.Secret.Variants)
	}
	if mcp.Secret.Value != "ek_test_X" {
		t.Errorf("MCP value: want ek_test_X, got %q", mcp.Secret.Value)
	}

	// sk/pk × {preview, publish}: variant-scoped, no protected, exact values.
	wantValues := map[key]string{
		{"STRIPE_SECRET_KEY", "preview"}:      "sk_test_X",
		{"STRIPE_SECRET_KEY", "publish"}:      "sk_test_X",
		{"STRIPE_PUBLISHABLE_KEY", "preview"}: "pk_test_X",
		{"STRIPE_PUBLISHABLE_KEY", "publish"}: "pk_test_X",
	}
	for k, wantVal := range wantValues {
		op, ok := byKey[k]
		if !ok {
			t.Errorf("missing op for %+v", k)
			continue
		}
		if op.Secret.Value != wantVal {
			t.Errorf("op %+v value: want %q, got %q", k, wantVal, op.Secret.Value)
		}
		if op.Secret.Protected != nil {
			t.Errorf("op %+v: non-MCP ops should leave Protected nil; got %+v",
				k, op.Secret.Protected)
		}
		if !op.Secret.SystemManaged {
			t.Errorf("op %+v should be systemManaged", k)
		}
	}
}
