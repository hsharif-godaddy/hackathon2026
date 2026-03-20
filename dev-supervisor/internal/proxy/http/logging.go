package httpproxy

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// contextKey is an unexported type for context keys in this package.
type contextKey string

const handlerKey contextKey = "handler"

// handlerName is a mutable container stored in request context so that inner
// handlers can set the handler name and the outer logging middleware can read
// it back after ServeHTTP returns. Using a pointer avoids the problem where
// r.WithContext() creates a new *http.Request invisible to the middleware.
type handlerName struct{ name string }

// setHandler mutates the handler name stored in the context by the logging
// middleware. If no handlerName was seeded (should not happen in production),
// it is a no-op — the default "proxy" will be logged.
func setHandler(ctx context.Context, name string) {
	if hn, ok := ctx.Value(handlerKey).(*handlerName); ok {
		hn.name = name
	}
}

// handlerWithName wraps an http.HandlerFunc to set the handler name on the
// request context before delegating to the inner handler.
func handlerWithName(name string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setHandler(r.Context(), name)
		h(w, r)
	}
}

// responseWriter wraps http.ResponseWriter to capture status code and response size.
// Implements http.Hijacker and http.Flusher interfaces for WebSocket and SSE support.
type responseWriter struct {
	http.ResponseWriter

	statusCode int
	size       int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}

// Hijack implements http.Hijacker interface to support WebSocket upgrades.
// Delegates to the underlying ResponseWriter if it implements Hijacker.
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("underlying ResponseWriter does not implement http.Hijacker")
	}
	return hijacker.Hijack()
}

// Flush implements http.Flusher interface to support Server-Sent Events (SSE)
// and chunked transfer encoding. Delegates to underlying ResponseWriter if it implements Flusher.
func (rw *responseWriter) Flush() {
	if flusher, ok := rw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Seed a mutable handler name into the context so inner handlers can
		// set it and we can read it back after ServeHTTP returns.
		hn := &handlerName{name: "proxy"}
		r = r.WithContext(context.WithValue(r.Context(), handlerKey, hn))

		// Wrap response writer to capture status and size.
		wrapped := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		next.ServeHTTP(wrapped, r)

		// Log request with response details.
		duration := time.Since(start)
		clientIP := getClientIP(r)
		srcIP, srcPort := getSrcIPAndPort(r.RemoteAddr)
		rayID := getRayID(r)
		shareToken := getShareToken(r)

		logAttrs := []any{
			"type", "http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"size", wrapped.size,
			"duration_ms", duration.Milliseconds(),
			"handler", hn.name,
			"src_ip", srcIP,
			"src_port", srcPort,
		}

		// Add client_ip if present (Cloudflare CF-Connecting-IP).
		if clientIP != "" {
			logAttrs = append(logAttrs, "client_ip", clientIP)
		}

		// Add ray_id if present (Cloudflare CF-Ray for tracing).
		if rayID != "" {
			logAttrs = append(logAttrs, "ray_id", rayID)
		}

		// Add share_token if present (for analytics).
		if shareToken != "" {
			logAttrs = append(logAttrs, "share_token", shareToken)
		}

		slog.Info("http.request", logAttrs...)
	})
}
