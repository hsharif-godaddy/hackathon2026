package mhpairo

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
	Method     string
	Path       string
	AuthHeader string
	Body       []byte
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
// the server's base URL with `/api/airo/v1` appended to mimic the real shape.
func newFakeServer(t *testing.T, out *recordedRequest, status int, body string) (*Client, *httptest.Server, *mockAuth) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*out = recordedRequest{
			Method:     r.Method,
			Path:       r.URL.Path,
			AuthHeader: r.Header.Get("Authorization"),
			Body:       b,
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	auth := &mockAuth{token: "test-token"}
	c, err := New(Config{
		BaseURL: srv.URL + "/api/airo/v1",
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
			Type: "upsert",
			Secret: SecretPayload{
				Name: "STRIPE_SECRET_KEY", Value: "sk_test_fake_xyz",
				Variants: []string{"shared"}, SystemManaged: true,
			},
		},
	}
	if err := c.UpdateSecrets(context.Background(), "sub-1", "sys-1", "app-1", ops); err != nil {
		t.Fatalf("UpdateSecrets: %v", err)
	}

	if got.Method != http.MethodPost {
		t.Errorf("method: want POST, got %s", got.Method)
	}
	if want := "/api/airo/v1/subscriptions/sub-1/systems/sys-1/apps/app-1/secrets"; got.Path != want {
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
	if parsed.WorkflowName != "airo-app-secrets" {
		t.Errorf("workflowName: want airo-app-secrets, got %q", parsed.WorkflowName)
	}
	if len(parsed.Operations) != 1 || parsed.Operations[0].Secret.Name != "STRIPE_SECRET_KEY" {
		t.Errorf("operations didn't round-trip: %+v", parsed.Operations)
	}
}

func TestUpdateSecrets_DeleteOpOmitsValue(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	ops := []SecretOp{
		{Type: "delete", Secret: SecretPayload{Name: "X", Variants: []string{"shared"}, SystemManaged: true}},
	}
	if err := c.UpdateSecrets(context.Background(), "s", "y", "a", ops); err != nil {
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

	err := c.UpdateSecrets(context.Background(), "s", "y", "a", nil)
	if err == nil {
		t.Fatalf("want error on 500, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error should include status code; got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "workflow crashed") {
		t.Errorf("error should include response-body prefix; got %q", err.Error())
	}
}

func TestUpdateSecrets_ReturnsErrorOn4xx(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusBadRequest, `{"error":"invalid request"}`)

	err := c.UpdateSecrets(context.Background(), "s", "y", "a", nil)
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

	err := c.UpdateSecrets(context.Background(), "s", "y", "a", nil)
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
		BaseURL: srv.URL + "/api/airo/v1",
		Auth:    &mockAuth{err: errors.New("mint boom")},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	err = c.UpdateSecrets(context.Background(), "s", "y", "a", nil)
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

	c, err := New(Config{BaseURL: srv.URL + "/api/airo/v1", Auth: &mockAuth{token: "t"}, Timeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err = c.UpdateSecrets(ctx, "s", "y", "a", nil)
	if err == nil {
		t.Fatalf("want error on canceled context, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) && !strings.Contains(err.Error(), "context") {
		t.Errorf("error should surface context cancellation; got %q", err.Error())
	}
}

// --- UpdateApp ---

func TestUpdateApp_SendsPatchWithStatusAndVariables(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `{"id":"app-1","status":"running"}`)

	err := c.UpdateApp(context.Background(), "sub-1", "sys-1", "app-1", AppUpdate{
		Status:    "running",
		Variables: map[string]string{"STRIPE_MCP_KEY": "ek_test_fake_xyz"},
	})
	if err != nil {
		t.Fatalf("UpdateApp: %v", err)
	}

	if got.Method != http.MethodPatch {
		t.Errorf("method: want PATCH, got %s", got.Method)
	}
	if want := "/api/airo/v1/subscriptions/sub-1/systems/sys-1/apps/app-1"; got.Path != want {
		t.Errorf("path: want %q, got %q", want, got.Path)
	}

	var parsed struct {
		Status    string            `json:"status"`
		Variables map[string]string `json:"variables"`
	}
	if err := json.Unmarshal(got.Body, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.Status != "running" {
		t.Errorf("status: want running, got %q", parsed.Status)
	}
	if parsed.Variables["STRIPE_MCP_KEY"] != "ek_test_fake_xyz" {
		t.Errorf("variables didn't round-trip: %+v", parsed.Variables)
	}
}

func TestUpdateApp_OmitsEmptyFields(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	if err := c.UpdateApp(context.Background(), "s", "y", "a", AppUpdate{}); err != nil {
		t.Fatalf("UpdateApp: %v", err)
	}

	// Both fields empty → body should serialize to "{}".
	body := strings.TrimSpace(string(got.Body))
	if body != `{}` {
		t.Errorf("empty AppUpdate should serialize as {}, got %s", body)
	}
}

func TestUpdateApp_ReturnsErrorOnNon2xx(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusNotFound, `{"error":"app not found"}`)

	err := c.UpdateApp(context.Background(), "s", "y", "missing", AppUpdate{Status: "running"})
	if err == nil {
		t.Fatalf("want error on 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("error should include 404; got %q", err.Error())
	}
}

// --- ReloadApp ---

func TestReloadApp_SendsPostWithEmptyBody(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusOK, `{"status":"current"}`)

	if err := c.ReloadApp(context.Background(), "sub-1", "sys-1", "app-1"); err != nil {
		t.Fatalf("ReloadApp: %v", err)
	}

	if got.Method != http.MethodPost {
		t.Errorf("method: want POST, got %s", got.Method)
	}
	if want := "/api/airo/v1/subscriptions/sub-1/systems/sys-1/apps/app-1/reload"; got.Path != want {
		t.Errorf("path: want %q, got %q", want, got.Path)
	}
	if body := strings.TrimSpace(string(got.Body)); body != `{}` {
		t.Errorf("reload body: want {}, got %s", body)
	}
}

func TestReloadApp_ReturnsErrorOn5xx(t *testing.T) {
	var got recordedRequest
	c, _, _ := newFakeServer(t, &got, http.StatusServiceUnavailable, `reload unavailable`)

	err := c.ReloadApp(context.Background(), "s", "y", "a")
	if err == nil {
		t.Fatalf("want error on 503, got nil")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("error should include 503; got %q", err.Error())
	}
}

// --- Path escaping ---

// rawPath is the undecoded URL path as the client sent it. Go's http server
// decodes by default; RawPath is populated only when the decoded form
// differs from the bytes on the wire.
func TestClient_EscapesURLPathSegments(t *testing.T) {
	var rawPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawPath = r.URL.EscapedPath()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{BaseURL: srv.URL + "/api/airo/v1", Auth: &mockAuth{token: "t"}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// An app id with characters that would otherwise break the URL path.
	if err := c.ReloadApp(context.Background(), "sub/a", "sys b", "app?1"); err != nil {
		t.Fatalf("ReloadApp: %v", err)
	}
	if want := "/api/airo/v1/subscriptions/sub%2Fa/systems/sys%20b/apps/app%3F1/reload"; rawPath != want {
		t.Errorf("path: want %q, got %q", want, rawPath)
	}
}

// --- Config validation ---

func TestNew_RejectsMissingFields(t *testing.T) {
	if _, err := New(Config{BaseURL: "", Auth: NoopAuth{}}); err == nil {
		t.Errorf("want error for empty BaseURL, got nil")
	}
	if _, err := New(Config{BaseURL: "http://x/api/airo/v1", Auth: nil}); err == nil {
		t.Errorf("want error for nil Auth, got nil")
	}
}

func TestNew_RejectsMalformedBaseURL(t *testing.T) {
	cases := []struct {
		name, baseURL string
	}{
		{"missing scheme", "localhost:4100/api/airo/v1"},
		{"non-http scheme", "ftp://mhp/api/airo/v1"},
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
	c, err := New(Config{BaseURL: "http://x/api/airo/v1", Auth: NoopAuth{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.http.Timeout != defaultTimeout {
		t.Errorf("timeout: want %v, got %v", defaultTimeout, c.http.Timeout)
	}
}

func TestNew_StripsTrailingSlashFromBaseURL(t *testing.T) {
	c, err := New(Config{BaseURL: "http://x/api/airo/v1/", Auth: NoopAuth{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if strings.HasSuffix(c.baseURL, "/") {
		t.Errorf("baseURL should have trailing slash stripped; got %q", c.baseURL)
	}
}
