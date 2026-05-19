package emailhttp_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/emailhttp"
)

// recordingForward captures every call to email.ForwardSMTP. Tests
// that need to assert the wire shape inspect the captured slice; tests
// that just want a "send succeeded" or "send failed" outcome configure
// returnErr.
type recordingForward struct {
	mu        sync.Mutex
	calls     []forwardCall
	returnErr error
}

type forwardCall struct {
	dest         string
	envelopeFrom string
	rcpts        []string
	body         []byte
}

func (r *recordingForward) fn(dest, from string, rcpts []string, body []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, forwardCall{
		dest:         dest,
		envelopeFrom: from,
		rcpts:        append([]string(nil), rcpts...),
		body:         append([]byte(nil), body...),
	})
	return r.returnErr
}

func (r *recordingForward) snapshot() []forwardCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]forwardCall(nil), r.calls...)
}

// fixedIdentity returns the same Identity for every request — the
// production identityFn closes over allocconfig.Default(), but tests
// pin the value so the policy decision is deterministic.
func fixedIdentity(id email.Identity) func() (email.Identity, error) {
	return func() (email.Identity, error) { return id, nil }
}

func errIdentity(err error) func() (email.Identity, error) {
	return func() (email.Identity, error) { return email.Identity{}, err }
}

// startGateway boots a Gateway on 127.0.0.1:0 with the supplied
// dependencies; returns the bound URL plus a cleanup closure.
func startGateway(
	t *testing.T,
	identityFn func() (email.Identity, error),
	forward func(string, string, []string, []byte) error,
) (string, func()) {
	t.Helper()
	gw := emailhttp.NewForTesting(
		"127.0.0.1:0",
		"smtp-test:25",
		identityFn,
		forward,
		nil,
		true, // verbose 502 body so existing assertions on "relay rejected" etc. pass
	)
	if err := gw.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	url := "http://" + gw.Addr() + emailhttp.SendPath
	return url, func() {
		_ = gw.Stop()
	}
}

func postJSON(t *testing.T, url string, body any) (*http.Response, []byte) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	return resp, respBody
}

func postRaw(t *testing.T, url string, contentType string, body string) (*http.Response, []byte) {
	t.Helper()
	resp, err := http.Post(url, contentType, strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	return resp, respBody
}

func defaultIdentity() email.Identity {
	return email.Identity{
		AppID:           "abc123",
		AttachedDomains: []string{"acme.com"},
		PrimaryDomain:   "acme.com",
		DefaultDomain:   "airoapp.ai",
	}
}

func TestGateway_HappyPath(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"user@example.com"},
		"subject": "hi",
		"text":    "hello",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, body)
	}

	var sr emailhttp.SendResponse
	if err := json.Unmarshal(body, &sr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !sr.Success || sr.MessageID == "" {
		t.Errorf("response = %+v, want success+messageId", sr)
	}

	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("forward calls = %d, want 1", len(calls))
	}
	c := calls[0]
	if c.dest != "smtp-test:25" {
		t.Errorf("dest = %q", c.dest)
	}
	// No custom domain primary + replyTo unset → rule 2; from is
	// abc123@<PrimaryDomain> → abc123@acme.com.
	if c.envelopeFrom != "abc123@acme.com" {
		t.Errorf("envelopeFrom = %q, want abc123@acme.com", c.envelopeFrom)
	}
	if !slices.Contains(c.rcpts, "user@example.com") {
		t.Errorf("rcpts = %v, want user@example.com", c.rcpts)
	}
	if !bytes.Contains(c.body, []byte("From: abc123@acme.com")) {
		t.Errorf("body missing From header:\n%s", c.body)
	}
}

// TestGateway_FromOnVerifiedDomain confirms the customer can pick a
// preferred local-part on any attached domain. acme.com is in the
// default Identity's AttachedDomains, so support@acme.com passes
// IsAllowedSender and reaches the relay verbatim.
func TestGateway_FromOnVerifiedDomain(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"from":    "support@acme.com",
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, body)
	}
	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("forward calls = %d", len(calls))
	}
	if calls[0].envelopeFrom != "support@acme.com" {
		t.Errorf("envelopeFrom = %q, want support@acme.com", calls[0].envelopeFrom)
	}
	if !bytes.Contains(calls[0].body, []byte("From: support@acme.com")) {
		t.Errorf("From header missing in body:\n%s", calls[0].body)
	}
}

// TestGateway_FromOnUnverifiedDomain400 is the security-relevant case:
// a customer claim on a domain we haven't verified must produce a 400
// with a useful error, NOT a silent rewrite. The error body lists the
// verified domains so the customer's code can surface a remedy.
func TestGateway_FromOnUnverifiedDomain400(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"from":    "ken@gmail.com",
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", resp.StatusCode, body)
	}
	var sr emailhttp.SendResponse
	if err := json.Unmarshal(body, &sr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !strings.Contains(sr.Error, "ken@gmail.com") {
		t.Errorf("error should name the rejected from: %q", sr.Error)
	}
	if !strings.Contains(sr.Error, "acme.com") {
		t.Errorf("error should list verified domains so customer can fix: %q", sr.Error)
	}
	if !strings.Contains(sr.Error, "airoapp.ai") {
		t.Errorf("error should mention platform default: %q", sr.Error)
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward must not be called on policy rejection")
	}
}

// TestGateway_FromOmittedUsesCanonical confirms the no-from path
// produces the canonical "<AppID>@<PrimaryDomain>" address and doesn't
// require the customer to learn what their default sender is.
func TestGateway_FromOmittedUsesCanonical(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, body)
	}
	calls := rec.snapshot()
	if calls[0].envelopeFrom != "abc123@acme.com" {
		t.Errorf("envelopeFrom = %q, want abc123@acme.com (canonical)", calls[0].envelopeFrom)
	}
}

// TestGateway_FromOnDefaultDomainRequiresAppID asserts the SMTP-path
// rule that a claim on the platform default domain must use the app's
// own local-part — a customer can't claim "support@airoapp.ai" or
// "noreply@airoapp.ai" because those are platform-shaped names that
// belong to us, not them.
func TestGateway_FromOnDefaultDomainRequiresAppID(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"from":    "support@airoapp.ai",
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400; body=%s", resp.StatusCode, body)
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward must not be called")
	}
}

// TestGateway_FromMalformed400AtParse confirms basic shape validation
// fires before identity load — saves a config read on garbage input.
func TestGateway_FromMalformed400AtParse(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, _ := postJSON(t, url, map[string]any{
		"from":    "not an email",
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestGateway_ValidationErrors(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	// t.Cleanup, not defer: parallel subtests survive past the parent's
	// body finishing — defer would tear down the gateway before they run.
	t.Cleanup(cleanup)

	cases := []struct {
		name string
		body any
	}{
		{"missing_to", map[string]any{"subject": "hi", "text": "x"}},
		{"empty_to", map[string]any{"to": []string{}, "subject": "hi", "text": "x"}},
		{"missing_subject", map[string]any{"to": []string{"u@example.com"}, "text": "x"}},
		{"empty_subject", map[string]any{"to": []string{"u@example.com"}, "subject": "  ", "text": "x"}},
		{"missing_body", map[string]any{"to": []string{"u@example.com"}, "subject": "hi"}},
		{"malformed_to", map[string]any{"to": []string{"not-an-email"}, "subject": "hi", "text": "x"}},
		{"malformed_replyto", map[string]any{
			"to": []string{"u@example.com"}, "subject": "hi", "text": "x", "replyTo": "garbage",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp, body := postJSON(t, url, tc.body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("status = %d, want 400; body=%s", resp.StatusCode, body)
			}
		})
	}
}

func TestGateway_MethodNotAllowed(t *testing.T) {
	t.Parallel()
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), (&recordingForward{}).fn)
	defer cleanup()

	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", resp.StatusCode)
	}
}

func TestGateway_OversizeBody(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	// 6 MB > 5 MB cap.
	big := strings.Repeat("a", 6*1024*1024)
	resp, _ := postRaw(t, url, "application/json",
		`{"to":["u@example.com"],"subject":"hi","text":"`+big+`"}`)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", resp.StatusCode)
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward should not be called on oversize body")
	}
}

func TestGateway_IdentityLoadFailureReturns503(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t,
		errIdentity(errors.New("fake load failure")),
		rec.fn,
	)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to": []string{"u@example.com"}, "subject": "hi", "text": "x",
	})
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503; body=%s", resp.StatusCode, body)
	}
	if len(rec.snapshot()) != 0 {
		t.Error("forward should not be called when identity load fails")
	}
}

func TestGateway_ForwardErrorReturns502WithMessageID(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{returnErr: errors.New("relay rejected: 550 over quota")}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to": []string{"u@example.com"}, "subject": "hi", "text": "x",
	})
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502; body=%s", resp.StatusCode, body)
	}
	var sr emailhttp.SendResponse
	if err := json.Unmarshal(body, &sr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sr.Success {
		t.Errorf("Success should be false on forward error")
	}
	if sr.MessageID == "" {
		t.Errorf("MessageID should be present so caller can correlate")
	}
	if !strings.Contains(sr.Error, "relay rejected") {
		t.Errorf("Error = %q, want substring 'relay rejected'", sr.Error)
	}
}

// TestGateway_ReplyToPassesThroughVerbatim confirms ReplyTo is a plain
// header field with no domain-matching, no promotion, no special cases.
// The customer's contact-form pattern (per-call replyTo set to the
// form submitter) routes replies correctly without changing the From
// the recipient sees.
// TestGateway_FromUnverifiedSanitizedWhenNotVerbose asserts the 400 body
// drops the verified-domains list when verboseErrors=false (the prod
// posture). Otherwise the gateway is a free domain-attachment enumerator
// for anyone who can reach the port.
func TestGateway_FromUnverifiedSanitizedWhenNotVerbose(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	gw := emailhttp.NewForTesting("127.0.0.1:0", "smtp-test:25",
		fixedIdentity(defaultIdentity()), rec.fn, nil,
		false, // sanitized — production posture
	)
	if err := gw.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = gw.Stop() })
	url := "http://" + gw.Addr() + emailhttp.SendPath

	resp, body := postJSON(t, url, map[string]any{
		"from":    "ken@gmail.com",
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", resp.StatusCode, body)
	}

	var sr emailhttp.SendResponse
	if err := json.Unmarshal(body, &sr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// The verified-domains list MUST NOT appear — that's the leak we're
	// closing. defaultIdentity() carries acme.com + airoapp.ai.
	if strings.Contains(sr.Error, "acme.com") {
		t.Errorf("attached domain leaked into 400 body: %q", sr.Error)
	}
	if strings.Contains(sr.Error, "airoapp.ai") {
		t.Errorf("default domain leaked into 400 body: %q", sr.Error)
	}
	if strings.Contains(sr.Error, "ken@gmail.com") {
		t.Errorf("the rejected claim text shouldn't echo back either: %q", sr.Error)
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward must not be called on policy rejection")
	}
}

// TestGateway_ForwardErrorSanitizedWhenNotVerbose asserts the 502 body
// drops the wrapped relay error when verboseRelayErrors=false (the
// production posture, gated on NODE_ENV=production in New()).
//
// We only assert the body — slog verbosity is implicit in the handler's
// unconditional slog.Error call, and capturing slog here would mutate
// the process-global default and race other parallel tests.
func TestGateway_ForwardErrorSanitizedWhenNotVerbose(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{returnErr: errors.New("relay rejected: 550 over quota")}
	gw := emailhttp.NewForTesting("127.0.0.1:0", "smtp-test:25",
		fixedIdentity(defaultIdentity()), rec.fn, nil,
		false, // sanitized — production posture
	)
	if err := gw.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = gw.Stop() })
	url := "http://" + gw.Addr() + emailhttp.SendPath

	resp, body := postJSON(t, url, map[string]any{
		"to": []string{"u@example.com"}, "subject": "hi", "text": "x",
	})
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502; body=%s", resp.StatusCode, body)
	}

	var sr emailhttp.SendResponse
	if err := json.Unmarshal(body, &sr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sr.MessageID == "" {
		t.Errorf("MessageID still required for log correlation, got empty")
	}
	if strings.Contains(sr.Error, "relay rejected") || strings.Contains(sr.Error, "over quota") {
		t.Errorf("verbose relay error leaked into 502 body: %q", sr.Error)
	}
	if !strings.Contains(sr.Error, "message_id") {
		t.Errorf("sanitized error should hint at log correlation: %q", sr.Error)
	}
}

func TestGateway_ReplyToPassesThroughVerbatim(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
		"replyTo": "submitter@gmail.com",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, body)
	}

	calls := rec.snapshot()
	// From is canonical (no explicit from); ReplyTo is the literal value.
	if calls[0].envelopeFrom != "abc123@acme.com" {
		t.Errorf("envelopeFrom = %q, want abc123@acme.com (canonical)", calls[0].envelopeFrom)
	}
	if !bytes.Contains(calls[0].body, []byte("Reply-To: submitter@gmail.com")) {
		t.Errorf("Reply-To header missing or wrong:\n%s", calls[0].body)
	}
}

// TestGateway_ReplyToOnSameDomainAsFromStillRendered exercises the case
// the branch design specifically promoted (replyTo domain == app
// domain). Under fail-loud-from there's no promotion: the customer who
// wants From: support@acme.com sets it as From, not Reply-To.
func TestGateway_ReplyToOnSameDomainAsFromStillRendered(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, _ := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
		"replyTo": "support@acme.com",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	c := rec.snapshot()[0]
	// Reply-To header is preserved (no promotion).
	if !bytes.Contains(c.body, []byte("Reply-To: support@acme.com")) {
		t.Errorf("Reply-To should be preserved verbatim:\n%s", c.body)
	}
	// From is still canonical, NOT support@acme.com.
	if c.envelopeFrom != "abc123@acme.com" {
		t.Errorf("envelopeFrom = %q, want abc123@acme.com (no Reply-To promotion)", c.envelopeFrom)
	}
}

func TestGateway_CCBccGoToEnvelopeOnly(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, _ := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"cc":      []string{"cc@example.com"},
		"bcc":     []string{"bcc@example.com"},
		"subject": "hi",
		"text":    "x",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	c := rec.snapshot()[0]
	for _, want := range []string{"u@example.com", "cc@example.com", "bcc@example.com"} {
		if !slices.Contains(c.rcpts, want) {
			t.Errorf("rcpts missing %q: %v", want, c.rcpts)
		}
	}
	if !bytes.Contains(c.body, []byte("Cc: cc@example.com")) {
		t.Errorf("Cc header missing in body:\n%s", c.body)
	}
	if bytes.Contains(c.body, []byte("Bcc")) {
		t.Errorf("Bcc must never appear in body:\n%s", c.body)
	}
}

func TestGateway_ConcurrentSendsHaveUniqueMessageIDs(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	const n = 25
	var wg sync.WaitGroup
	ids := make([]string, n)
	var failed atomic.Int32
	for i := range n {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			resp, body := postJSON(t, url, map[string]any{
				"to":      []string{fmt.Sprintf("u%d@example.com", idx)},
				"subject": "hi",
				"text":    "x",
			})
			if resp.StatusCode != http.StatusOK {
				failed.Add(1)
				return
			}
			var sr emailhttp.SendResponse
			_ = json.Unmarshal(body, &sr)
			ids[idx] = sr.MessageID
		}(i)
	}
	wg.Wait()
	if failed.Load() > 0 {
		t.Fatalf("%d concurrent sends failed", failed.Load())
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Errorf("duplicate message id %q", id)
		}
		seen[id] = true
	}
}

func TestGateway_UnknownPathReturns404(t *testing.T) {
	t.Parallel()
	gw := emailhttp.NewForTesting("127.0.0.1:0", "smtp-test:25",
		fixedIdentity(defaultIdentity()), (&recordingForward{}).fn, nil, true)
	if err := gw.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer gw.Stop()

	resp, err := http.Post("http://"+gw.Addr()+"/unknown", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestGateway_StartStopIdempotent(t *testing.T) {
	t.Parallel()
	gw := emailhttp.NewForTesting("127.0.0.1:0", "smtp-test:25",
		fixedIdentity(defaultIdentity()), (&recordingForward{}).fn, nil, true)
	if err := gw.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := gw.Start(); err == nil {
		t.Errorf("second Start should error")
	}
	if err := gw.Stop(); err != nil {
		t.Errorf("Stop: %v", err)
	}
	if err := gw.Stop(); err != nil {
		t.Errorf("idempotent Stop: %v", err)
	}
}

// TestGateway_AttachmentHappyPath sends an .ics attachment — the
// online-appointments skill's forcing-function use case — and asserts
// the wire bytes carry a multipart/mixed wrapper with the body part
// followed by the base64-encoded calendar invite.
func TestGateway_AttachmentHappyPath(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	icsContent := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "your appointment",
		"text":    "see attached",
		"attachments": []map[string]any{
			{
				"filename":    "appointment.ics",
				"content":     base64.StdEncoding.EncodeToString([]byte(icsContent)),
				"contentType": "text/calendar; charset=utf-8; method=REQUEST",
			},
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, body)
	}

	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("forward calls = %d", len(calls))
	}
	wireBody := string(calls[0].body)
	if !strings.Contains(wireBody, "Content-Type: multipart/mixed") {
		t.Errorf("wire body missing multipart/mixed wrapper:\n%s", wireBody)
	}
	if !strings.Contains(wireBody, `filename="appointment.ics"`) {
		t.Errorf("wire body missing attachment filename:\n%s", wireBody)
	}
	if !strings.Contains(wireBody, "Content-Type: text/calendar") {
		t.Errorf("wire body missing text/calendar Content-Type:\n%s", wireBody)
	}
	// The base64-encoded ICS content must appear in the wire bytes.
	encoded := base64.StdEncoding.EncodeToString([]byte(icsContent))
	if !strings.Contains(wireBody, encoded) {
		t.Errorf("wire body missing base64-encoded ICS content:\n%s", wireBody)
	}
}

func TestGateway_AttachmentMultiple(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "two files",
		"text":    "see attached",
		"attachments": []map[string]any{
			{"filename": "first.txt", "content": base64.StdEncoding.EncodeToString([]byte("aaa"))},
			{"filename": "second.txt", "content": base64.StdEncoding.EncodeToString([]byte("bbb"))},
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, body)
	}
	wireBody := string(rec.snapshot()[0].body)
	first := strings.Index(wireBody, `filename="first.txt"`)
	second := strings.Index(wireBody, `filename="second.txt"`)
	if first < 0 || second < 0 {
		t.Fatalf("missing attachments in wire body:\n%s", wireBody)
	}
	if first > second {
		t.Errorf("attachments out of order: first.txt at %d, second.txt at %d", first, second)
	}
}

// TestGateway_AttachmentTooMany checks the per-request count cap.
func TestGateway_AttachmentTooMany(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	atts := make([]map[string]any, 11) // > maxAttachments (10)
	for i := range atts {
		atts[i] = map[string]any{
			"filename": fmt.Sprintf("file-%d.txt", i),
			"content":  base64.StdEncoding.EncodeToString([]byte("x")),
		}
	}
	resp, body := postJSON(t, url, map[string]any{
		"to":          []string{"u@example.com"},
		"subject":     "hi",
		"text":        "x",
		"attachments": atts,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", resp.StatusCode, body)
	}
	var sr emailhttp.SendResponse
	_ = json.Unmarshal(body, &sr)
	if !strings.Contains(sr.Error, "too many attachments") {
		t.Errorf("error should explain count cap: %q", sr.Error)
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward must not be called on validation failure")
	}
}

// TestGateway_AttachmentSingleOversized checks the per-attachment
// 2 MB decoded-size cap. We use a 3 MB attachment, base64-encoded, that
// still fits within the 5 MB request body cap so we exercise the
// per-attachment guard rather than the body guard.
func TestGateway_AttachmentSingleOversized(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	big := bytes.Repeat([]byte("A"), 3*1024*1024) // 3 MB > 2 MB cap
	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
		"attachments": []map[string]any{
			{"filename": "big.bin", "content": base64.StdEncoding.EncodeToString(big)},
		},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", resp.StatusCode, body)
	}
	var sr emailhttp.SendResponse
	_ = json.Unmarshal(body, &sr)
	if !strings.Contains(sr.Error, "decoded size") {
		t.Errorf("error should mention decoded size: %q", sr.Error)
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward must not be called on oversized attachment")
	}
}

func TestGateway_AttachmentBadBase64(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
		"attachments": []map[string]any{
			{"filename": "bad.bin", "content": "not-valid-base64!!"},
		},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", resp.StatusCode, body)
	}
	var sr emailhttp.SendResponse
	_ = json.Unmarshal(body, &sr)
	if !strings.Contains(sr.Error, "invalid base64") {
		t.Errorf("error should mention invalid base64: %q", sr.Error)
	}
}

func TestGateway_AttachmentValidation(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	t.Cleanup(cleanup)

	cases := []struct {
		name     string
		att      map[string]any
		wantSubs string
	}{
		{
			name:     "missing_filename",
			att:      map[string]any{"content": base64.StdEncoding.EncodeToString([]byte("x"))},
			wantSubs: "filename is required",
		},
		{
			name: "filename_with_crlf",
			att: map[string]any{
				"filename": "ok.txt\r\nBcc: evil@example.com",
				"content":  base64.StdEncoding.EncodeToString([]byte("x")),
			},
			wantSubs: "forbidden characters",
		},
		{
			name: "filename_with_quote",
			att: map[string]any{
				"filename": `evil".com`,
				"content":  base64.StdEncoding.EncodeToString([]byte("x")),
			},
			wantSubs: "forbidden characters",
		},
		{
			name: "filename_with_backslash",
			att: map[string]any{
				"filename": `evil\path.txt`,
				"content":  base64.StdEncoding.EncodeToString([]byte("x")),
			},
			wantSubs: "forbidden characters",
		},
		{
			name: "missing_content",
			att: map[string]any{
				"filename": "ok.txt",
			},
			wantSubs: "content is required",
		},
		{
			name: "empty_decoded",
			att: map[string]any{
				"filename": "ok.txt",
				"content":  base64.StdEncoding.EncodeToString([]byte{}),
			},
			wantSubs: "content is required", // empty string trips the validate() gate first
		},
		{
			name: "contenttype_with_crlf",
			att: map[string]any{
				"filename":    "ok.txt",
				"content":     base64.StdEncoding.EncodeToString([]byte("x")),
				"contentType": "text/plain\r\nBcc: evil@example.com",
			},
			wantSubs: "CR/LF",
		},
		{
			name: "contenttype_malformed",
			att: map[string]any{
				"filename":    "ok.txt",
				"content":     base64.StdEncoding.EncodeToString([]byte("x")),
				"contentType": "no-slash-here",
			},
			wantSubs: "invalid contentType",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp, body := postJSON(t, url, map[string]any{
				"to":          []string{"u@example.com"},
				"subject":     "hi",
				"text":        "x",
				"attachments": []map[string]any{tc.att},
			})
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", resp.StatusCode, body)
			}
			var sr emailhttp.SendResponse
			_ = json.Unmarshal(body, &sr)
			if !strings.Contains(sr.Error, tc.wantSubs) {
				t.Errorf("error = %q, want substring %q", sr.Error, tc.wantSubs)
			}
		})
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward must not be called on validation failure")
	}
}

// TestGateway_AttachmentDefaultContentType: omitting contentType should
// pass validation and result in application/octet-stream on the wire.
func TestGateway_AttachmentDefaultContentType(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
		"attachments": []map[string]any{
			{
				"filename": "blob",
				"content":  base64.StdEncoding.EncodeToString([]byte("opaque")),
			},
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, body)
	}
	wireBody := string(rec.snapshot()[0].body)
	if !strings.Contains(wireBody, "application/octet-stream") {
		t.Errorf("wire body should default to application/octet-stream:\n%s", wireBody)
	}
}

// TestGateway_AttachmentRejectedUnknownField: the gateway uses
// DisallowUnknownFields, so an attachment object with an unknown key
// (e.g. "cid" for inline images, which we deliberately don't support
// in phase 1) returns a 400 rather than silently ignoring the extra
// data. This is the same fail-loud posture as the rest of the gateway.
func TestGateway_AttachmentRejectedUnknownField(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, body := postJSON(t, url, map[string]any{
		"to":      []string{"u@example.com"},
		"subject": "hi",
		"text":    "x",
		"attachments": []map[string]any{
			{
				"filename": "img.png",
				"content":  base64.StdEncoding.EncodeToString([]byte("png-bytes")),
				"cid":      "logo@example.com", // not supported
			},
		},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", resp.StatusCode, body)
	}
	if len(rec.snapshot()) != 0 {
		t.Errorf("forward must not be called on unknown field")
	}
}

// TestGateway_DefaultsForward asserts NewForTesting falls back to
// email.ForwardSMTP when forward is nil. We don't actually want to dial,
// so we verify by routing to a closed port and expecting a wrapped
// connection error from the real ForwardSMTP.
func TestGateway_DefaultsForwardWhenNil(t *testing.T) {
	t.Parallel()
	gw := emailhttp.NewForTesting("127.0.0.1:0", "127.0.0.1:1", // port 1 unused
		fixedIdentity(defaultIdentity()), nil, time.Now, true)
	if err := gw.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer gw.Stop()

	resp, body := postJSON(t, "http://"+gw.Addr()+emailhttp.SendPath, map[string]any{
		"to": []string{"u@example.com"}, "subject": "hi", "text": "x",
	})
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502; body=%s", resp.StatusCode, body)
	}
	if !bytes.Contains(body, []byte("failed to connect to destination SMTP server")) {
		t.Errorf("error body should include real ForwardSMTP wrap:\n%s", body)
	}
}
