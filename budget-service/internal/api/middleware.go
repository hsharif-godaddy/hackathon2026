package api

import (
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"
)

const maxLogFieldLen = 512

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

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// LoggingMiddleware wraps the entire handler (including mux NotFound/MethodNotAllowed) so
// every response emits an access log line.
func LoggingMiddleware(next http.Handler) http.Handler {
	return newLoggingMiddleware(slog.Default(), next)
}

func newLoggingMiddleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := newResponseWriter(w)

		next.ServeHTTP(rw, r)

		logger.Info("http.request.complete",
			"method", r.Method,
			"path", sanitizeLogValue(r.URL.Path),
			"status", rw.statusCode,
			"durationMs", time.Since(start).Milliseconds(),
			"userAgent", sanitizeLogValue(r.UserAgent()),
		)
	})
}

func sanitizeLogValue(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	runes := []rune(s)
	if len(runes) > maxLogFieldLen {
		return string(runes[:maxLogFieldLen])
	}
	return s
}
