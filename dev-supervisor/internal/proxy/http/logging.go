package httpproxy

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"
)

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
