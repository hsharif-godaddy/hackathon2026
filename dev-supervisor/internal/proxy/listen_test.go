package proxy_test

import (
	"net"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/proxy"
)

func TestListenWithRetry_DefaultsAppliedOnZeroValues(t *testing.T) {
	t.Parallel()

	listener, err := proxy.ListenWithRetry(":0", 0, 0)
	if err != nil {
		t.Fatalf("expected success with defaults: %v", err)
	}
	defer listener.Close()
}

func TestListenWithRetry_NonRetryableReturnsImmediately(t *testing.T) {
	t.Parallel()

	start := time.Now()
	_, err := proxy.ListenWithRetry("999.999.999.999:0", 0, 0)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected error for invalid address")
	}
	if elapsed > 100*time.Millisecond {
		t.Errorf("non-retryable error should return immediately, took %v", elapsed)
	}
}

func TestListenWithRetry_ExhaustsRetriesAndReturnsLastErr(t *testing.T) {
	t.Parallel()

	blocker, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatalf("setup blocker: %v", err)
	}
	defer blocker.Close()
	addr := blocker.Addr().String()

	start := time.Now()
	_, err = proxy.ListenWithRetry(addr, 3, 10*time.Millisecond)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected EADDRINUSE error after exhausting retries")
	}
	if !strings.Contains(err.Error(), "address already in use") {
		t.Errorf("expected EADDRINUSE, got: %v", err)
	}
	// 3 attempts with 2 sleeps (last skipped) = ~20ms minimum
	if elapsed < 15*time.Millisecond {
		t.Errorf("expected at least 2 delays (~20ms), took %v", elapsed)
	}
}

func TestListenWithRetry_RetriesOnAddrInUse(t *testing.T) {
	t.Parallel()

	blocker, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatalf("setup blocker: %v", err)
	}
	addr := blocker.Addr().String()

	go func() {
		time.Sleep(60 * time.Millisecond)
		blocker.Close()
	}()

	listener, err := proxy.ListenWithRetry(addr, 5, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("expected success after retry: %v", err)
	}
	defer listener.Close()
}
