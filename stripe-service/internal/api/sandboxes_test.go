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
		Environment:         env,
		Version:             version,
		Auth:                goauth.NewMiddleware(authType, "sso.dev-godaddy.com"),
		Stripe:              &fakeStripe{},
		Sandboxes:           newFakeStore(),
		CustomerEmailLookup: &fakeEmailLookup{},
		Secrets:             &fakeSecretsPusher{},
	}
}

// fakeStripe is an api-package test double for stripeclient.Client.
// Stubs both methods so tests for either path (sandbox creation or
// live-key minting) can reuse the same fake. Tests that don't exercise
// MintLiveAPIKeys leave the mintOut/mintErr fields zero-valued.
type fakeStripe struct {
	// Sandbox-side fields (CreateClaimableSandbox).
	out       stripeclient.Sandbox
	err       error
	callCount int
	lastInput stripeclient.CreateSandboxInput

	// Live-key-side fields (MintLiveAPIKeys).
	mintOut       stripeclient.LiveAPIKeys
	mintErr       error
	mintCalls     int
	mintLastInput stripeclient.MintLiveAPIKeysInput

	// Renew-side fields (RenewOnboardingLink). Tests that don't exercise
	// renewal leave them zero; the stub returns the canned value or err
	// and records inputs for assertion.
	renewOut       stripeclient.RenewedOnboardingLink
	renewErr       error
	renewCalls     int
	renewLastInput stripeclient.RenewOnboardingLinkInput
}

func (f *fakeStripe) CreateClaimableSandbox(_ context.Context, in stripeclient.CreateSandboxInput) (stripeclient.Sandbox, error) {
	f.callCount++
	f.lastInput = in
	return f.out, f.err
}

func (f *fakeStripe) MintLiveAPIKeys(_ context.Context, in stripeclient.MintLiveAPIKeysInput) (stripeclient.LiveAPIKeys, error) {
	f.mintCalls++
	f.mintLastInput = in
	return f.mintOut, f.mintErr
}

func (f *fakeStripe) RenewOnboardingLink(_ context.Context, in stripeclient.RenewOnboardingLinkInput) (stripeclient.RenewedOnboardingLink, error) {
	f.renewCalls++
	f.renewLastInput = in
	return f.renewOut, f.renewErr
}

// fakeStore is a test double for the api-internal sandboxStore interface.
type fakeStore struct {
	byApp          map[string][]store.Sandbox
	bySandboxID    map[string]store.Sandbox
	puts           []store.Sandbox
	legacyPuts     []string
	updates        []fakeStoreUpdate
	urlUpdates     []fakeStoreURLUpdate
	putErr         error
	putLegacyErr   error
	queryErr       error
	updateErr      error
	updateNotFound bool
	urlUpdateErr   error
	getErr         error
}

type fakeStoreUpdate struct {
	SandboxID     string
	ClaimStatus   store.ClaimStatus
	LiveAccountID string
}

type fakeStoreURLUpdate struct {
	SandboxID string
	ClaimURL  string
	ExpiresAt time.Time
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

func (f *fakeStore) PutLegacy(_ context.Context, appID string) error {
	if f.putLegacyErr != nil {
		return f.putLegacyErr
	}
	f.legacyPuts = append(f.legacyPuts, appID)
	sb := store.Sandbox{
		SandboxID:   store.LegacySandboxID(appID),
		AppID:       appID,
		ClaimStatus: store.ClaimStatusLegacy,
	}
	f.byApp[appID] = append(f.byApp[appID], sb)
	f.bySandboxID[sb.SandboxID] = sb
	return nil
}

func (f *fakeStore) GetBySandboxID(_ context.Context, sandboxID string) (store.Sandbox, error) {
	if f.getErr != nil {
		return store.Sandbox{}, f.getErr
	}
	sb, ok := f.bySandboxID[sandboxID]
	if !ok {
		return store.Sandbox{}, store.ErrSandboxNotFound
	}
	return sb, nil
}

func (f *fakeStore) UpdateClaimURL(_ context.Context, sandboxID, claimURL string, expiresAt time.Time) error {
	if f.urlUpdateErr != nil {
		return f.urlUpdateErr
	}
	f.urlUpdates = append(f.urlUpdates, fakeStoreURLUpdate{
		SandboxID: sandboxID,
		ClaimURL:  claimURL,
		ExpiresAt: expiresAt,
	})
	if sb, ok := f.bySandboxID[sandboxID]; ok {
		sb.ClaimURL = claimURL
		sb.ClaimURLExpiresAt = expiresAt
		f.bySandboxID[sandboxID] = sb
	}
	return nil
}

// fakeEmailLookup is a test double for customerEmailLookup. Returns a
// fixed email by default; returns emailErr when set.
type fakeEmailLookup struct {
	email    string
	emailErr error
}

func (f *fakeEmailLookup) GetCustomerEmail(_ context.Context, _ string) (string, error) {
	if f.emailErr != nil {
		return "", f.emailErr
	}
	if f.email == "" {
		return "test@example.com", nil
	}
	return f.email, nil
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

	body := `{"appId":"app-1","customerId":"cust-1","country":"US"}`
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
	if stripe.lastInput.AppID != "app-1" {
		t.Errorf("stripe input AppID: want app-1, got %q", stripe.lastInput.AppID)
	}
	// Pin the security-critical injection: PrefillEmail must come from the
	// operator-configured fakeEmailLookup (test@example.com), NOT from any
	// caller-supplied value. PrefillCountry must come from the request body
	// (lowercased). If someone re-wires the handler to accept caller email, this fails.
	if stripe.lastInput.PrefillEmail != "test@example.com" {
		t.Errorf("stripe input PrefillEmail: want operator value from PIE (test@example.com), got %q — email must not come from the caller",
			stripe.lastInput.PrefillEmail)
	}
	if stripe.lastInput.PrefillCountry != "us" {
		t.Errorf("stripe input PrefillCountry: want lowercased caller country (us), got %q", stripe.lastInput.PrefillCountry)
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

	body := `{"appId":"app-1","customerId":"cust-1","country":"US"}`
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

// TestPostSandboxes_FailsClosedWhenCustomerIDMissing pins the security-critical
// fail-closed behavior: a request without customerId must return 400
// MISSING_CUSTOMER_EMAIL and must NOT call Stripe. This is the exact path that
// the temporary tempFallbackCustomerID commit broke (Iteration 8 [Critical]) —
// keeping it pinned ensures it can't regress silently.
func TestPostSandboxes_FailsClosedWhenCustomerIDMissing(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	stripe := srv.Stripe.(*fakeStripe)
	h := NewRouter(srv)

	body := `{"appId":"app-1","country":"US"}` // no customerId
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 (no customerId), got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MISSING_CUSTOMER_EMAIL") {
		t.Errorf("body should mention MISSING_CUSTOMER_EMAIL; got %q", rec.Body.String())
	}
	if stripe.callCount != 0 {
		t.Errorf("Stripe must not be called when customerId is missing; callCount=%d", stripe.callCount)
	}
}

// TestPostSandboxes_FailsClosedWhenEmailLookupErrors: PIE upstream failure
// returns 502 CUSTOMER_EMAIL_LOOKUP_FAILED (not 400 — the client sent valid
// input; the upstream dependency failed) and Stripe must not be called.
func TestPostSandboxes_FailsClosedWhenEmailLookupErrors(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.CustomerEmailLookup = &fakeEmailLookup{emailErr: errors.New("PIE unavailable")}
	stripe := srv.Stripe.(*fakeStripe)
	h := NewRouter(srv)

	body := `{"appId":"app-1","customerId":"cust-1","country":"US"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502 (upstream PIE error), got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "CUSTOMER_EMAIL_LOOKUP_FAILED") {
		t.Errorf("body should mention CUSTOMER_EMAIL_LOOKUP_FAILED; got %q", rec.Body.String())
	}
	if stripe.callCount != 0 {
		t.Errorf("Stripe must not be called when PIE lookup fails; callCount=%d", stripe.callCount)
	}
}

func TestPostSandboxes_RejectsMissingAppID(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MISSING_APP_ID") {
		t.Errorf("body should mention MISSING_APP_ID; got %q", rec.Body.String())
	}
}

// TestPostSandboxes_RejectsEmailField: email is not a valid request field.
// DisallowUnknownFields returns 400 INVALID_JSON for any caller still sending
// it, including old agents on main (those callers must be updated before this
// build is deployed to shared environments).
func TestPostSandboxes_RejectsEmailField(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	body := `{"appId":"app-1","customerId":"cust-1","country":"US","email":"victim@example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 (email is unknown field), got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("body should mention INVALID_JSON; got %q", rec.Body.String())
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

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"appId":"app-1","customerId":"cust-1","country":"US"}`))
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

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"appId":"app-1","customerId":"cust-1","country":"US"}`))
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

	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(`{"appId":"app-1","customerId":"cust-1","country":"US"}`))
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
	body := `{"appId":"app-1","_pad":"` + pad + `"}`

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

	body := `{"appId":"app-1","customerId":"cust-1","country":"US"}`
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
	if mcp.Secret.SystemManaged {
		t.Errorf("MCP op must NOT be systemManaged (consistent with sk/pk for customer-app #airo/secrets access)")
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
		if op.Secret.SystemManaged {
			t.Errorf("op %+v must NOT be systemManaged (customer-app #airo/secrets filters those out)", k)
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

	body := `{"appId":"app-1","customerId":"cust-1","country":"US"}`
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
		if op.Secret.SystemManaged {
			t.Errorf("op %+v must NOT be systemManaged (customer-app #airo/secrets filters those out)", k)
		}
	}
}

// TestBuildLiveSecretsOps_FourOpShape_WhenMCPSkipped: when MintLiveAPIKeys
// TestBuildLiveSecretsOps: always 5 ops — delete STRIPE_MCP_KEY (MCP is
// sandbox-only; live product management uses Stripe dashboard) + sk/pk on
// both preview and publish variants.
// expiry surfacing: getStatus and the create-201 path both echo
// expiresAt + claimUrlExpiresAt when the sandbox row carries them, and
// omit them when zero (so a row written before this schema landed
// doesn't surface a misleading 1970-01-01).
func TestGetStatus_SurfacesExpiry(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	st := srv.Sandboxes.(*fakeStore)
	expires := time.Date(2026, 8, 14, 10, 30, 0, 0, time.UTC)
	urlExp := time.Date(2026, 6, 22, 10, 30, 0, 0, time.UTC)
	st.byApp["app-1"] = []store.Sandbox{{
		SandboxID:         "cbsbx_fake_abc",
		AppID:             "app-1",
		ClaimStatus:       store.ClaimStatusProvisioned,
		ExpiresAt:         expires,
		ClaimURLExpiresAt: urlExp,
	}}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status?appId=app-1", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	var resp statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ExpiresAt != "2026-08-14T10:30:00Z" {
		t.Errorf("expiresAt: want 2026-08-14T10:30:00Z, got %q", resp.ExpiresAt)
	}
	if resp.ClaimURLExpiresAt != "2026-06-22T10:30:00Z" {
		t.Errorf("claimUrlExpiresAt: want 2026-06-22T10:30:00Z, got %q", resp.ClaimURLExpiresAt)
	}
}

func TestGetStatus_OmitsZeroExpiry(t *testing.T) {
	// A row predating this schema carries zero-time ExpiresAt /
	// ClaimURLExpiresAt fields. The wire shape must omit them so the
	// agent treats them as "unknown" rather than acting on 1970.
	srv := newTestRouterServer("dev", "0.0.0", "none")
	st := srv.Sandboxes.(*fakeStore)
	st.byApp["app-1"] = []store.Sandbox{{
		SandboxID:   "cbsbx_fake_old",
		AppID:       "app-1",
		ClaimStatus: store.ClaimStatusProvisioned,
	}}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status?appId=app-1", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "expiresAt") {
		t.Errorf("zero expiresAt should be omitted; got %q", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "claimUrlExpiresAt") {
		t.Errorf("zero claimUrlExpiresAt should be omitted; got %q", rec.Body.String())
	}
}

// Idempotent path: when the existing sandbox's onboarding URL is past
// (or near) expiry, postSandboxes auto-renews before handing the URL
// back. This is what stops the agent from rendering a stale claim
// link the user will time out on.
func TestPostSandboxes_AutoRenewsStaleClaimURL(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	st := srv.Sandboxes.(*fakeStore)
	stripe := srv.Stripe.(*fakeStripe)

	staleSandbox := store.Sandbox{
		SandboxID:         "cbsbx_fake_stale",
		AppID:             "app-1",
		ClaimURL:          "https://stripe.example/claim/old",
		ClaimStatus:       store.ClaimStatusProvisioned,
		ClaimURLExpiresAt: time.Now().Add(-1 * time.Hour), // already expired
	}
	st.byApp["app-1"] = []store.Sandbox{staleSandbox}
	st.bySandboxID[staleSandbox.SandboxID] = staleSandbox

	freshExp := time.Now().Add(7 * 24 * time.Hour).UTC().Truncate(time.Second)
	stripe.renewOut = stripeclient.RenewedOnboardingLink{
		ClaimURL:  "https://stripe.example/claim/fresh",
		ExpiresAt: freshExp,
	}

	body, _ := json.Marshal(createSandboxRequest{AppID: "app-1"})
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	NewRouter(srv).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 (idempotent), got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp sandboxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ClaimURL != "https://stripe.example/claim/fresh" {
		t.Errorf("ClaimURL: want renewed URL, got %q", resp.ClaimURL)
	}
	if stripe.renewCalls != 1 {
		t.Errorf("Stripe.renewCalls: want 1, got %d", stripe.renewCalls)
	}
	if len(st.urlUpdates) != 1 {
		t.Errorf("UpdateClaimURL: want 1 call, got %d", len(st.urlUpdates))
	}
}

// Renew-succeeds, persist-fails resilience path: Stripe minted a fresh
// URL but DDB UpdateClaimURL errored. The handler must still hand the
// agent the freshly-minted URL (and log the persist failure) — the
// alternative is sending back a Stripe-invalidated URL that won't work
// for the user. A future regression (e.g. moving the sb.ClaimURL
// assignment inside the else branch) would silently re-introduce the
// stale-link bug, so pin the behavior with a test.
func TestPostSandboxes_AutoRenew_ReturnsFreshURL_WhenPersistFails(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	st := srv.Sandboxes.(*fakeStore)
	stripe := srv.Stripe.(*fakeStripe)

	staleSandbox := store.Sandbox{
		SandboxID:         "cbsbx_fake_stale",
		AppID:             "app-1",
		ClaimURL:          "https://stripe.example/claim/old",
		ClaimStatus:       store.ClaimStatusProvisioned,
		ClaimURLExpiresAt: time.Now().Add(-1 * time.Hour),
	}
	st.byApp["app-1"] = []store.Sandbox{staleSandbox}
	st.bySandboxID[staleSandbox.SandboxID] = staleSandbox

	freshExp := time.Now().Add(7 * 24 * time.Hour).UTC().Truncate(time.Second)
	stripe.renewOut = stripeclient.RenewedOnboardingLink{
		ClaimURL:  "https://stripe.example/claim/fresh",
		ExpiresAt: freshExp,
	}
	// Force the DDB write to fail after Stripe has minted the new URL.
	st.urlUpdateErr = errors.New("ddb transient")

	body, _ := json.Marshal(createSandboxRequest{AppID: "app-1"})
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	NewRouter(srv).ServeHTTP(rec, req)

	// Response must still be 200 with the freshly-minted URL — the
	// old URL is invalidated server-side by Stripe and would 404.
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 even when persist fails, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp sandboxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ClaimURL != "https://stripe.example/claim/fresh" {
		t.Errorf("ClaimURL: want renewed URL on persist-failure path, got %q", resp.ClaimURL)
	}
	if resp.ClaimURLExpiresAt != freshExp.Format(time.RFC3339) {
		t.Errorf("ClaimURLExpiresAt: want %q, got %q", freshExp.Format(time.RFC3339), resp.ClaimURLExpiresAt)
	}
	// Stripe was hit exactly once and persist was attempted but
	// rejected — confirm the path that produces the divergent log line.
	if stripe.renewCalls != 1 {
		t.Errorf("Stripe.renewCalls: want 1, got %d", stripe.renewCalls)
	}
	if len(st.urlUpdates) != 0 {
		t.Errorf("urlUpdates: want 0 successful persists, got %d", len(st.urlUpdates))
	}
}

// Auto-renew is gated on (a) pre-claim status and (b) a known expiry
// near or past. Sandboxes that are already claimed/live (URL is moot)
// or that predate the expiry schema (zero-time) must NOT trigger
// renewal — those would just burn Stripe calls for nothing.
func TestPostSandboxes_DoesNotRenew_WhenClaimedOrUnknownExpiry(t *testing.T) {
	cases := []struct {
		name string
		sb   store.Sandbox
	}{
		{
			name: "claimed sandbox",
			sb: store.Sandbox{
				SandboxID:         "cbsbx_fake_claimed",
				AppID:             "app-1",
				ClaimURL:          "https://stripe.example/claim/whatever",
				ClaimStatus:       store.ClaimStatusClaimed,
				ClaimURLExpiresAt: time.Now().Add(-1 * time.Hour),
			},
		},
		{
			name: "live sandbox",
			sb: store.Sandbox{
				SandboxID:         "cbsbx_fake_live",
				AppID:             "app-1",
				ClaimURL:          "https://stripe.example/claim/whatever",
				ClaimStatus:       store.ClaimStatusLive,
				ClaimURLExpiresAt: time.Now().Add(-1 * time.Hour),
			},
		},
		{
			name: "pre-schema sandbox (zero expiry)",
			sb: store.Sandbox{
				SandboxID:   "cbsbx_fake_old",
				AppID:       "app-1",
				ClaimURL:    "https://stripe.example/claim/old",
				ClaimStatus: store.ClaimStatusProvisioned,
				// ClaimURLExpiresAt left zero
			},
		},
		{
			name: "fresh expiry (>24h out)",
			sb: store.Sandbox{
				SandboxID:         "cbsbx_fake_fresh",
				AppID:             "app-1",
				ClaimURL:          "https://stripe.example/claim/fresh",
				ClaimStatus:       store.ClaimStatusProvisioned,
				ClaimURLExpiresAt: time.Now().Add(48 * time.Hour),
			},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := newTestRouterServer("dev", "0.0.0", "none")
			st := srv.Sandboxes.(*fakeStore)
			stripe := srv.Stripe.(*fakeStripe)
			st.byApp["app-1"] = []store.Sandbox{c.sb}
			st.bySandboxID[c.sb.SandboxID] = c.sb

			body, _ := json.Marshal(createSandboxRequest{AppID: "app-1"})
			req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			NewRouter(srv).ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status: want 200, got %d", rec.Code)
			}
			if stripe.renewCalls != 0 {
				t.Errorf("Stripe must not be called for %s; got %d calls", c.name, stripe.renewCalls)
			}
		})
	}
}

func TestBuildLiveSecretsOps(t *testing.T) {
	ops := buildLiveSecretsOps("sk_live_X", "pk_live_X")
	if len(ops) != 5 {
		t.Fatalf("ops count: want 5, got %d", len(ops))
	}

	// First op must be the MCP key delete.
	mcpOp := ops[0]
	if mcpOp.Type != hosting.SecretOpDelete {
		t.Errorf("ops[0].Type: want delete, got %q", mcpOp.Type)
	}
	if mcpOp.Secret.Name != "STRIPE_MCP_KEY" {
		t.Errorf("ops[0].Name: want STRIPE_MCP_KEY, got %q", mcpOp.Secret.Name)
	}
	if mcpOp.Secret.Protected == nil || !*mcpOp.Secret.Protected {
		t.Errorf("MCP delete op must set protected:true so it targets the agent task")
	}
	if mcpOp.Secret.Value != "" {
		t.Errorf("MCP delete op must carry no value; got %q", mcpOp.Secret.Value)
	}

	// Remaining 4 ops: sk/pk upserts to preview+publish.
	type key struct{ name, variant string }
	byKey := map[key]hosting.SecretOp{}
	for _, op := range ops[1:] {
		v := ""
		if len(op.Secret.Variants) == 1 {
			v = op.Secret.Variants[0]
		}
		byKey[key{op.Secret.Name, v}] = op
	}
	wantValues := map[key]string{
		{"STRIPE_SECRET_KEY", "preview"}:      "sk_live_X",
		{"STRIPE_SECRET_KEY", "publish"}:      "sk_live_X",
		{"STRIPE_PUBLISHABLE_KEY", "preview"}: "pk_live_X",
		{"STRIPE_PUBLISHABLE_KEY", "publish"}: "pk_live_X",
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
		if op.Type != hosting.SecretOpUpsert {
			t.Errorf("op %+v type: want upsert, got %q", k, op.Type)
		}
	}
}

// TestPostSandboxes_LegacyShortCircuit is the core safety guarantee: when an
// app already has a `legacy` row (pre-stripe-v2 pasted key), POST
// /v1/sandboxes must return {legacy:true} and make ZERO Stripe and hosting
// calls — provisioning would push sk_test_* over the merchant's pasted
// sk_live_* and break live checkout.
func TestPostSandboxes_LegacyShortCircuit(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	stripe := srv.Stripe.(*fakeStripe)
	secrets := srv.Secrets.(*fakeSecretsPusher)
	st := srv.Sandboxes.(*fakeStore)
	if err := st.PutLegacy(context.Background(), "app-legacy"); err != nil {
		t.Fatalf("seed PutLegacy: %v", err)
	}
	h := NewRouter(srv)

	body := `{"appId":"app-legacy","country":"US"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp sandboxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.Legacy {
		t.Errorf("response should set legacy:true; got %+v", resp)
	}
	if resp.SandboxID != "" {
		t.Errorf("legacy response should not carry a sandboxId; got %q", resp.SandboxID)
	}
	if stripe.callCount != 0 {
		t.Errorf("stripe must not be called for a legacy app; callCount=%d", stripe.callCount)
	}
	if secrets.calls != 0 {
		t.Errorf("secrets must not be pushed for a legacy app; calls=%d", secrets.calls)
	}
	for _, p := range st.puts {
		if p.ClaimStatus != store.ClaimStatusLegacy {
			t.Errorf("unexpected non-legacy put: %+v", p)
		}
	}
}

// TestPostSandboxes_LegacyWinsOverManagedRow locks in the precedence contract:
// if a stale managed row and a backfilled legacy row both exist for the same
// app (distinct items — managed keyed on cbsbx_*, legacy on legacy#<appId>),
// the legacy short-circuit must still win regardless of GSI return order.
func TestPostSandboxes_LegacyWinsOverManagedRow(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	stripe := srv.Stripe.(*fakeStripe)
	secrets := srv.Secrets.(*fakeSecretsPusher)
	st := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	// Seed managed FIRST so it precedes the legacy row in byApp — proves the
	// scan doesn't just return the first element.
	if err := st.Put(context.Background(), store.Sandbox{
		SandboxID:   "cbsbx_stale",
		AppID:       "app-both",
		AccountID:   "acct_stale",
		ClaimURL:    "https://dashboard.stripe.com/claim/cbsbx_stale",
		ClaimStatus: store.ClaimStatusProvisioned,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("seed managed Put: %v", err)
	}
	if err := st.PutLegacy(context.Background(), "app-both"); err != nil {
		t.Fatalf("seed PutLegacy: %v", err)
	}
	h := NewRouter(srv)

	body := `{"appId":"app-both","country":"US"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp sandboxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.Legacy {
		t.Errorf("legacy must win even with a managed row present; got %+v", resp)
	}
	if resp.SandboxID != "" {
		t.Errorf("legacy response should not carry a sandboxId; got %q", resp.SandboxID)
	}
	if stripe.callCount != 0 {
		t.Errorf("stripe must not be called when a legacy row exists; callCount=%d", stripe.callCount)
	}
	if secrets.calls != 0 {
		t.Errorf("secrets must not be pushed when a legacy row exists; calls=%d", secrets.calls)
	}
}

// TestGetStatus_LegacyWinsOverManagedRow mirrors the postSandboxes precedence
// contract for getStatus: if a legacy row and a managed row coexist, the legacy
// row must be returned regardless of QueryByAppID GSI return order.
func TestGetStatus_LegacyWinsOverManagedRow(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	st := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	if err := st.Put(context.Background(), store.Sandbox{
		SandboxID:   "cbsbx_stale",
		AppID:       "app-both",
		AccountID:   "acct_stale",
		ClaimStatus: store.ClaimStatusProvisioned,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("seed managed Put: %v", err)
	}
	if err := st.PutLegacy(context.Background(), "app-both"); err != nil {
		t.Fatalf("seed PutLegacy: %v", err)
	}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/v1/status?appId=app-both", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ClaimStatus != store.ClaimStatusLegacy {
		t.Errorf("ClaimStatus: want legacy, got %q — legacy row must win over managed row", resp.ClaimStatus)
	}
}

func TestPostLegacy_RecordsRow(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	stripe := srv.Stripe.(*fakeStripe)
	secrets := srv.Secrets.(*fakeSecretsPusher)
	st := srv.Sandboxes.(*fakeStore)
	h := NewRouter(srv)

	body := `{"appId":"app-legacy"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/legacy", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp sandboxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.Legacy {
		t.Errorf("response should set legacy:true; got %+v", resp)
	}
	if len(st.legacyPuts) != 1 || st.legacyPuts[0] != "app-legacy" {
		t.Errorf("PutLegacy not recorded as expected; legacyPuts=%v", st.legacyPuts)
	}
	if stripe.callCount != 0 || secrets.calls != 0 {
		t.Errorf("legacy record must not touch Stripe/hosting; stripe=%d secrets=%d", stripe.callCount, secrets.calls)
	}
}

func TestPostLegacy_MissingAppID(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/legacy", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400 for missing appId, got %d", rec.Code)
	}
}

func TestPostLegacy_500OnPutLegacyError(t *testing.T) {
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.Sandboxes.(*fakeStore).putLegacyErr = errors.New("ddb write failure")
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/v1/legacy", bytes.NewBufferString(`{"appId":"app-fail"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500 on PutLegacy failure, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "STORE_PUT_FAILED") {
		t.Errorf("body should mention STORE_PUT_FAILED; got %q", rec.Body.String())
	}
}
