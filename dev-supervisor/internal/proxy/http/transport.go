package httpproxy

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

// retryTransport wraps an http.RoundTripper with retry logic.
type retryTransport struct {
	base           http.RoundTripper
	maxRetries     int
	initialBackoff time.Duration
	maxBackoff     time.Duration
}

// RoundTrip implements http.RoundTripper with retry logic.
func (t *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// WebSocket upgrade requests cannot be retried - they require a unique connection
	// and the Upgrade handshake is stateful. Attempting to retry would fail.
	if isWebSocketUpgrade(req) {
		return t.base.RoundTrip(req)
	}

	var lastErr error
	backoff := t.initialBackoff

	for attempt := 0; attempt <= t.maxRetries; attempt++ {
		// Try the request
		resp, err := t.base.RoundTrip(req)

		// Success - return response
		if err == nil {
			return resp, nil
		}

		// Check if error is retryable
		if !isRetryableError(err) {
			// Non-retryable error - return immediately
			return nil, err
		}

		lastErr = err

		// Last attempt - don't wait
		if attempt == t.maxRetries {
			break
		}

		// Log retry attempt with grouped context
		slog.Debug("retrying request due to connection error",
			slog.GroupAttrs("retry",
				slog.Int("attempt", attempt+1),
				slog.Int("max", t.maxRetries),
				slog.Duration("backoff", backoff),
			),
			slog.GroupAttrs("request",
				slog.String("method", req.Method),
				slog.String("path", req.URL.Path),
			),
			slog.String("error", err.Error()),
		)

		// Wait before retry
		time.Sleep(backoff)

		// Exponential backoff with max cap
		backoff *= 2
		if backoff > t.maxBackoff {
			backoff = t.maxBackoff
		}
	}

	// All retries exhausted
	slog.Warn("all retry attempts exhausted",
		slog.GroupAttrs("retry",
			slog.Int("max", t.maxRetries),
		),
		slog.GroupAttrs("request",
			slog.String("method", req.Method),
			slog.String("path", req.URL.Path),
		),
		slog.String("error", lastErr.Error()),
	)

	return nil, lastErr
}

// isRetryableError checks if an error should trigger a retry.
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}

	errStr := err.Error()

	// Connection refused - backend not ready
	if strings.Contains(errStr, "connection refused") {
		return true
	}

	// Network unreachable
	if strings.Contains(errStr, "network is unreachable") {
		return true
	}

	// Host unreachable
	if strings.Contains(errStr, "no route to host") {
		return true
	}

	// Connection timeout
	if strings.Contains(errStr, "i/o timeout") {
		return true
	}

	// DNS lookup errors
	if strings.Contains(errStr, "no such host") {
		return true
	}

	// Check for net.OpError (low-level network errors)
	var opErr *net.OpError
	return errors.As(err, &opErr)
}
