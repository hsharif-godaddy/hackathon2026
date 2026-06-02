//nolint:testpackage // Tests use unexported helpers.
package httpproxy

import (
	"errors"
	"net"
	"testing"
)

// TestIsRetryableError_ResponseHeaderTimeoutNotRetryable pins the critical
// interaction between Transport.ResponseHeaderTimeout and retryTransport: the
// error net/http produces when a backend never sends response headers must NOT
// be classified as retryable. If it were, a single wedged backend would turn
// each request into a MaxRetries-deep retry storm - the exact connection-pileup
// failure mode this proxy hardening exists to prevent. A future refactor that
// makes timeouts retryable must break this test.
func TestIsRetryableError_ResponseHeaderTimeoutNotRetryable(t *testing.T) {
	// Exact text emitted by net/http on ResponseHeaderTimeout.
	err := errors.New("net/http: timeout awaiting response headers")
	if isRetryableError(err) {
		t.Fatal("response-header-timeout error must not be retryable, or the timeout becomes a retry storm")
	}
}

func TestIsRetryableError_Cases(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"response header timeout", errors.New("net/http: timeout awaiting response headers"), false},
		{"context canceled", errors.New("context canceled"), false},
		{"connection refused", errors.New("dial tcp 127.0.0.1:8080: connect: connection refused"), true},
		{"network unreachable", errors.New("connect: network is unreachable"), true},
		{"no route to host", errors.New("connect: no route to host"), true},
		{"i/o timeout", errors.New("read tcp 127.0.0.1:8080: i/o timeout"), true},
		{"no such host", errors.New("dial tcp: lookup foo: no such host"), true},
		{"net.OpError", &net.OpError{Op: "dial", Err: errors.New("synthetic")}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isRetryableError(tt.err); got != tt.want {
				t.Errorf("isRetryableError(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}
