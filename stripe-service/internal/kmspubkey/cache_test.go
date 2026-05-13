package kmspubkey

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// --- New ---

func TestNew_RejectsNilKMS(t *testing.T) {
	if _, err := New(nil, testKeyID); err == nil {
		t.Errorf("want error for nil kms, got nil")
	}
}

func TestNew_RejectsEmptyKeyID(t *testing.T) {
	if _, err := New(&fakeKMS{}, ""); err == nil {
		t.Errorf("want error for empty keyID, got nil")
	}
}

// --- PEM caching discipline ---

func TestPEM_FetchesAndCachesOnFirstCall(t *testing.T) {
	fk := &fakeKMS{out: goodOutput(t)}
	c, err := New(fk, testKeyID)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	pem1, err := c.PEM(context.Background())
	if err != nil {
		t.Fatalf("PEM (first): %v", err)
	}
	if !strings.Contains(pem1, "BEGIN PUBLIC KEY") {
		t.Errorf("PEM missing PKIX header: %q", pem1)
	}
	if got := fk.callCount.Load(); got != 1 {
		t.Errorf("KMS call count: want 1, got %d", got)
	}
}

func TestPEM_ReturnsCachedValueOnSubsequentCalls(t *testing.T) {
	fk := &fakeKMS{out: goodOutput(t)}
	c, _ := New(fk, testKeyID)

	first, err := c.PEM(context.Background())
	if err != nil {
		t.Fatalf("PEM first call: %v", err)
	}
	for i := 0; i < 5; i++ {
		got, err := c.PEM(context.Background())
		if err != nil {
			t.Fatalf("PEM call %d: %v", i+2, err)
		}
		if got != first {
			t.Errorf("PEM call %d: cached value drifted", i+2)
		}
	}
	if got := fk.callCount.Load(); got != 1 {
		t.Errorf("KMS call count: want 1, got %d (cache failed)", got)
	}
}

func TestPEM_CachesErrorAndStopsRetrying(t *testing.T) {
	kmsErr := errors.New("AccessDeniedException")
	fk := &fakeKMS{err: kmsErr}
	c, _ := New(fk, testKeyID)

	for i := 0; i < 3; i++ {
		_, err := c.PEM(context.Background())
		if err == nil {
			t.Fatalf("PEM call %d: want error, got nil", i+1)
		}
		if !errors.Is(err, kmsErr) {
			t.Errorf("PEM call %d: error should wrap KMS error; got %v", i+1, err)
		}
	}
	if got := fk.callCount.Load(); got != 1 {
		t.Errorf("KMS call count: want 1 (cached error), got %d", got)
	}
}

func TestPEM_PassesConfiguredKeyID(t *testing.T) {
	fk := &fakeKMS{out: goodOutput(t)}
	c, _ := New(fk, testKeyID)

	if _, err := c.PEM(context.Background()); err != nil {
		t.Fatalf("PEM: %v", err)
	}
	if fk.lastInput == nil || fk.lastInput.KeyId == nil {
		t.Fatalf("KeyId not set on KMS GetPublicKeyInput")
	}
	if *fk.lastInput.KeyId != testKeyID {
		t.Errorf("KeyId: want %q, got %q", testKeyID, *fk.lastInput.KeyId)
	}
}

func TestPEM_DoesNotCacheTransientCtxCancellation(t *testing.T) {
	// Footgun guard: a ctx-cancellation error during the first call
	// must NOT poison the cache permanently. Caching DeadlineExceeded
	// would turn a boot-time network blip into a forever-broken cache
	// for any caller pattern that doesn't crash on first error.
	var firstCallSeen atomic.Bool
	fk := &fakeKMS{
		out: goodOutput(t),
		beforeFn: func(ctx context.Context) error {
			// First call sleeps long enough to time out; subsequent
			// calls complete promptly so the retry succeeds.
			if firstCallSeen.CompareAndSwap(false, true) {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(500 * time.Millisecond):
					return nil
				}
			}
			return nil
		},
	}
	c, _ := New(fk, testKeyID)

	ctx1, cancel1 := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel1()
	if _, err := c.PEM(ctx1); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("first call: want DeadlineExceeded, got %v", err)
	}

	pem, err := c.PEM(context.Background())
	if err != nil {
		t.Fatalf("second call: want success after ctx-cancel retry, got %v", err)
	}
	if !strings.Contains(pem, "BEGIN PUBLIC KEY") {
		t.Errorf("second-call PEM missing PKIX header: %q", pem)
	}
	if got := fk.callCount.Load(); got != 2 {
		t.Errorf("KMS call count: want 2 (canceled + retry), got %d", got)
	}
}

func TestPEM_RespectsContextCancellation(t *testing.T) {
	// Fake that respects ctx — sleeps until either ctx fires or 500ms.
	fk := &fakeKMS{
		out: goodOutput(t),
		beforeFn: func(ctx context.Context) error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(500 * time.Millisecond):
				return nil
			}
		},
	}
	c, _ := New(fk, testKeyID)

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	_, err := c.PEM(ctx)
	if err == nil {
		t.Fatalf("want error on canceled context, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error should wrap context.DeadlineExceeded; got %v", err)
	}
}

func TestPEM_ConcurrentCallsFetchOnce(t *testing.T) {
	fk := &fakeKMS{out: goodOutput(t)}
	c, _ := New(fk, testKeyID)

	const N = 20
	var wg sync.WaitGroup
	results := make([]string, N)
	errs := make([]error, N)
	start := make(chan struct{})

	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			results[idx], errs[idx] = c.PEM(context.Background())
		}(i)
	}
	close(start)
	wg.Wait()

	if got := fk.callCount.Load(); got != 1 {
		t.Errorf("KMS call count under concurrency: want 1, got %d", got)
	}
	for i := 0; i < N; i++ {
		if errs[i] != nil {
			t.Errorf("goroutine %d returned error: %v", i, errs[i])
		}
		if results[i] != results[0] {
			t.Errorf("goroutine %d returned different PEM than goroutine 0", i)
		}
	}
}
