// internal/api/logging_middleware.go
package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/airo-ai-builder/budget-service/internal/auth"
)

// responseWriter wraps http.ResponseWriter to capture status code and bytes written.
type responseWriter struct {
	http.ResponseWriter
	status       int
	bytesWritten int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.bytesWritten += n
	return n, err
}

// LoggingMiddleware logs HTTP request details for each request.
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Generate request ID
		requestID := uuid.New().String()

		// Wrap response writer to capture status and size
		rw := &responseWriter{
			ResponseWriter: w,
			status:         http.StatusOK, // default if WriteHeader not called
		}

		// Add request ID to response headers
		w.Header().Set("X-Request-ID", requestID)

		// Process request
		next.ServeHTTP(rw, r)

		// Calculate duration
		duration := time.Since(start)

		// Extract subscription ID from auth context if available
		subscriptionID := ""
		if authCtx := auth.GetAuthContext(r); authCtx != nil {
			subscriptionID = authCtx.SubscriptionID
		}

		// Log access
		slog.Info("http.request",
			"requestId", requestID,
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"durationMs", duration.Milliseconds(),
			"bytesWritten", rw.bytesWritten,
			"clientIp", getClientIP(r),
			"userAgent", r.UserAgent(),
			"subscriptionId", subscriptionID,
		)
	})
}

// getClientIP extracts the client IP from the request, checking common proxy headers.
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header (may contain multiple IPs)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Return first IP in the list
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return xff[:i]
			}
		}
		return xff
	}

	// Check X-Real-IP header
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	return r.RemoteAddr
}
