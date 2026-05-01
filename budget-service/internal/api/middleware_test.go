package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSanitizeLogValueStripsControlChars(t *testing.T) {
	t.Parallel()
	if got := sanitizeLogValue("a\tb\nc"); got != "abc" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeLogValueTruncatesLongStrings(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("a", maxLogFieldLen+50)
	got := sanitizeLogValue(long)
	if len([]rune(got)) != maxLogFieldLen {
		t.Fatalf("want len %d runes, got %d", maxLogFieldLen, len([]rune(got)))
	}
}

func TestSanitizeAndTruncateStripsControlAndCapsRunes(t *testing.T) {
	t.Parallel()
	if got := sanitizeAndTruncate("a\tb\x00c", 100); got != "abc" {
		t.Fatalf("got %q", got)
	}
	long := strings.Repeat("Z", maxPayloadLogLen+100)
	got := sanitizeAndTruncate(long, maxPayloadLogLen)
	if len([]rune(got)) != maxPayloadLogLen {
		t.Fatalf("want %d runes, got %d", maxPayloadLogLen, len([]rune(got)))
	}
}

func TestLoggingMiddlewareEmitsCompleteEvent(t *testing.T) {
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}), false)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/foo", nil)
	req.Header.Set("User-Agent", "test-agent/1")
	mw.ServeHTTP(rec, req)

	out := buf.String()
	if !strings.Contains(out, "http.request.complete") {
		t.Fatalf("missing event: %s", out)
	}
	if !strings.Contains(out, `"status":418`) {
		t.Fatalf("missing status: %s", out)
	}
	if !strings.Contains(out, `"/api/v1/foo"`) {
		t.Fatalf("missing path: %s", out)
	}
}

func TestLoggingMiddlewareLogsPostRequestBody(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	payload := `{"budgetName":"test","currency":"USD"}`
	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if string(got) != payload {
			t.Fatalf("handler body: got %q want %q", got, payload)
		}
		w.WriteHeader(http.StatusCreated)
	}), true)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(payload))
	mw.ServeHTTP(rec, req)

	out := buf.String()
	if !strings.Contains(out, `"requestBody"`) {
		t.Fatalf("missing requestBody: %s", out)
	}
	if !strings.Contains(out, "budgetName") || !strings.Contains(out, "USD") {
		t.Fatalf("missing payload content: %s", out)
	}
}

func TestLoggingMiddlewareLogsPatchRequestBody(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	payload := `{"status":"closed"}`
	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if string(got) != payload {
			t.Fatalf("handler body: got %q want %q", got, payload)
		}
		w.WriteHeader(http.StatusOK)
	}), true)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/x", strings.NewReader(payload))
	mw.ServeHTTP(rec, req)

	out := buf.String()
	if !strings.Contains(out, `"requestBody"`) || !strings.Contains(out, "closed") {
		t.Fatalf("missing patch body in log: %s", out)
	}
}

func TestLoggingMiddlewareOmitsRequestBodyWhenDisabled(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}), false)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(`{"x":1}`))
	mw.ServeHTTP(rec, req)

	out := buf.String()
	if strings.Contains(out, `"requestBody":`) || strings.Contains(out, `"requestBodyRaw":`) {
		t.Fatalf("request body fields should be omitted when logging disabled: %s", out)
	}
}

func TestLoggingMiddlewareRejectsOversizedBody(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	called := false
	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), true)
	large := `{"k":"` + strings.Repeat("a", budgetMaxBodyBytes) + `"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(large))
	mw.ServeHTTP(rec, req)

	if called {
		t.Fatal("handler should not run for oversized body")
	}
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status: got %d want 413", rec.Code)
	}
	out := buf.String()
	if !strings.Contains(out, `"status":413`) {
		t.Fatalf("log should show 413: %s", out)
	}
}

func TestLoggingMiddlewarePostEmptyBody(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	handlerRan := false
	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerRan = true
		got, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("want empty body, got %q", got)
		}
		w.WriteHeader(http.StatusNoContent)
	}), true)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(""))
	mw.ServeHTTP(rec, req)

	if !handlerRan {
		t.Fatal("handler did not run")
	}
	out := buf.String()
	if !strings.Contains(out, `"requestBodyRaw":""`) {
		t.Fatalf("expected requestBodyRaw empty: %s", out)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestLoggingMiddlewarePostNoRequestReader(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("want empty body, got %q", got)
		}
		w.WriteHeader(http.StatusOK)
	}), true)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", nil)
	mw.ServeHTTP(rec, req)

	out := buf.String()
	if !strings.Contains(out, `"requestBodyRaw":""`) {
		t.Fatalf("expected requestBodyRaw empty: %s", out)
	}
	_ = rec
}

func TestLoggingMiddlewareSanitizesControlCharsInRequestBodyLog(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	payload := "{\"a\":1}\x01\x02"
	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), true)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(payload))
	mw.ServeHTTP(rec, req)

	if strings.Contains(buf.String(), "\x01") {
		t.Fatalf("control bytes should not appear in log: %s", buf.String())
	}
	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("log json: %v", err)
	}
	rb, ok := line["requestBody"].(map[string]any)
	if !ok {
		t.Fatalf("requestBody: want object, got %T %v", line["requestBody"], line["requestBody"])
	}
	if rb["a"] != float64(1) {
		t.Fatalf("requestBody.a: got %v", rb["a"])
	}
}

func TestLoggingMiddlewareTruncatesLongRequestBodyInLog(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	inner := strings.Repeat("p", maxPayloadLogLen+200)
	payload := `{"k":"` + inner + `"}`
	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), true)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(payload))
	mw.ServeHTTP(rec, req)

	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("log line json: %v", err)
	}
	rb, ok := line["requestBodyRaw"].(string)
	if !ok {
		t.Fatalf("requestBodyRaw missing or not string: %v", line)
	}
	if len([]rune(rb)) != maxPayloadLogLen {
		t.Fatalf("logged body rune count: want %d, got %d", maxPayloadLogLen, len([]rune(rb)))
	}
	_ = rec
}

func TestRequestBodyForLog(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		in     string
		wantOK bool
		check  func(t *testing.T, v any)
	}{
		{
			name:   "empty",
			in:     "",
			wantOK: false,
		},
		{
			name:   "object",
			in:     `{"a":1}`,
			wantOK: true,
			check: func(t *testing.T, v any) {
				t.Helper()
				m := v.(map[string]any)
				if m["a"] != float64(1) {
					t.Fatalf("a: %v", m["a"])
				}
			},
		},
		{
			name:   "array",
			in:     `[1,2]`,
			wantOK: true,
			check: func(t *testing.T, v any) {
				t.Helper()
				a := v.([]any)
				if len(a) != 2 {
					t.Fatalf("len: %d", len(a))
				}
			},
		},
		{
			name:   "scalar number",
			in:     `42`,
			wantOK: false,
		},
		{
			name:   "plain text",
			in:     "not json",
			wantOK: false,
		},
		{
			name:   "string field control stripped",
			in:     "{\"k\":\"a\\u0001b\"}",
			wantOK: true,
			check: func(t *testing.T, v any) {
				t.Helper()
				m := v.(map[string]any)
				if m["k"] != "ab" {
					t.Fatalf("k: %q", m["k"])
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			v, ok := requestBodyForLog(tc.in)
			if ok != tc.wantOK {
				t.Fatalf("ok: want %v got %v (v=%#v)", tc.wantOK, ok, v)
			}
			if tc.check != nil {
				tc.check(t, v)
			}
		})
	}
}

func TestRequireJSONContentTypeRejectsPOSTWithoutJSON(t *testing.T) {
	t.Parallel()
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := RequireJSONContentType(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "text/plain")
	mw.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "UNSUPPORTED_MEDIA_TYPE") {
		t.Fatalf("expected UNSUPPORTED_MEDIA_TYPE code, got %s", rec.Body.String())
	}
}

func TestRequireJSONContentTypeRejectsPATCHWithoutJSON(t *testing.T) {
	t.Parallel()
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := RequireJSONContentType(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{}`))
	mw.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestRequireJSONContentTypeAllowsJSONWithCharset(t *testing.T) {
	t.Parallel()
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	mw := RequireJSONContentType(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	mw.ServeHTTP(rec, req)
	if !called {
		t.Fatal("handler not called")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestRequireJSONContentTypePassesThroughGET(t *testing.T) {
	t.Parallel()
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	mw := RequireJSONContentType(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	mw.ServeHTTP(rec, req)
	if !called {
		t.Fatal("handler not called for GET")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestRequireJSONContentTypePassesThroughDELETE(t *testing.T) {
	t.Parallel()
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	mw := RequireJSONContentType(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	mw.ServeHTTP(rec, req)
	if !called {
		t.Fatal("handler not called for DELETE")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestRequireJSONContentTypePassesThroughPUT(t *testing.T) {
	t.Parallel()
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	mw := RequireJSONContentType(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(`{}`))
	mw.ServeHTTP(rec, req)
	if !called {
		t.Fatal("handler not called for PUT")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
}
