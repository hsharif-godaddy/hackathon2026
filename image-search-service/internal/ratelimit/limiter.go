// Package ratelimit provides rate limiting with concurrency control
package ratelimit

import (
	"context"
	"sync"
	"time"
)

// Limiter provides rate limiting with concurrency control
type Limiter struct {
	semaphore chan struct{}
	rateLimit int
	mu        sync.Mutex
	tokens    int
	lastReset time.Time
}

// New creates a limiter with max concurrent operations and requests per second.
// Panics if concurrency or rps are <= 0.
func New(concurrency, rps int) *Limiter {
	if concurrency <= 0 {
		panic("ratelimit: concurrency must be > 0")
	}
	if rps <= 0 {
		panic("ratelimit: rps must be > 0")
	}
	return &Limiter{
		semaphore: make(chan struct{}, concurrency),
		rateLimit: rps,
		tokens:    rps,
		lastReset: time.Now(),
	}
}

// Acquire blocks until a slot is available or context is cancelled
func (l *Limiter) Acquire(ctx context.Context) error {
	// First, wait for concurrency slot
	select {
	case l.semaphore <- struct{}{}:
		// Got a slot
	case <-ctx.Done():
		return ctx.Err()
	}

	// Then, check rate limit
	if err := l.waitForRateLimit(ctx); err != nil {
		// Release the semaphore slot on error
		<-l.semaphore
		return err
	}

	return nil
}

// Release frees a slot for another operation
func (l *Limiter) Release() {
	<-l.semaphore
}

// waitForRateLimit implements token bucket rate limiting
func (l *Limiter) waitForRateLimit(ctx context.Context) error {
	for {
		l.mu.Lock()
		now := time.Now()

		// Reset tokens every second
		if now.Sub(l.lastReset) >= time.Second {
			l.tokens = l.rateLimit
			l.lastReset = now
		}

		if l.tokens > 0 {
			l.tokens--
			l.mu.Unlock()
			return nil
		}

		// Calculate time until next token
		waitUntil := l.lastReset.Add(time.Second)
		l.mu.Unlock()

		// Check context before sleeping to avoid unnecessary wait
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Use time.Sleep instead of time.After to avoid goroutine leak
		time.Sleep(time.Until(waitUntil))
	}
}

// Stats returns current limiter stats.
// Note: The returned values are point-in-time snapshots and may change immediately
// after this call returns. Do not use for synchronization.
func (l *Limiter) Stats() (busy int, available int) {
	busy = len(l.semaphore)
	available = cap(l.semaphore) - busy
	return
}
