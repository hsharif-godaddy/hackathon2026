package api

import (
	"bytes"
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

func TestLoggingMiddlewareEmitsCompleteEvent(t *testing.T) {
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(h)

	mw := newLoggingMiddleware(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
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
