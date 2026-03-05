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

func (l *Limiter) Acquire(ctx context.Context) error {
	select {
	case l.semaphore <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}

	if err := l.waitForRateLimit(ctx); err != nil {
		<-l.semaphore
		return err
	}

	return nil
}

func (l *Limiter) Release() {
	<-l.semaphore
}

func (l *Limiter) waitForRateLimit(ctx context.Context) error {
	for {
		l.mu.Lock()
		now := time.Now()

		if now.Sub(l.lastReset) >= time.Second {
			l.tokens = l.rateLimit
			l.lastReset = now
		}

		if l.tokens > 0 {
			l.tokens--
			l.mu.Unlock()
			return nil
		}

		waitUntil := l.lastReset.Add(time.Second)
		l.mu.Unlock()

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		time.Sleep(time.Until(waitUntil))
	}
}

func (l *Limiter) Stats() (int, int) {
	busy := len(l.semaphore)
	available := cap(l.semaphore) - busy
	return busy, available
}
