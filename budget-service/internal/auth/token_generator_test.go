package auth

import (
	"errors"
	"sync"
	"testing"
)

func TestNewTokenGenerator_NilClient(t *testing.T) {
	t.Parallel()

	if GetClient() != nil {
		t.Skip("singleton already initialized by another test; cannot verify nil-client path")
	}

	tg, err := NewTokenGenerator()
	if err == nil {
		t.Fatal("expected error when client is nil, got nil")
	}
	if tg != nil {
		t.Fatalf("expected nil TokenGenerator, got %+v", tg)
	}
	if got, want := err.Error(), "gd-auth client not initialized: call InitClient() first"; got != want {
		t.Errorf("error = %q, want %q", got, want)
	}
}

func TestTokenGenerator_HealthyInitiallyFalse(t *testing.T) {
	t.Parallel()

	tg := &TokenGenerator{}
	if tg.Healthy() {
		t.Error("expected Healthy() == false for zero-value TokenGenerator")
	}
}

func TestTokenGenerator_HealthTracking(t *testing.T) {
	t.Parallel()

	tg := &TokenGenerator{}

	tg.mu.Lock()
	tg.healthy = true
	tg.mu.Unlock()

	if !tg.Healthy() {
		t.Error("expected Healthy() == true after setting healthy = true")
	}

	tg.mu.Lock()
	tg.healthy = false
	tg.mu.Unlock()

	if tg.Healthy() {
		t.Error("expected Healthy() == false after setting healthy = false")
	}
}

func TestTokenGenerator_LastError(t *testing.T) {
	t.Parallel()

	tg := &TokenGenerator{}

	if tg.LastError() != nil {
		t.Fatalf("expected nil LastError for zero-value, got %v", tg.LastError())
	}

	testErr := errors.New("token generation failed")
	tg.mu.Lock()
	tg.lastErr = testErr
	tg.mu.Unlock()

	if got := tg.LastError(); got != testErr {
		t.Errorf("LastError() = %v, want %v", got, testErr)
	}

	tg.mu.Lock()
	tg.lastErr = nil
	tg.mu.Unlock()

	if tg.LastError() != nil {
		t.Errorf("expected nil after clearing, got %v", tg.LastError())
	}
}

func TestTokenGenerator_ConcurrentHealthAccess(t *testing.T) {
	t.Parallel()

	tg := &TokenGenerator{}
	var wg sync.WaitGroup
	const goroutines = 100

	for i := range goroutines {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i%2 == 0 {
				tg.mu.Lock()
				tg.healthy = i%4 == 0
				tg.lastErr = errors.New("test")
				tg.mu.Unlock()
			} else {
				_ = tg.Healthy()
				_ = tg.LastError()
			}
		}(i)
	}
	wg.Wait()
}
