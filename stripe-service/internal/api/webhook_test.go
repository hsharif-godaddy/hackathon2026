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
// a Verifier holding the test secret + a fakeEventStore the test can poke.
func newWebhookServer() (*Server, *fakeEventStore) {
	store := &fakeEventStore{}
	srv := newTestRouterServer("dev", "0.0.0", "none")
	srv.WebhookVerifier = webhook.NewVerifier(whTestSecret)
	srv.Events = store
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
