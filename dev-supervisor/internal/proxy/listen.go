package proxy

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"syscall"
	"time"
)

const (
	// DefaultListenRetryAttempts is the number of bind attempts. With a
	// sleep only between them (last attempt has no trailing sleep), the
	// defaults yield up to 14 × 1s ≈ 14s of waiting. Covers the graceful
	// shutdown period of a draining allocation where the previous owner
	// may still hold the listening socket during handoff. Costs nothing
	// in the happy path (exits on first success).
	DefaultListenRetryAttempts = 15
	// DefaultListenRetryDelay is the pause between consecutive attempts.
	DefaultListenRetryDelay = time.Second
)

// ListenWithRetry retries net.Listen when the failure is EADDRINUSE,
// which happens transiently during rolling deploys when old and new
// allocations briefly coexist on the same node. Non-EADDRINUSE errors
// are returned immediately.
//
// Zero values for attempts or delay use the package defaults (15 attempts, 1s).
func ListenWithRetry(addr string, attempts int, delay time.Duration) (net.Listener, error) {
	if attempts <= 0 {
		attempts = DefaultListenRetryAttempts
	}
	if delay <= 0 {
		delay = DefaultListenRetryDelay
	}
	var lc net.ListenConfig
	var lastErr error
	for i := range attempts {
		listener, err := lc.Listen(context.Background(), "tcp", addr)
		if err == nil {
			if i > 0 {
				slog.Info("listen_retry.succeeded", "addr", addr, "attempt", i+1)
			}
			return listener, nil
		}
		if !isAddrInUse(err) {
			return nil, err
		}
		lastErr = err
		slog.Warn("listen_retry.addr_in_use", "addr", addr, "attempt", i+1, "max_attempts", attempts)
		if i < attempts-1 {
			time.Sleep(delay)
		}
	}
	return nil, lastErr
}

func isAddrInUse(err error) bool {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return errno == syscall.EADDRINUSE
	}
	return false
}
