package hosting

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// recordedRequest captures what the server saw. Populated by the test HTTP
// handler, read by assertions after the call returns.
type recordedRequest struct {
	Method       string
	Path         string
	AuthHeader   string
	SourceHeader string
	RequestIDHdr string
	Body         []byte
}

// mockAuth implements AuthProvider. Used across all client tests — not
// worth a separate per-test fake when the mock is this trivial.
type mockAuth struct {
	token    string
	err      error
	calls    atomic.Int32
	lastCtx  context.Context
	lastHeld *http.Request
}

func (m *mockAuth) ApplyAuth(ctx context.Context, req *http.Request) error {
	m.calls.Add(1)
	m.lastCtx = ctx
	m.lastHeld = req
	if m.err != nil {
		return m.err
	}
	req.Header.Set("Authorization", "Bearer "+m.token)
	return nil
}

func (*mockAuth) Name() string { return "mock" }

// newFakeServer builds an httptest.Server that records every request to
// `out` and responds with `status` + `body`. The returned Client points at
// the server's base URL — hosting's path prefix ("/hosting/v1/...") is
// appended by the client itself.
func newFakeServer(t *testing.T, out *recordedRequest, status int, body string) (*Client, *httptest.Server, *mockAuth) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*out = recordedRequest{
			Method:       r.Method,
			Path:         r.URL.EscapedPath(),
			AuthHeader:   r.Header.Get("Authorization"),
			SourceHeader: r.Header.Get("X-Source-Service"),
			RequestIDHdr: r.Header.Get("X-Request-ID"),
			Body:         b,
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	auth := &mockAuth{token: "test-token"}
	c, err := New(Config{
		BaseURL: srv.URL,
		Auth:    auth,
		Timeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c, srv, auth
}

// --- UpdateSecrets ---

func TestUpdateSecrets_SendsExpectedRequest(t *testing.T) {
	var got recordedRequest
	c, _, auth := newFakeServer(t, &got, http.StatusOK, `{"message":"secrets updated","secretsUpdated":true}`)

	ops := []SecretOp{
		{
			Type: SecretOpUpsert,
			Secret: SecretPayload{
				Name: "STRIPE_SECRET_KEY", Value: "sk_test_fake_xyz",
				Variants: []string{"preview"}, SystemManaged: true,
			},
		},
	}
	if err := c.UpdateSecrets(context.Background(), "app-1", ops); err != nil {
		t.Fatalf("UpdateSecrets: %v", err)
	}

	if got.Method != http.MethodPost {
		t.Errorf("method: want POST, got %s", got.Method)
	}
	if want := "/hosting/v1/apps/app-1/secrets"; got.Path != want {
		t.Errorf("path: want %q, got %q", want, got.Path)
	}
	if got.AuthHeader != "Bearer test-token" {
		t.Errorf("Authorization: want %q, got %q", "Bearer test-token", got.AuthHeader)
	}
	if auth.calls.Load() != 1 {
		t.Errorf("auth.calls: want 1, got %d", auth.calls.Load())
	}

	var parsed struct {
		Operations   []SecretOp `json:"operations"`
		WorkflowName string     `json:"workflowName"`
	}
	if err := json.Unmarshal(got.Body, &parsed); err != nil {
		t.Fatalf("unmarshal body: %v (raw=%q)", err, string(got.Body))
	}
	if parsed.WorkflowName != defaultWorkflowName {
		t.Errorf("workflowName: want %q, got %q", defaultWorkflowName, parsed.WorkflowName)
	}
	if len(parsed.Operations) != 1 || parsed.Operations[0].Secret.Name != "STRIPE_SECRET_KEY" {
		t.Errorf("operations didn't round-trip: %+v", parsed.Operations)
	}
}

// TestUpdateSecrets_SetsAuditHeaders pins X-Source-Service and X-Request-ID
// on the outgoing request. Hosting's structured logging + secrets-handler
// CallerContext consume both; airo-go's proxy sets the same pair when it
// forwards customer secret writes. Without these, our writes show up in
// hosting's logs as anonymous admin-token traffic.
func TestUpdateSecrets_SetsAuditHeaders(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `{"message":"ok","secretsUpdated":true}`)

	if err := c.UpdateSecrets(context.Background(), "app-1", []SecretOp{{
		Type:   SecretOpUpsert,
		Secret: SecretPayload{Name: "K", Value: "v", Variants: []string{"preview"}, SystemManaged: true},
	}}); err != nil {
		t.Fatalf("UpdateSecrets: %v", err)
	}

	if got.SourceHeader != "stripe-service" {
		t.Errorf("X-Source-Service: want %q, got %q", "stripe-service", got.SourceHeader)
	}
	// X-Request-ID format is "req_" + 16 hex chars (per newRequestID); pin
	// the prefix and length so a future refactor that drops the header — or
	// silently changes generation — fails this assertion.
	if !strings.HasPrefix(got.RequestIDHdr, "req_") || len(got.RequestIDHdr) != 20 {
		t.Errorf("X-Request-ID: want %q + 16 hex chars, got %q", "req_", got.RequestIDHdr)
	}
}

// TestUpdateSecrets_SerializesProtectedFlag pins the wire format for the
// agent-only MCP key path. omitempty on Protected (*bool) means unset ops
// MUST NOT include the field at all (else hosting could misinterpret it on
// schemas that distinguish missing vs false).
func TestUpdateSecrets_SerializesProtectedFlag(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	ops := []SecretOp{
		{Type: SecretOpUpsert, Secret: SecretPayload{
			Name: "STRIPE_MCP_KEY", Value: "ek_test_x",
			Protected: boolPtrLocal(true), SystemManaged: true,
		}},
		{Type: SecretOpUpsert, Secret: SecretPayload{
			Name: "STRIPE_SECRET_KEY", Value: "sk_test_x",
			Variants: []string{"preview"}, SystemManaged: true,
		}},
	}
	if err := c.UpdateSecrets(context.Background(), "app-1", ops); err != nil {
		t.Fatalf("UpdateSecrets: %v", err)
	}

	body := string(got.Body)
	if !strings.Contains(body, `"protected":true`) {
		t.Errorf("MCP op should serialize protected:true; body=%s", body)
	}
	// Count occurrences of "protected" — should be exactly one (the MCP op).
	// The sk op has Protected nil and must be omitted via omitempty.
	if c := strings.Count(body, `"protected"`); c != 1 {
		t.Errorf("want exactly one \"protected\" field in body; got %d (body=%s)", c, body)
	}
}

func TestUpdateSecrets_DeleteOpOmitsValue(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	ops := []SecretOp{
		{Type: SecretOpDelete, Secret: SecretPayload{Name: "X", Variants: []string{"preview"}, SystemManaged: true}},
	}
	if err := c.UpdateSecrets(context.Background(), "a", ops); err != nil {
		t.Fatalf("UpdateSecrets: %v", err)
	}

	// omitempty on Value: the serialized body must not contain "value":"".
	if strings.Contains(string(got.Body), `"value"`) {
		t.Errorf("delete op body should omit the value field; got %s", string(got.Body))
	}
}

func TestUpdateSecrets_ReturnsErrorOn5xx(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusInternalServerError, `{"error":"workflow crashed"}`)

	err := c.UpdateSecrets(context.Background(), "a", nil)
	if err == nil {
		t.Fatalf("want error on 500, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error should include status code; got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "workflow crashed") {
		t.Errorf("error should include response-body prefix; got %q", err.Error())
	}

	// Pin: callers can errors.As to inspect the status. Retry helpers
	// classify 5xx as retryable and 4xx as terminal via this field.
	var httpErr *HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("want errors.As(*HTTPError), got %T: %v", err, err)
	}
	if httpErr.Status != http.StatusInternalServerError {
		t.Errorf("HTTPError.Status: want 500, got %d", httpErr.Status)
	}
	if httpErr.OpName != "update-secrets" {
		t.Errorf("HTTPError.OpName: want update-secrets, got %q", httpErr.OpName)
	}
}

func TestUpdateSecrets_ReturnsErrorOn4xx(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusBadRequest, `{"error":"invalid request"}`)

	err := c.UpdateSecrets(context.Background(), "a", nil)
	if err == nil {
		t.Fatalf("want error on 400, got nil")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("error should include status code; got %q", err.Error())
	}
}

func TestUpdateSecrets_TruncatesLongErrorBodies(t *testing.T) {
	var got recordedRequest
	longBody := strings.Repeat("x", errorBodyLimit*2)
	c, _, _ := newFakeServer(t, &got, http.StatusBadGateway, longBody)

	err := c.UpdateSecrets(context.Background(), "a", nil)
	if err == nil {
		t.Fatalf("want error, got nil")
	}
	if !strings.Contains(err.Error(), "…") {
		t.Errorf("error should be truncated with ellipsis; got %q", err.Error())
	}
	if len(err.Error()) > errorBodyLimit+200 { // 200 = generous prefix/suffix for the wrapper text
		t.Errorf("error message too long (%d bytes) — truncation didn't fire", len(err.Error()))
	}
}

func TestUpdateSecrets_PropagatesAuthError(t *testing.T) {
	// Build a server that would fail the test if it received a request.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Errorf("server should not receive a request when auth fails")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{
		BaseURL: srv.URL,
		Auth:    &mockAuth{err: errors.New("mint boom")},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	err = c.UpdateSecrets(context.Background(), "a", nil)
	if err == nil {
		t.Fatalf("want error, got nil")
	}
	if !strings.Contains(err.Error(), "mint boom") {
		t.Errorf("error should wrap auth error; got %q", err.Error())
	}
}

func TestUpdateSecrets_RespectsContextCancellation(t *testing.T) {
	// Server sleeps longer than the ctx allows.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		time.Sleep(500 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{BaseURL: srv.URL, Auth: &mockAuth{token: "t"}, Timeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err = c.UpdateSecrets(ctx, "a", nil)
	if err == nil {
		t.Fatalf("want error on canceled context, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) && !strings.Contains(err.Error(), "context") {
		t.Errorf("error should surface context cancellation; got %q", err.Error())
	}
}

// TestUpdateSecrets_DetectsPartialFailure pins the 200-with-partial-failure
// behavior. Hosting and the local-control-plane stub can return 200 even
// when some operations fail; the client must surface that as an error so
// callers don't proceed thinking the alloc env is fully populated.
func TestUpdateSecrets_DetectsPartialFailure(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK,
		`{"message":"partial","partialFailure":true,"failedCount":2,"secretsUpdated":true}`)

	err := c.UpdateSecrets(context.Background(), "a", []SecretOp{
		{Type: SecretOpUpsert, Secret: SecretPayload{Name: "X", Value: "v"}},
	})
	if err == nil {
		t.Fatalf("want error on partial failure, got nil")
	}
	if !strings.Contains(err.Error(), "partial failure") {
		t.Errorf("error should mention partial failure; got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "2") {
		t.Errorf("error should include failed count; got %q", err.Error())
	}
}

// TestUpdateSecrets_SuccessOnEmpty200Body tolerates a 200 with an empty
// body (as some intermediaries return). Should NOT be treated as partial
// failure — io.EOF on the decode is handled.
func TestUpdateSecrets_SuccessOnEmpty200Body(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, ``)
	if err := c.UpdateSecrets(context.Background(), "a", nil); err != nil {
		t.Fatalf("UpdateSecrets on empty 200 body: %v", err)
	}
}

// TestUpdateSecrets_FailsOnUnparseable200Body pins the inverse of
// SuccessOnEmpty200Body: a non-empty 200 body that doesn't parse as JSON
// MUST surface as an error. The decode is the only mechanism for catching
// partialFailure:true, so silently swallowing a decode error would let a
// corrupt-but-2xx response (LB returning HTML, gzip-without-negotiation,
// truncated stream, future schema reshape) write the DDB row anyway.
func TestUpdateSecrets_FailsOnUnparseable200Body(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `<html><body>500 Internal Server Error</body></html>`)

	err := c.UpdateSecrets(context.Background(), "a", nil)
	if err == nil {
		t.Fatalf("want error on unparseable 200 body, got nil")
	}
	if !strings.Contains(err.Error(), "undecodable") && !strings.Contains(err.Error(), "decode") {
		t.Errorf("error should indicate decode failure; got %q", err.Error())
	}
	// Specifically NOT an *HTTPError — this is a 200 with a parse problem,
	// not an HTTP-level error.
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		t.Errorf("decode-failure error should not be *HTTPError; got %v", httpErr)
	}
}

// --- Path escaping ---

// TestClient_EscapesAppIDInPath verifies the client URL-encodes the appId
// segment so a bizarre app ID (e.g. one containing slashes from a typo)
// can't break URL parsing.
func TestClient_EscapesAppIDInPath(t *testing.T) {
	var rawPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawPath = r.URL.EscapedPath()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{BaseURL: srv.URL, Auth: &mockAuth{token: "t"}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if err := c.UpdateSecrets(context.Background(), "app/with?punct", nil); err != nil {
		t.Fatalf("UpdateSecrets: %v", err)
	}
	if want := "/hosting/v1/apps/app%2Fwith%3Fpunct/secrets"; rawPath != want {
		t.Errorf("path: want %q, got %q", want, rawPath)
	}
}

// --- Config validation ---

func TestNew_RejectsMissingFields(t *testing.T) {
	if _, err := New(Config{BaseURL: "", Auth: NoopAuth{}}); err == nil {
		t.Errorf("want error for empty BaseURL, got nil")
	}
	if _, err := New(Config{BaseURL: "http://x", Auth: nil}); err == nil {
		t.Errorf("want error for nil Auth, got nil")
	}
}

func TestNew_RejectsMalformedBaseURL(t *testing.T) {
	cases := []struct {
		name, baseURL string
	}{
		{"missing scheme", "localhost:4100"},
		{"non-http scheme", "ftp://hosting"},
		{"file scheme", "file:///etc/passwd"},
		{"scheme only", "https://"},
		{"random text", "not a url at all"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := New(Config{BaseURL: c.baseURL, Auth: NoopAuth{}}); err == nil {
				t.Errorf("want error for %q, got nil", c.baseURL)
			}
		})
	}
}

func TestNew_AppliesDefaultTimeout(t *testing.T) {
	c, err := New(Config{BaseURL: "http://x", Auth: NoopAuth{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.http.Timeout != defaultTimeout {
		t.Errorf("timeout: want %v, got %v", defaultTimeout, c.http.Timeout)
	}
}

func TestNew_StripsTrailingSlashFromBaseURL(t *testing.T) {
	c, err := New(Config{BaseURL: "http://x/", Auth: NoopAuth{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if strings.HasSuffix(c.baseURL, "/") {
		t.Errorf("baseURL should have trailing slash stripped; got %q", c.baseURL)
	}
}

func TestNew_AppliesCustomWorkflowName(t *testing.T) {
	var got recordedRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got.Body = b
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{BaseURL: srv.URL, Auth: &mockAuth{token: "t"}, WorkflowName: "custom-workflow"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := c.UpdateSecrets(context.Background(), "a", nil); err != nil {
		t.Fatalf("UpdateSecrets: %v", err)
	}
	if !strings.Contains(string(got.Body), `"workflowName":"custom-workflow"`) {
		t.Errorf("custom workflow name should appear in body; got %s", string(got.Body))
	}
}

// boolPtrLocal is a test-only helper that mirrors the boolPtr helper in the
// api package (which is package-private there). Kept private here so it
// doesn't leak from the hosting package's exported surface.
func boolPtrLocal(b bool) *bool { return &b }
