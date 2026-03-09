package eventbus

import (
	"sync"
	"testing"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"

	"github.com/stretchr/testify/assert"
)

// drainWithTimeout reads events from ch until timeout elapses with no new event.
func drainWithTimeout(ch <-chan run.Event, timeout time.Duration) int {
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

	ev := run.NewEvent(run.EventLLMToken, run.TokenData{Text: "hi"})
	bus.Publish("run:abc", ev)

	select {
	case received := <-sub.Ch:
		assert.Equal(t, run.EventLLMToken, received.Type)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for event")
	}
}

func TestSubscribeDoesNotReceiveOtherTopics(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 10)
	defer sub.Close()

	bus.Publish("run:xyz", run.NewEvent(run.EventLLMToken, nil))

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

	bus.Publish("run:abc", run.NewEvent(run.EventRunStarted, nil))

	for _, sub := range []*Subscription{sub1, sub2} {
		select {
		case ev := <-sub.Ch:
			assert.Equal(t, run.EventRunStarted, ev.Type)
		case <-time.After(100 * time.Millisecond):
			t.Fatal("subscriber did not receive event")
		}
	}
}

func TestCloseUnsubscribes(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 10)
	sub.Close()

	bus.Publish("run:abc", run.NewEvent(run.EventRunStarted, nil))
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
		bus.Publish("run:abc", run.NewEvent(run.EventLLMToken, run.TokenData{Text: "x"}))
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
			bus.Publish("run:abc", run.NewEvent(run.EventLLMToken, nil))
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
			bus.Publish("run:abc", run.NewEvent(run.EventLLMToken, nil))
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
	bus.Publish("run:abc", run.NewEvent(run.EventRunStarted, nil))
	bus.Publish("run:xyz", run.NewEvent(run.EventRunStarted, nil))

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
	bus.Publish("run:abc", run.NewEvent(run.EventRunStarted, nil))
}

func TestBusCloseIdempotent(t *testing.T) {
	bus := New()
	sub := bus.Subscribe("run:abc", 10)

	bus.Close()
	bus.Close() // second close should not panic

	_, ok := <-sub.Ch
	assert.False(t, ok)
}
