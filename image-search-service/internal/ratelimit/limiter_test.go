// internal/ratelimit/limiter_test.go
package ratelimit

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLimiter_RespectsConcurrency(t *testing.T) {
	limiter := New(2, 100) // 2 concurrent, 100 RPS

	var concurrent int64
	var maxConcurrent int64
	var wg sync.WaitGroup

	ctx := context.Background()

	// Start 5 operations - only 2 should run at once
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := limiter.Acquire(ctx); err != nil {
				t.Errorf("acquire failed: %v", err)
				return
			}

			current := atomic.AddInt64(&concurrent, 1)
			for {
				old := atomic.LoadInt64(&maxConcurrent)
				if current <= old || atomic.CompareAndSwapInt64(&maxConcurrent, old, current) {
					break
				}
			}

			time.Sleep(50 * time.Millisecond)
			atomic.AddInt64(&concurrent, -1)
			limiter.Release()
		}()
	}

	wg.Wait()

	if maxConcurrent > 2 {
		t.Errorf("exceeded max concurrency: got %d, want max 2", maxConcurrent)
	}
}

func TestLimiter_ContextCancellation(t *testing.T) {
	limiter := New(1, 100)

	// Acquire the only slot
	ctx := context.Background()
	if err := limiter.Acquire(ctx); err != nil {
		t.Fatalf("first acquire failed: %v", err)
	}

	// Try to acquire with cancelled context
	cancelCtx, cancel := context.WithCancel(ctx)
	cancel()

	err := limiter.Acquire(cancelCtx)
	if err == nil {
		t.Error("expected error for cancelled context")
	}

	limiter.Release()
}
