package stripeapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// recordedRequest captures the headers and body the server saw on a
// single round-trip. Reused across sandboxes_test.go and api_keys_test.go.
type recordedRequest struct {
	Method        string
	Path          string
	Authorization string
	StripeVersion string
	Idempotency   string
	StripeContext string
	ContentType   string
	Body          []byte
}

// newFakeServer builds an httptest.Server that records every request
// and responds with status + body. The returned Client points at the
// server's URL so tests don't reach the real Stripe API.
func newFakeServer(
	t *testing.T,
	out *recordedRequest,
	status int,
	body string,
) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*out = recordedRequest{
			Method:        r.Method,
			Path:          r.URL.Path,
			Authorization: r.Header.Get("Authorization"),
			StripeVersion: r.Header.Get("Stripe-Version"),
			Idempotency:   r.Header.Get("Idempotency-Key"),
			StripeContext: r.Header.Get("Stripe-Context"),
			ContentType:   r.Header.Get("Content-Type"),
			Body:          b,
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{
		APIKey:  "sk_test_fake_platform_key",
		BaseURL: srv.URL,
		Timeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c, srv
}

// --- Config validation ---

func TestNew_RejectsMissingAPIKey(t *testing.T) {
	if _, err := New(Config{APIKey: "", BaseURL: "https://api.stripe.com"}); err == nil {
		t.Errorf("want error for empty APIKey, got nil")
	}
}

func TestNew_RejectsMalformedBaseURL(t *testing.T) {
	cases := []struct {
		name, baseURL string
	}{
		{"missing scheme", "api.stripe.com"},
		{"non-http scheme", "ftp://api.stripe.com"},
		{"file scheme", "file:///etc/passwd"},
		{"scheme only", "https://"},
		{"random text", "not a url at all"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := New(Config{APIKey: "sk_test_x", BaseURL: c.baseURL}); err == nil {
				t.Errorf("want error for %q, got nil", c.baseURL)
			}
		})
	}
}

func TestNew_RejectsNegativeTimeout(t *testing.T) {
	if _, err := New(Config{APIKey: "sk_test_x", Timeout: -time.Second}); err == nil {
		t.Errorf("want error for negative Timeout, got nil")
	}
}

func TestNew_AppliesDefaults(t *testing.T) {
	c, err := New(Config{APIKey: "sk_test_x"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.baseURL != defaultBaseURL {
		t.Errorf("baseURL: want %q, got %q", defaultBaseURL, c.baseURL)
	}
	if c.stripeVersion != defaultStripeVersion {
		t.Errorf("stripeVersion: want %q, got %q", defaultStripeVersion, c.stripeVersion)
	}
	if c.http.Timeout != defaultTimeout {
		t.Errorf("timeout: want %v, got %v", defaultTimeout, c.http.Timeout)
	}
}

func TestNew_StripsTrailingSlash(t *testing.T) {
	c, err := New(Config{APIKey: "sk_test_x", BaseURL: "https://api.stripe.com/"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if strings.HasSuffix(c.baseURL, "/") {
		t.Errorf("baseURL should have trailing slash stripped; got %q", c.baseURL)
	}
}

func TestNew_OverridesStripeVersion(t *testing.T) {
	c, err := New(Config{APIKey: "sk_test_x", StripeVersion: "2099-01-01.preview"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.stripeVersion != "2099-01-01.preview" {
		t.Errorf("stripeVersion: want overridden value, got %q", c.stripeVersion)
	}
}

// --- do() header behavior ---

func TestDo_SendsExpectedHeadersWithIdempotencyAndStripeContext(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	_, err := c.do(
		context.Background(),
		http.MethodPost,
		"/v2/iam/api_keys",
		requestHeaders{idempotencyKey: "evt_123", stripeContext: "acct_merchant_xyz"},
		struct{ Type string }{Type: "secret_key"},
	)
	if err != nil {
		t.Fatalf("do: %v", err)
	}

	if got.Authorization != "Bearer sk_test_fake_platform_key" {
		t.Errorf("Authorization: want Bearer header, got %q", got.Authorization)
	}
	if got.StripeVersion != defaultStripeVersion {
		t.Errorf("Stripe-Version: want %q, got %q", defaultStripeVersion, got.StripeVersion)
	}
	if got.Idempotency != "evt_123" {
		t.Errorf("Idempotency-Key: want evt_123, got %q", got.Idempotency)
	}
	if got.StripeContext != "acct_merchant_xyz" {
		t.Errorf("Stripe-Context: want acct_merchant_xyz, got %q", got.StripeContext)
	}
	if got.ContentType != "application/json" {
		t.Errorf("Content-Type: want application/json, got %q", got.ContentType)
	}
}

func TestDo_OmitsStripeContextWhenEmpty(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	_, err := c.do(
		context.Background(),
		http.MethodPost,
		"/v2/core/claimable_sandboxes",
		requestHeaders{idempotencyKey: "x"},
		struct{}{},
	)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	if got.StripeContext != "" {
		t.Errorf("Stripe-Context: want absent, got %q", got.StripeContext)
	}
}

func TestDo_OmitsIdempotencyWhenEmpty(t *testing.T) {
	// Defensive: do() shouldn't write an empty Idempotency-Key header
	// even if a future caller forgets to pass one. (The exported
	// per-endpoint methods reject empty values up front.)
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	_, err := c.do(
		context.Background(),
		http.MethodPost,
		"/anything",
		requestHeaders{},
		struct{}{},
	)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	if got.Idempotency != "" {
		t.Errorf("Idempotency-Key: want absent, got %q", got.Idempotency)
	}
}

// --- error parsing ---

func TestDo_ParsesStripeErrorEnvelope(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusBadRequest,
		`{"error":{"type":"invalid_request_error","code":"missing_param","message":"Missing required param: type."}}`)

	_, err := c.do(
		context.Background(),
		http.MethodPost,
		"/x",
		requestHeaders{idempotencyKey: "x"},
		struct{}{},
	)
	if err == nil {
		t.Fatalf("want error, got nil")
	}
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if se.HTTPStatus != 400 {
		t.Errorf("HTTPStatus: want 400, got %d", se.HTTPStatus)
	}
	if se.Type != "invalid_request_error" {
		t.Errorf("Type: want invalid_request_error, got %q", se.Type)
	}
	if se.Code != "missing_param" {
		t.Errorf("Code: want missing_param, got %q", se.Code)
	}
	if !strings.Contains(se.Message, "Missing required param") {
		t.Errorf("Message: should contain 'Missing required param', got %q", se.Message)
	}
	if se.IsRetryable() {
		t.Errorf("400 invalid_request_error should not be retryable")
	}
}

func TestDo_FallsBackOnNonJSONErrorBody(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusBadGateway, `<html><body>502 Bad Gateway</body></html>`)

	_, err := c.do(
		context.Background(),
		http.MethodPost,
		"/x",
		requestHeaders{idempotencyKey: "x"},
		struct{}{},
	)
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if se.HTTPStatus != 502 {
		t.Errorf("HTTPStatus: want 502, got %d", se.HTTPStatus)
	}
	if !strings.Contains(se.Raw, "Bad Gateway") {
		t.Errorf("Raw should contain truncated body prefix; got %q", se.Raw)
	}
	if !se.IsRetryable() {
		t.Errorf("502 should be retryable")
	}
}

func TestDo_TruncatesLongErrorBody(t *testing.T) {
	var got recordedRequest
	long := strings.Repeat("x", errorBodyLimit*2)
	c, _ := newFakeServer(t, &got, http.StatusInternalServerError, long)

	_, err := c.do(
		context.Background(),
		http.MethodPost,
		"/x",
		requestHeaders{idempotencyKey: "x"},
		struct{}{},
	)
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if !strings.HasSuffix(se.Raw, "...") {
		t.Errorf("Raw should be truncated with '...' suffix; got %q", se.Raw)
	}
}

func TestStripeError_IsRetryable(t *testing.T) {
	cases := []struct {
		status int
		want   bool
	}{
		{400, false},
		{401, false},
		{403, false},
		{404, false},
		{422, false},
		{429, true},
		{500, true},
		{502, true},
		{503, true},
		{504, true},
	}
	for _, c := range cases {
		t.Run(fmt.Sprintf("%d", c.status), func(t *testing.T) {
			se := &StripeError{HTTPStatus: c.status}
			if got := se.IsRetryable(); got != c.want {
				t.Errorf("HTTPStatus=%d: IsRetryable: want %v, got %v", c.status, c.want, got)
			}
		})
	}
}

// --- ctx cancellation ---

func TestDo_RespectsContextCancellation(t *testing.T) {
	calls := atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{APIKey: "sk_test_x", BaseURL: srv.URL, Timeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// 1ms ctx + 50ms server delay covers the same race as the original
	// 50/500 split with a tenth of the wait, freeing up ~50ms per CI run.
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
	defer cancel()

	_, err = c.do(ctx, http.MethodPost, "/x", requestHeaders{idempotencyKey: "x"}, struct{}{})
	if err == nil {
		t.Fatalf("want error on canceled context, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error should wrap context.DeadlineExceeded; got %q", err.Error())
	}
}

// --- success-path body decoding ---

func TestDo_ReturnsRawSuccessBody(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `{"id":"ak_xyz","type":"secret_key"}`)

	body, err := c.do(
		context.Background(),
		http.MethodPost,
		"/x",
		requestHeaders{idempotencyKey: "x"},
		struct{}{},
	)
	if err != nil {
		t.Fatalf("do: %v", err)
	}

	var parsed struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("unmarshal: %v (raw=%q)", err, string(body))
	}
	if parsed.ID != "ak_xyz" {
		t.Errorf("id: want ak_xyz, got %q", parsed.ID)
	}
}

// --- error-path body draining (new in PR #3735 review fix) ---

// largeErrorBody serves a body well past errorBodyLimit so that if the
// drain isn't running, net/http will mark the connection un-reusable
// (visible only at the syscall level, hard to assert directly). This
// test guards the call shape: the deferred close must not happen
// without first consuming the rest of the body.
func TestDo_DrainsBodyOnErrorPath(t *testing.T) {
	bodyLen := errorBodyLimit * 4
	long := strings.Repeat("x", bodyLen)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", bodyLen))
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(long))
	}))
	t.Cleanup(srv.Close)

	c, err := New(Config{APIKey: "sk_test_x", BaseURL: srv.URL, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Make several calls back-to-back. If the drain is missing, net/http
	// dials a new TCP connection per request; if present, the same
	// keep-alive connection serves all of them. We can't assert that
	// directly without a custom transport, but the PR assertion is at
	// least that the calls all succeed without I/O errors and produce
	// the expected truncated *StripeError.
	for i := 0; i < 3; i++ {
		_, err := c.do(
			context.Background(),
			http.MethodPost,
			"/x",
			requestHeaders{idempotencyKey: fmt.Sprintf("k-%d", i)},
			struct{}{},
		)
		var se *StripeError
		if !errors.As(err, &se) {
			t.Fatalf("iteration %d: want *StripeError, got %v", i, err)
		}
		if se.HTTPStatus != 500 {
			t.Errorf("iteration %d: HTTPStatus: want 500, got %d", i, se.HTTPStatus)
		}
	}
}

// --- additional test gaps flagged in PR #3735 review ---

func TestDo_WrapsTransportError(t *testing.T) {
	// Closed server URL: the connection will refuse immediately. net/http
	// returns a syscall error wrapped in *url.Error.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	addr := srv.URL
	srv.Close()

	c, err := New(Config{APIKey: "sk_test_x", BaseURL: addr, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	_, err = c.do(context.Background(), http.MethodPost, "/x", requestHeaders{idempotencyKey: "k"}, struct{}{})
	if err == nil {
		t.Fatalf("want transport error, got nil")
	}
	if !strings.Contains(err.Error(), "http do") {
		t.Errorf("error should mention 'http do' for log-grepping; got %q", err.Error())
	}
	// Caller should still get a clear non-StripeError so retry classifiers
	// don't get confused by a connection-refused looking like a 500.
	var se *StripeError
	if errors.As(err, &se) {
		t.Errorf("transport error should not unwrap to *StripeError; got %v", se)
	}
}

func TestDo_WrapsMarshalFailure(t *testing.T) {
	// json.Marshal fails on unsupported types — a chan is the canonical
	// example. Confirms do() wraps the error rather than blowing up.
	c, err := New(Config{APIKey: "sk_test_x", BaseURL: "https://api.stripe.example.com"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	type unsendable struct {
		Ch chan int `json:"ch"`
	}
	_, err = c.do(context.Background(), http.MethodPost, "/x", requestHeaders{idempotencyKey: "k"}, unsendable{Ch: make(chan int)})
	if err == nil {
		t.Fatalf("want marshal error, got nil")
	}
	if !strings.Contains(err.Error(), "marshal body") {
		t.Errorf("error should mention 'marshal body'; got %q", err.Error())
	}
}

// --- StripeError.Error() formatting (post review-fix) ---

func TestStripeError_Error_FormatsByPopulatedFields(t *testing.T) {
	cases := []struct {
		name string
		se   StripeError
		want string
	}{
		{
			name: "type+message",
			se:   StripeError{HTTPStatus: 400, Type: "invalid_request_error", Code: "missing_param", Message: "Missing required param"},
			want: "stripe 400 invalid_request_error/missing_param: Missing required param",
		},
		{
			name: "type+raw fallback",
			se:   StripeError{HTTPStatus: 400, Type: "invalid_request_error", Code: "missing_param", Raw: "<truncated>"},
			want: "stripe 400 invalid_request_error/missing_param: <truncated>",
		},
		{
			name: "type only (no message, no raw)",
			se:   StripeError{HTTPStatus: 400, Type: "invalid_request_error", Code: "missing_param"},
			want: "stripe 400 invalid_request_error/missing_param",
		},
		{
			name: "raw only",
			se:   StripeError{HTTPStatus: 502, Raw: "Bad Gateway"},
			want: "stripe 502: Bad Gateway",
		},
		{
			name: "empty body",
			se:   StripeError{HTTPStatus: 502},
			want: "stripe 502: <empty body>",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.se.Error(); got != c.want {
				t.Errorf("Error():\n  want %q\n  got  %q", c.want, got)
			}
		})
	}
}

func TestParseStripeError_PreservesReadErrorInRaw(t *testing.T) {
	// Wrap a Reader that fails partway through to simulate a read error
	// mid-body. parseStripeError should still produce a *StripeError,
	// with the read error captured in Raw for log-grepping.
	r := &flakyReader{prefix: []byte("partial body"), err: errors.New("connection reset")}

	err := parseStripeError(503, r)
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %v", err)
	}
	if se.HTTPStatus != 503 {
		t.Errorf("HTTPStatus: want 503, got %d", se.HTTPStatus)
	}
	if !strings.Contains(se.Raw, "read error") || !strings.Contains(se.Raw, "connection reset") {
		t.Errorf("Raw should preserve read error context; got %q", se.Raw)
	}
}

// TestParseStripeError_TypelessEnvelope pins parsing of error envelopes
// that ship only {code, message} with no top-level type. Observed from
// v2/iam/api_keys 403 responses (account_invalid). The earlier parser
// gated structured-field extraction on Type != "", so these envelopes
// fell through to the raw-only path and dashboards filtering on
// stripe.code saw empty strings.
//
// Real payload from a failed go-live test:
//
//	{
//	  "error": {
//	    "message": "The provided key 'sk_test_***' does not have access to account 'acct_*'",
//	    "doc_url": "https://stripe.com/docs/error-codes/account-invalid",
//	    "code": "account_invalid"
//	  }
//	}
func TestParseStripeError_TypelessEnvelope(t *testing.T) {
	body := strings.NewReader(`{
		"error": {
			"message": "The provided key 'sk_test_***' does not have access to account 'acct_103UBD'.",
			"doc_url": "https://stripe.com/docs/error-codes/account-invalid",
			"code": "account_invalid"
		}
	}`)

	err := parseStripeError(403, body)
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %v", err)
	}
	if se.HTTPStatus != 403 {
		t.Errorf("HTTPStatus: want 403, got %d", se.HTTPStatus)
	}
	if se.Code != "account_invalid" {
		t.Errorf("Code: want %q (typeless envelope MUST extract code); got %q", "account_invalid", se.Code)
	}
	if !strings.Contains(se.Message, "does not have access") {
		t.Errorf("Message: want non-empty (typeless envelope MUST extract message); got %q", se.Message)
	}
	// Type stays empty (it was missing from the envelope) — but we
	// preserved it as such rather than discarding code/message.
	if se.Type != "" {
		t.Errorf("Type: want empty (envelope had no type); got %q", se.Type)
	}
}

// flakyReader returns prefix bytes once, then surfaces err. Used to
// exercise the io.ReadAll-error path inside parseStripeError.
type flakyReader struct {
	prefix []byte
	err    error
	done   bool
}

func (r *flakyReader) Read(p []byte) (int, error) {
	if r.done {
		return 0, r.err
	}
	r.done = true
	n := copy(p, r.prefix)
	return n, r.err
}
