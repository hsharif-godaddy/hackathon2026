package httpproxy //nolint:testpackage // tests access unexported handler internals

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing"
	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing/testkeys"
)

// startFakeGateway stands up a minimal HTTP server that mimics
// localhost:2525/api/email/send. Returns the URL so the test can
// override EMAIL_GATEWAY_LISTEN_ADDR — letting the proxy hit the
// fake instead of attempting to reach the real loopback gateway
// (which isn't running in unit-test scope).
//
// The fake echoes back the request body and a fixed message-id so
// the test can assert the proxy correctly threads the upstream
// response through.
func startFakeGateway(t *testing.T, status int) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/email/send" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"success":true,"messageId":"fake-msg-001"}`))
	}))
	t.Cleanup(srv.Close)
	// Strip "http://" prefix — EMAIL_GATEWAY_LISTEN_ADDR wants just host:port.
	addr := strings.TrimPrefix(srv.URL, "http://")
	t.Setenv("EMAIL_GATEWAY_LISTEN_ADDR", addr)
}

func TestHandleEmailTestSend_GatedByEnvVar(t *testing.T) {
	t.Setenv("DEV_SUPERVISOR_SIGN_DEBUG_ENABLED", "")
	p := newProxyWithSignerTS(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/airo/email/test-send", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	p.handleEmailTestSend(w, req)

	if got, want := w.Code, http.StatusNotFound; got != want {
		t.Errorf("status = %d, want %d (must be inert when env var unset)", got, want)
	}
}

func TestHandleEmailTestSend_MethodNotAllowed(t *testing.T) {
	t.Setenv("DEV_SUPERVISOR_SIGN_DEBUG_ENABLED", "true")
	p := newProxyWithSignerTS(t, nil)
	req := httptest.NewRequest(http.MethodGet, "/airo/email/test-send", nil)
	w := httptest.NewRecorder()
	p.handleEmailTestSend(w, req)

	if got, want := w.Code, http.StatusMethodNotAllowed; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
}

func TestHandleEmailTestSend_ProxiesUpstreamSuccess_NoSigner(t *testing.T) {
	t.Setenv("DEV_SUPERVISOR_SIGN_DEBUG_ENABLED", "true")
	t.Setenv("SMTP_DESTINATION", "relay.example.test:25")
	startFakeGateway(t, http.StatusOK)

	p := newProxyWithSignerTS(t, nil) // no signer wired

	body := `{"to":["t@example.test"],"subject":"hi","text":"hello"}`
	req := httptest.NewRequest(http.MethodPost, "/airo/email/test-send", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	p.handleEmailTestSend(w, req)

	if got, want := w.Code, http.StatusOK; got != want {
		t.Fatalf("status = %d, want %d; body=%s", got, want, w.Body.String())
	}

	var resp emailTestSendResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.SigningEnabled {
		t.Error("signing_enabled must be false when no signer wired")
	}
	if resp.KeyID != "" || resp.CellID != "" {
		t.Errorf("key_id / cell_id should be empty without signer; got key_id=%q cell_id=%q", resp.KeyID, resp.CellID)
	}
	if resp.UpstreamStatus != http.StatusOK {
		t.Errorf("upstream_status = %d, want 200", resp.UpstreamStatus)
	}
	if resp.WouldForwardTo != "relay.example.test:25" {
		t.Errorf("would_forward_to = %q", resp.WouldForwardTo)
	}
	// Upstream body passed through verbatim.
	var upstream map[string]any
	if err := json.Unmarshal(resp.Upstream, &upstream); err != nil {
		t.Fatalf("upstream not JSON: %v (raw=%q)", err, string(resp.Upstream))
	}
	if upstream["messageId"] != "fake-msg-001" {
		t.Errorf("upstream.messageId = %v", upstream["messageId"])
	}
}

func TestHandleEmailTestSend_ReportsSigningEnabled(t *testing.T) {
	t.Setenv("DEV_SUPERVISOR_SIGN_DEBUG_ENABLED", "true")
	startFakeGateway(t, http.StatusOK)

	mat := testkeys.Generate(t)
	signer, err := signing.NewForTesting(mat.KeyPEM, mat.CertPEM, "test-cell-20260522", "c-test")
	if err != nil {
		t.Fatalf("NewForTesting: %v", err)
	}
	p := newProxyWithSignerTS(t, signer)

	body := `{"to":["t@example.test"],"subject":"hi","text":"hello"}`
	req := httptest.NewRequest(http.MethodPost, "/airo/email/test-send", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	p.handleEmailTestSend(w, req)

	if got, want := w.Code, http.StatusOK; got != want {
		t.Fatalf("status = %d, want %d; body=%s", got, want, w.Body.String())
	}

	var resp emailTestSendResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.SigningEnabled {
		t.Error("signing_enabled must be true with signer wired")
	}
	if resp.KeyID != "test-cell-20260522" {
		t.Errorf("key_id = %q", resp.KeyID)
	}
	if resp.CellID != "c-test" {
		t.Errorf("cell_id = %q", resp.CellID)
	}
}

func TestHandleEmailTestSend_PassesThroughUpstreamErrorStatus(t *testing.T) {
	t.Setenv("DEV_SUPERVISOR_SIGN_DEBUG_ENABLED", "true")
	startFakeGateway(t, http.StatusBadRequest)

	p := newProxyWithSignerTS(t, nil)

	body := `{"to":[],"subject":""}`
	req := httptest.NewRequest(http.MethodPost, "/airo/email/test-send", strings.NewReader(body))
	w := httptest.NewRecorder()
	p.handleEmailTestSend(w, req)

	// Wrapper itself returns 200 — the upstream status surfaces in
	// the body, not the wrapper's HTTP status. This makes it easy
	// for a curl pipeline to always parse JSON.
	if got, want := w.Code, http.StatusOK; got != want {
		t.Fatalf("wrapper status = %d, want %d", got, want)
	}

	var resp emailTestSendResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.UpstreamStatus != http.StatusBadRequest {
		t.Errorf("upstream_status = %d, want 400", resp.UpstreamStatus)
	}
}

// newProxyWithSignerTS is a test-local builder that doesn't conflict
// with names in other test files. (Earlier file used a similar
// helper; we duplicate with a different name to keep test files
// independent and avoid ordering coupling.)
func newProxyWithSignerTS(t *testing.T, signer *signing.Signer) *HTTPProxy {
	t.Helper()
	p := &HTTPProxy{}
	p.SetSigner(signer)
	return p
}
