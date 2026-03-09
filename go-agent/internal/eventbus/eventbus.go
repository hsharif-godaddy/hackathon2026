package eventbus

import (
	"sync"
	"sync/atomic"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
)

// Subscription represents an active subscription to events on a topic.
// Read events from Ch. Call Close to unsubscribe and release resources.
type Subscription struct {
	Ch    <-chan run.Event
	sub   *subscriber
	close func()
}

// Close unsubscribes and closes the channel.
// It is safe to call multiple times.
func (s *Subscription) Close() {
	s.close()
}

// Dropped returns the number of events that were dropped due to backpressure
// (i.e. the subscriber's buffer was full when the event was published).
func (s *Subscription) Dropped() int64 {
	return s.sub.dropped.Load()
}

// subscriber is the internal state for a single subscription.
type subscriber struct {
	ch      chan run.Event
	closed  bool
	mu      sync.Mutex
	dropped atomic.Int64
}

// Bus is an in-process typed pub/sub event bus.
// All components publish and subscribe through it rather than calling each other directly.
type Bus struct {
	mu          sync.RWMutex
	subscribers map[string][]*subscriber
}

// New creates a new event bus.
func New() *Bus {
	return &Bus{
		subscribers: make(map[string][]*subscriber),
	}
}

// Publish sends an event to all subscribers of the given topic.
// It never blocks: if a subscriber's buffer is full, the event is dropped
// and the subscriber's dropped counter is incremented.
func (b *Bus) Publish(topic string, event run.Event) {
	b.mu.RLock()
	subs := append([]*subscriber(nil), b.subscribers[topic]...)
	b.mu.RUnlock()

	for _, s := range subs {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			continue
		}
		select {
		case s.ch <- event:
		default:
			s.dropped.Add(1)
		}
		s.mu.Unlock()
	}
}

// Close closes all subscriber channels and clears the bus.
// After Close, any subscriber ranging over Ch will unblock and exit.
// Publish after Close is a no-op. It is safe to call multiple times.
func (b *Bus) Close() {
	b.mu.Lock()
	subs := b.subscribers
	b.subscribers = make(map[string][]*subscriber)
	b.mu.Unlock()

	for _, topicSubs := range subs {
		for _, s := range topicSubs {
			s.mu.Lock()
			if !s.closed {
				s.closed = true
				close(s.ch)
			}
			s.mu.Unlock()
		}
	}
}

// Subscribe creates a new subscription for events on the given topic.
// bufferSize controls how many events can be buffered before backpressure
// causes events to be dropped.
func (b *Bus) Subscribe(topic string, bufferSize int) *Subscription {
	if bufferSize < 0 {
		bufferSize = 0
	}
	ch := make(chan run.Event, bufferSize)
	s := &subscriber{ch: ch}

	b.mu.Lock()
	b.subscribers[topic] = append(b.subscribers[topic], s)
	b.mu.Unlock()

	return &Subscription{
		Ch:  ch,
		sub: s,
		close: func() {
			s.mu.Lock()
			if !s.closed {
				s.closed = true
				close(s.ch)
			}
			s.mu.Unlock()

			b.mu.Lock()
			subs := b.subscribers[topic]
			for i, sub := range subs {
				if sub == s {
					subs[len(subs)-1] = nil // zero tail to avoid retaining pointer
					b.subscribers[topic] = append(subs[:i], subs[i+1:]...)
					break
				}
			}
			b.mu.Unlock()
		},
	}
}
