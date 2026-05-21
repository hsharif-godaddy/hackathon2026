package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/store"
	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/webhook"
)

// fakeEventFetcher is the test double for eventFetcher. Pre-load responses
// by event ID; a missing key returns a minimal empty-object payload so
// missing-field tests work without per-test setup.
type fakeEventFetcher struct {
	responses map[string][]byte
	err       error
}

func (f *fakeEventFetcher) FetchEvent(_ context.Context, eventID string) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	if b, ok := f.responses[eventID]; ok {
		return b, nil
	}
	return []byte(`{"data":{"object":{}}}`), nil
}

// fakeEventStore is the test double for eventStore. Records every PutNew
// call. putErr drives the various error branches in the handler.
type fakeEventStore struct {
	calls   []fakeEventCall
	putErr  error
	closure func(string, string, time.Time) error
}

type fakeEventCall struct {
	eventID, eventType string
	receivedAt         time.Time
}

func (f *fakeEventStore) PutNew(_ context.Context, eventID, eventType string, receivedAt time.Time) error {
	f.calls = append(f.calls, fakeEventCall{eventID, eventType, receivedAt})
	if f.closure != nil {
		return f.closure(eventID, eventType, receivedAt)
	}
	return f.putErr
}

const (
	whTestSecret = "whsec_handler_test_secret"
)

// signedRequest builds a *http.Request that the handler will consider
// well-signed. NOT used to test the verifier itself (the verifier has its
// own test against a hand-computed reference vector); only used to build
// the "valid signature" precondition for handler-behavior tests.
func signedRequest(t *testing.T, secret string, body []byte) *http.Request {
	t.Helper()
	ts := time.Now().Unix()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", ts)))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", bytes.NewReader(body))
	req.Header.Set("Stripe-Signature", fmt.Sprintf("t=%d,v1=%s", ts, sig))
	req.Header.Set("Content-Type", "application/json")
	return req
}

// newWebhookServer assembles a *Server pre-wired for webhook handler tests:
// a Verifier holding the test secret, a fakeEventStore, and a fakeEventFetcher
// (accessed via srv.EventFetcher.(*fakeEventFetcher) to pre-load responses).
func newWebhookServer() (*Server, *fakeEventStore) {
	store := &fakeEventStore{}
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.WebhookVerifier = webhook.NewVerifier(whTestSecret)
	srv.Events = store
	srv.EventFetcher = &fakeEventFetcher{
		responses: map[string][]byte{},
	}
	return srv, store
}

func TestPostStripeWebhook_ValidNewEventReturns200(t *testing.T) {
	srv, events := newWebhookServer()
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_001","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"received"`) {
		t.Errorf("body should indicate received; got %q", rec.Body.String())
	}
	if len(events.calls) != 1 {
		t.Fatalf("PutNew calls: want 1, got %d", len(events.calls))
	}
	got := events.calls[0]
	if got.eventID != "evt_001" {
		t.Errorf("eventID: want evt_001, got %q", got.eventID)
	}
	if got.eventType != "v2.core.claimable_sandbox.claimed" {
		t.Errorf("eventType: want claimable_sandbox.claimed, got %q", got.eventType)
	}
	if got.receivedAt.IsZero() {
		t.Errorf("receivedAt: want non-zero")
	}
}

func TestPostStripeWebhook_DuplicateReturns200Idempotent(t *testing.T) {
	srv, events := newWebhookServer()
	events.putErr = store.ErrEventExists
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_002","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status on duplicate: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"duplicate"`) {
		t.Errorf("body should indicate duplicate; got %q", rec.Body.String())
	}
}

func TestPostStripeWebhook_BadSignatureReturns401(t *testing.T) {
	srv, events := newWebhookServer()
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_003","type":"v2.core.claimable_sandbox.claimed"}`)
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", bytes.NewReader(body))
	req.Header.Set("Stripe-Signature", fmt.Sprintf("t=%d,v1=deadbeef", time.Now().Unix()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status on bad signature: want 401, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVALID_SIGNATURE") {
		t.Errorf("body should mention INVALID_SIGNATURE; got %q", rec.Body.String())
	}
	if len(events.calls) != 0 {
		t.Errorf("store.PutNew should not be called on bad signature; got %d calls", len(events.calls))
	}
}

func TestPostStripeWebhook_MissingSignatureHeaderReturns401(t *testing.T) {
	srv, _ := newWebhookServer()
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_004","type":"x"}`)
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", bytes.NewReader(body))
	// No Stripe-Signature header at all.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status with no signature header: want 401, got %d", rec.Code)
	}
}

func TestPostStripeWebhook_MalformedJSONReturns400(t *testing.T) {
	srv, _ := newWebhookServer()
	h := NewRouter(srv)

	body := []byte(`{not valid json`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status on malformed JSON: want 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("body should mention INVALID_JSON; got %q", rec.Body.String())
	}
}

func TestPostStripeWebhook_MissingIDReturns400(t *testing.T) {
	srv, _ := newWebhookServer()
	h := NewRouter(srv)

	body := []byte(`{"type":"v2.core.claimable_sandbox.claimed"}`) // no id
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status on missing id: want 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "MISSING_EVENT_FIELDS") {
		t.Errorf("body should mention MISSING_EVENT_FIELDS; got %q", rec.Body.String())
	}
}

func TestPostStripeWebhook_MissingTypeReturns400(t *testing.T) {
	srv, _ := newWebhookServer()
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_005"}`) // no type
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status on missing type: want 400, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "MISSING_EVENT_FIELDS") {
		t.Errorf("body should mention MISSING_EVENT_FIELDS; got %q", rec.Body.String())
	}
}

func TestPostStripeWebhook_StorePutErrorReturns500(t *testing.T) {
	srv, events := newWebhookServer()
	events.putErr = errors.New("ddb went away")
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_006","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status on store failure: want 500, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "STORE_PUT_FAILED") {
		t.Errorf("body should mention STORE_PUT_FAILED; got %q", rec.Body.String())
	}
}

func TestPostStripeWebhook_OversizedBodyReturns413(t *testing.T) {
	srv, events := newWebhookServer()
	h := NewRouter(srv)

	// Build a body that exceeds the 1 MiB cap. http.MaxBytesReader trips the
	// read before signature verification can run, so this must surface as 413
	// rather than 401 — otherwise Stripe would retry indefinitely on a
	// payload the receiver can never accept.
	const oversized = (1 << 20) + 1
	body := bytes.Repeat([]byte("x"), oversized)
	// Sign with the test secret so a hypothetical missing-413 path would fall
	// through to (failed) signature verification instead of (eg) 400 JSON.
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status on oversized body: want 413, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "PAYLOAD_TOO_LARGE") {
		t.Errorf("body should mention PAYLOAD_TOO_LARGE; got %q", rec.Body.String())
	}
	if len(events.calls) != 0 {
		t.Errorf("store.PutNew should not be called on oversized body; got %d calls", len(events.calls))
	}
}

func TestPostStripeWebhook_PublicNoAuthHeaderRequired(t *testing.T) {
	// Build a server with awsiam-enforcing Auth (as if AUTH_TYPE=jwt in
	// prod) so we can confirm /webhooks/stripe still passes through to the
	// handler with no Authorization header — i.e. it's not accidentally
	// wrapped in the awsiam middleware. If a future refactor wraps it,
	// this test fails with 401 instead of 200.
	srv, _ := newWebhookServer()
	srv.Auth = newTestRouterServer("dev", "0.0.0", "jwt").Auth
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_007","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	// Deliberately no Authorization header.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 (route is public), got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

// ----------------------------------------------------------------------------
// Type-dispatch tests: the new claim_status advancement behavior.
// ----------------------------------------------------------------------------

func TestWebhook_ClaimedDispatch_AdvancesStatusToClaimed(t *testing.T) {
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	// Seed the sandbox row that the event references — the store
	// otherwise returns ErrSandboxNotFound and the dispatch is a no-op.
	now := time.Now().UTC()
	sandboxes.Put(context.Background(), store.Sandbox{
		SandboxID: "clmsbx_test_X", AppID: "app-1", AccountID: "acct_test_X",
		ClaimStatus: store.ClaimStatusProvisioned, CreatedAt: now, UpdatedAt: now,
	})
	sandboxes.puts = nil // reset; the seed Put muddies the assertion below.

	// Pre-load the full event payload the fetcher returns when asked to expand.
	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_claimed_001"] = []byte(`{"data":{"object":{"id":"clmsbx_test_X"}}}`)

	h := NewRouter(srv)
	// Thin event body — no data.object in the webhook delivery.
	body := []byte(`{"id":"evt_v2_claimed_001","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 1 {
		t.Fatalf("UpdateClaimStatus calls: want 1, got %d", len(sandboxes.updates))
	}
	got := sandboxes.updates[0]
	if got.SandboxID != "clmsbx_test_X" {
		t.Errorf("SandboxID: want clmsbx_test_X, got %q", got.SandboxID)
	}
	if got.ClaimStatus != store.ClaimStatusClaimed {
		t.Errorf("ClaimStatus: want claimed, got %q", got.ClaimStatus)
	}
	// `claimed` event doesn't carry owner_account; passing "" leaves the
	// existing value alone.
	if got.LiveAccountID != "" {
		t.Errorf("LiveAccountID: want empty (don't touch), got %q", got.LiveAccountID)
	}
}

func TestWebhook_OwnerAccountUpdatedDispatch_AdvancesToLiveWithAccount(t *testing.T) {
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	sandboxes.Put(context.Background(), store.Sandbox{
		SandboxID: "clmsbx_test_X", AppID: "app-1", AccountID: "acct_test_X",
		ClaimStatus: store.ClaimStatusClaimed, CreatedAt: now, UpdatedAt: now,
	})
	sandboxes.puts = nil

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_owner_001"] = []byte(`{"data":{"object":{
		"id":"clmsbx_test_X",
		"owner_details":{"account":"acct_live_merchant_xyz"}
	}}}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_owner_001","type":"v2.core.claimable_sandbox.updated"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 1 {
		t.Fatalf("UpdateClaimStatus calls: want 1, got %d", len(sandboxes.updates))
	}
	got := sandboxes.updates[0]
	if got.ClaimStatus != store.ClaimStatusLive {
		t.Errorf("ClaimStatus: want live, got %q", got.ClaimStatus)
	}
	if got.LiveAccountID != "acct_live_merchant_xyz" {
		t.Errorf("LiveAccountID: want acct_live_merchant_xyz, got %q", got.LiveAccountID)
	}
}

func TestWebhook_OwnerAccountUpdated_StaysAtClaimedWhenAccountMissing(t *testing.T) {
	// When neither owner_details.account nor sandbox_details.account carries a
	// value, the handler stays at `claimed` and logs a warning rather than
	// advancing to `live` with an empty account. Advancing would be
	// unrecoverable — the dedup row blocks any retry. Staying at `claimed` is
	// recoverable: Stripe will redeliver with a new event_id when the merchant
	// progresses.
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	sandboxes.Put(context.Background(), store.Sandbox{
		SandboxID: "clmsbx_test_X", AppID: "app-1", AccountID: "acct_test_X",
		ClaimStatus: store.ClaimStatusClaimed, CreatedAt: now, UpdatedAt: now,
	})
	sandboxes.puts = nil

	// Fetcher returns a full event with sandbox id but no account fields.
	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_owner_002"] = []byte(`{"data":{"object":{"id":"clmsbx_test_X"}}}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_owner_002","type":"v2.core.claimable_sandbox.updated"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	// Handler returns early — no UpdateClaimStatus call should have fired.
	if len(sandboxes.updates) != 0 {
		t.Fatalf("UpdateClaimStatus calls: want 0 (stay at claimed), got %d", len(sandboxes.updates))
	}
}

func TestWebhook_UnknownSandboxIDDoesNotFailDispatch(t *testing.T) {
	// A claimed event for a sandbox we don't have on file is expected for
	// cross-account replays / dashboard test events. We log warn and ACK,
	// not 500. Pin: response is 200 and no update fires.
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	sandboxes.updateNotFound = true

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_unknown_001"] = []byte(`{"data":{"object":{"id":"clmsbx_test_unknown"}}}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_unknown_001","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 (don't 500 on unknown sandbox), got %d", rec.Code)
	}
	if len(sandboxes.updates) != 0 {
		t.Errorf("updates: want 0 (UpdateClaimStatus returned ErrSandboxNotFound), got %d", len(sandboxes.updates))
	}
}

func TestWebhook_UnhandledEventTypeStillReturns200(t *testing.T) {
	// Existing 'received' event-type tests already cover the no-op
	// non-claimable_sandbox path. Pin: dispatch doesn't fire, response is
	// still 200, dedup row is still written so retries are still idempotent.
	srv, events := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_unrelated_001","type":"v2.core.payment_intent.created"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	if len(sandboxes.updates) != 0 {
		t.Errorf("updates: want 0 (unhandled type), got %d", len(sandboxes.updates))
	}
	if len(events.calls) != 1 {
		t.Errorf("events.PutNew: want 1 (dedup row written), got %d", len(events.calls))
	}
}

func TestWebhook_StoreUpdateErrorStillReturns200(t *testing.T) {
	// A transient DDB error during dispatch logs at error but doesn't
	// 500 — Stripe would retry, the dedup row blocks the retry, and
	// we'd silently drop the event. Better to ACK and rely on
	// alerting/reconciliation.
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	sandboxes.updateErr = errors.New("ddb throttled")

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_throttled_001"] = []byte(`{"data":{"object":{"id":"clmsbx_test_X"}}}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_throttled_001","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 (ACK and rely on alerting), got %d", rec.Code)
	}
}

func TestWebhook_ClaimedDispatch_MissingSandboxID_NoUpdate(t *testing.T) {
	// data.object.id missing → handler logs and returns; dedup row still written.
	// The fetcher returns the default empty-object payload (no id field).
	srv, events := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	h := NewRouter(srv)

	body := []byte(`{"id":"evt_v2_claimed_nosid","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 0 {
		t.Errorf("updates: want 0 (missing sandbox id), got %d", len(sandboxes.updates))
	}
	if len(events.calls) != 1 {
		t.Errorf("events.PutNew: want 1 (dedup row written), got %d", len(events.calls))
	}
}

func TestWebhook_OwnerAccountUpdated_MissingSandboxID_NoUpdate(t *testing.T) {
	// data.object.id missing → handler logs and returns; dedup row still written.
	// Fetcher returns a payload with owner_details.account but no sandbox ID.
	srv, events := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_owner_nosid"] = []byte(`{"data":{"object":{"owner_details":{"account":"acct_live_xyz"}}}}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_owner_nosid","type":"v2.core.claimable_sandbox.updated"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 0 {
		t.Errorf("updates: want 0 (missing sandbox id), got %d", len(sandboxes.updates))
	}
	if len(events.calls) != 1 {
		t.Errorf("events.PutNew: want 1 (dedup row written), got %d", len(events.calls))
	}
}

func TestWebhook_OwnerAccountUpdated_UnknownSandboxIDDoesNotFailDispatch(t *testing.T) {
	// Symmetric to the claimed handler: ErrSandboxNotFound on owner_account_updated
	// is also expected for cross-account replays / dashboard test events.
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	sandboxes.updateNotFound = true

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_owner_unknown"] = []byte(`{"data":{"object":{
		"id":"clmsbx_test_unknown",
		"owner_details":{"account":"acct_live_merchant_xyz"}
	}}}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_owner_unknown","type":"v2.core.claimable_sandbox.updated"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200 (don't 500 on unknown sandbox), got %d", rec.Code)
	}
	if len(sandboxes.updates) != 0 {
		t.Errorf("updates: want 0 (ErrSandboxNotFound), got %d", len(sandboxes.updates))
	}
}

func TestWebhook_OwnerAccountUpdated_TopLevelSandboxDetailsFallback(t *testing.T) {
	// Pin the third path of resolveOwnerAccount: top-level
	// data.sandbox_details.account (used when the v2 envelope places the
	// merchant acct_* directly under data.sandbox_details rather than under
	// data.object.sandbox_details). Other three paths are exercised by
	// neighboring tests; this closes the matrix.
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	sandboxes.Put(context.Background(), store.Sandbox{
		SandboxID: "clmsbx_test_X", AppID: "app-1", AccountID: "acct_test_X",
		ClaimStatus: store.ClaimStatusClaimed, CreatedAt: now, UpdatedAt: now,
	})
	sandboxes.puts = nil

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_top_level_sandbox_details"] = []byte(`{
		"related_object":{"id":"clmsbx_test_X"},
		"data":{"sandbox_details":{"account":"acct_live_top_level"}}
	}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_top_level_sandbox_details","type":"v2.core.claimable_sandbox.updated"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 1 {
		t.Fatalf("UpdateClaimStatus calls: want 1, got %d", len(sandboxes.updates))
	}
	got := sandboxes.updates[0]
	if got.ClaimStatus != store.ClaimStatusLive {
		t.Errorf("ClaimStatus: want live, got %q", got.ClaimStatus)
	}
	if got.LiveAccountID != "acct_live_top_level" {
		t.Errorf("LiveAccountID: want acct_live_top_level (from data.sandbox_details.account), got %q", got.LiveAccountID)
	}
}

func TestWebhook_OwnerAccountUpdated_SandboxDetailsFallback(t *testing.T) {
	// Stripe's preview API may place the merchant acct_* in sandbox_details.account
	// rather than owner_details.account. Confirm the fallback path advances to live.
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	sandboxes.Put(context.Background(), store.Sandbox{
		SandboxID: "clmsbx_test_X", AppID: "app-1", AccountID: "acct_test_X",
		ClaimStatus: store.ClaimStatusClaimed, CreatedAt: now, UpdatedAt: now,
	})
	sandboxes.puts = nil

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.responses["evt_v2_owner_sandbox_details"] = []byte(`{"data":{"object":{
		"id":"clmsbx_test_X",
		"sandbox_details":{"account":"acct_live_via_sandbox_details"}
	}}}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_owner_sandbox_details","type":"v2.core.claimable_sandbox.updated"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 1 {
		t.Fatalf("UpdateClaimStatus calls: want 1, got %d", len(sandboxes.updates))
	}
	got := sandboxes.updates[0]
	if got.ClaimStatus != store.ClaimStatusLive {
		t.Errorf("ClaimStatus: want live, got %q", got.ClaimStatus)
	}
	if got.LiveAccountID != "acct_live_via_sandbox_details" {
		t.Errorf("LiveAccountID: want acct_live_via_sandbox_details (from sandbox_details fallback), got %q", got.LiveAccountID)
	}
}

func TestWebhook_FetchEventFailure_Returns502AndSkipsDedup(t *testing.T) {
	// FetchEvent is called BEFORE the dedup row is written. A transient failure
	// must return non-2xx so Stripe retries, and must NOT write the dedup row
	// (which would permanently drop the event on retry).
	srv, events := newWebhookServer()
	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	fetcher.err = errors.New("stripe api: i/o timeout")

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_fetch_err","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502 (fetch failed, Stripe should retry), got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(events.calls) != 0 {
		t.Errorf("events.PutNew: want 0 (dedup row must not be written on fetch failure), got %d", len(events.calls))
	}
}

// ----------------------------------------------------------------------------
// v2 envelope shape tests: related_object.id takes precedence over data.object.id.
// These pin the primary field paths used by live Stripe deliveries (not just the
// stripe trigger fallback paths exercised by the tests above).
// ----------------------------------------------------------------------------

func TestWebhook_ClaimedDispatch_UsesRelatedObjectID(t *testing.T) {
	// Live Stripe v2 full events carry the sandbox ID in related_object.id.
	// data.object is absent. Confirm the handler resolves the ID correctly.
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	sandboxes.Put(context.Background(), store.Sandbox{
		SandboxID: "clmsbx_live_ABC", AppID: "app-1", AccountID: "acct_test_X",
		ClaimStatus: store.ClaimStatusProvisioned, CreatedAt: now, UpdatedAt: now,
	})
	sandboxes.puts = nil

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	// v2 full-event shape: sandbox ID in related_object.id, no data.object.
	fetcher.responses["evt_v2_claimed_ro"] = []byte(`{
		"id":"evt_v2_claimed_ro",
		"type":"v2.core.claimable_sandbox.claimed",
		"related_object":{"id":"clmsbx_live_ABC"}
	}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_claimed_ro","type":"v2.core.claimable_sandbox.claimed"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 1 {
		t.Fatalf("UpdateClaimStatus calls: want 1, got %d", len(sandboxes.updates))
	}
	if sandboxes.updates[0].SandboxID != "clmsbx_live_ABC" {
		t.Errorf("SandboxID: want clmsbx_live_ABC (from related_object.id), got %q", sandboxes.updates[0].SandboxID)
	}
	if sandboxes.updates[0].ClaimStatus != store.ClaimStatusClaimed {
		t.Errorf("ClaimStatus: want claimed, got %q", sandboxes.updates[0].ClaimStatus)
	}
}

func TestWebhook_OwnerAccountUpdated_UsesRelatedObjectIDAndDataOwnerDetails(t *testing.T) {
	// Live Stripe v2 full events carry sandbox ID in related_object.id and
	// the merchant acct_* in data.owner_details.account (not under data.object).
	srv, _ := newWebhookServer()
	sandboxes := srv.Sandboxes.(*fakeStore)
	now := time.Now().UTC()
	sandboxes.Put(context.Background(), store.Sandbox{
		SandboxID: "clmsbx_live_ABC", AppID: "app-1", AccountID: "acct_test_X",
		ClaimStatus: store.ClaimStatusClaimed, CreatedAt: now, UpdatedAt: now,
	})
	sandboxes.puts = nil

	fetcher := srv.EventFetcher.(*fakeEventFetcher)
	// v2 full-event shape: sandbox ID in related_object.id, account in
	// data.owner_details.account — both outside data.object.
	fetcher.responses["evt_v2_updated_ro"] = []byte(`{
		"id":"evt_v2_updated_ro",
		"type":"v2.core.claimable_sandbox.updated",
		"related_object":{"id":"clmsbx_live_ABC"},
		"data":{"owner_details":{"account":"acct_live_merchant_v2"}}
	}`)

	h := NewRouter(srv)
	body := []byte(`{"id":"evt_v2_updated_ro","type":"v2.core.claimable_sandbox.updated"}`)
	req := signedRequest(t, whTestSecret, body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if len(sandboxes.updates) != 1 {
		t.Fatalf("UpdateClaimStatus calls: want 1, got %d", len(sandboxes.updates))
	}
	got := sandboxes.updates[0]
	if got.SandboxID != "clmsbx_live_ABC" {
		t.Errorf("SandboxID: want clmsbx_live_ABC (from related_object.id), got %q", got.SandboxID)
	}
	if got.ClaimStatus != store.ClaimStatusLive {
		t.Errorf("ClaimStatus: want live, got %q", got.ClaimStatus)
	}
	if got.LiveAccountID != "acct_live_merchant_v2" {
		t.Errorf("LiveAccountID: want acct_live_merchant_v2 (from data.owner_details.account), got %q", got.LiveAccountID)
	}
}
