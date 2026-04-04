package api

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/gorilla/mux"
)

// responseWriter wraps http.ResponseWriter to capture status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func newResponseWriter(w http.ResponseWriter) *responseWriter {
	return &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// loggingMiddleware logs HTTP request details.
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := newResponseWriter(w)

		next.ServeHTTP(rw, r)

		slog.Info("http.request.complete",
			"method", r.Method,
			"path", sanitizeLogValue(r.URL.Path),
			"status", rw.statusCode,
			"durationMs", time.Since(start).Milliseconds(),
			"userAgent", sanitizeLogValue(r.UserAgent()),
		)
	})
}

// deadlineMiddleware sets a context deadline on every request so that
// downstream calls (embedding API, Qdrant, LLM rewrite) are cancelled
// if the overall request takes too long. Without this, goroutines can
// leak when upstream services hang because http.Server.WriteTimeout
// kills the connection but does NOT cancel r.Context().
func deadlineMiddleware(timeout time.Duration) mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// sanitizeLogValue strips control characters (newlines, CR, tabs, ANSI escapes)
// from user-supplied strings before they are written to the log, preventing
// log injection regardless of the log format (text or JSON).
func sanitizeLogValue(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
}
