package eventbus

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// testEvent is a simple event type for testing.
type testEvent struct {
	Kind string
	Text string
}

// drainWithTimeout reads events from ch until timeout elapses with no new event.
func drainWithTimeout(ch <-chan any, timeout time.Duration) int {
	deadline := time.After(timeout)
	count := 0
	for {
		select {
		case _, ok := <-ch:
			if !ok {
				return count
			}
			count++
		case <-deadline:
			return count
		}
	}
}

func TestPublishSubscribe(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 10)
	defer sub.Close()

	ev := testEvent{Kind: "token", Text: "hi"}
	bus.Publish("run:abc", ev)

	select {
	case received := <-sub.Ch:
		te, ok := received.(testEvent)
		assert.True(t, ok)
		assert.Equal(t, "token", te.Kind)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for event")
	}
}

func TestSubscribeDoesNotReceiveOtherTopics(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 10)
	defer sub.Close()

	bus.Publish("run:xyz", testEvent{Kind: "token"})

	select {
	case <-sub.Ch:
		t.Fatal("should not receive events from other topics")
	case <-time.After(50 * time.Millisecond):
		// Expected: no event
	}
}

func TestMultipleSubscribers(t *testing.T) {
	bus := New()
	sub1 := bus.Subscribe("run:abc", 10)
	sub2 := bus.Subscribe("run:abc", 10)
	defer sub1.Close()
	defer sub2.Close()

	bus.Publish("run:abc", testEvent{Kind: "started"})

	for _, sub := range []*Subscription{sub1, sub2} {
		select {
		case ev := <-sub.Ch:
			te, ok := ev.(testEvent)
			assert.True(t, ok)
			assert.Equal(t, "started", te.Kind)
		case <-time.After(100 * time.Millisecond):
			t.Fatal("subscriber did not receive event")
		}
	}
}

func TestCloseUnsubscribes(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 10)
	sub.Close()

	bus.Publish("run:abc", testEvent{Kind: "started"})
	// Channel should be closed, read returns zero value
	_, ok := <-sub.Ch
	assert.False(t, ok)
}

func TestBackpressureDropsEvents(t *testing.T) {
	const bufSize = 2
	bus := New()
	sub := bus.Subscribe("run:abc", bufSize)
	defer sub.Close()

	// Publish more events than buffer can hold
	for range 10 {
		bus.Publish("run:abc", testEvent{Kind: "token", Text: "x"})
	}

	count := drainWithTimeout(sub.Ch, 50*time.Millisecond)
	assert.Equal(t, bufSize, count)
	assert.Equal(t, int64(10-bufSize), sub.Dropped())
}

func TestConcurrentPublish(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 100)
	defer sub.Close()

	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			bus.Publish("run:abc", testEvent{Kind: "token"})
		})
	}
	wg.Wait()

	count := drainWithTimeout(sub.Ch, 50*time.Millisecond)
	assert.Equal(t, 10, count)
}

func TestConcurrentPublishAndClose(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 100)

	var wg sync.WaitGroup
	// Goroutines publishing concurrently
	for range 20 {
		wg.Go(func() {
			bus.Publish("run:abc", testEvent{Kind: "token"})
		})
	}
	// Close mid-flight
	wg.Go(func() {
		sub.Close()
	})
	wg.Wait()

	// No race or panic means success; drain remaining events and verify channel is closed
	drainWithTimeout(sub.Ch, 50*time.Millisecond)
	_, ok := <-sub.Ch
	assert.False(t, ok, "channel should be closed after Close()")
}

func TestBusCloseUnblocksAllSubscribers(t *testing.T) {
	bus := New()
	sub1 := bus.Subscribe("run:abc", 10)
	sub2 := bus.Subscribe("run:xyz", 10)

	// Publish one event to each so we can verify drain works
	bus.Publish("run:abc", testEvent{Kind: "started"})
	bus.Publish("run:xyz", testEvent{Kind: "started"})

	bus.Close()

	// Both channels should close; range exits cleanly
	count1 := 0
	for range sub1.Ch {
		count1++
	}
	count2 := 0
	for range sub2.Ch {
		count2++
	}
	assert.Equal(t, 1, count1)
	assert.Equal(t, 1, count2)

	// Publish after Close is a no-op (no panic)
	bus.Publish("run:abc", testEvent{Kind: "started"})
}

func TestBusCloseIdempotent(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 10)

	bus.Close()
	bus.Close() // second close should not panic

	_, ok := <-sub.Ch
	assert.False(t, ok)
}
