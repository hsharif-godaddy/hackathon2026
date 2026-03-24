package run

import (
	"errors"
	"fmt"
	"sync"
)

// ErrRunNotFound is returned when a run ID does not exist in the store.
var ErrRunNotFound = errors.New("run not found")

// ErrRunExists is returned when Create is called with a duplicate run ID.
var ErrRunExists = errors.New("run already exists")

// Store holds the in-memory event log for active runs.
// It supports append, subscribe-from-offset, get, and remove operations.
// All methods are safe for concurrent use.
//
// Delivery to live subscribers is best-effort: if a subscriber's channel is
// full, new events are dropped. Use Events() for reliable access to the
// durable event log.
type Store struct {
	mu   sync.RWMutex
	runs map[string]*runLog
}

type runLog struct {
	mu      sync.RWMutex
	run     *Run
	events  []Event
	seq     int64
	subs    []*logSub
	removed bool
}

type logSub struct {
	ch     chan Event
	closed bool
	mu     sync.Mutex
}

// NewStore creates an empty run store.
func NewStore() *Store {
	return &Store{
		runs: make(map[string]*runLog),
	}
}

// Create registers a new run in the store.
// Returns ErrRunExists if a run with the same ID already exists.
func (s *Store) Create(r *Run) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.runs[r.ID]; ok {
		return fmt.Errorf("run %q: %w", r.ID, ErrRunExists)
	}

	runCopy := *r
	s.runs[r.ID] = &runLog{
		run:    &runCopy,
		events: []Event{},
	}
	return nil
}

// Append adds an event to a run's log with an auto-incremented sequence number.
// Returns ErrRunNotFound if the run does not exist.
//
// Live subscribers receive the event on a best-effort basis. If a subscriber's
// channel buffer is full, the event is dropped for that subscriber. Use
// Events() for reliable access to the full event log.
func (s *Store) Append(runID string, event Event) error {
	rl, err := s.getLog(runID)
	if err != nil {
		return err
	}

	rl.mu.Lock()
	rl.seq++
	event.Sequence = rl.seq
	rl.events = append(rl.events, event)
	subs := make([]*logSub, len(rl.subs))
	copy(subs, rl.subs)
	rl.mu.Unlock()

	for _, sub := range subs {
		sub.mu.Lock()
		if !sub.closed {
			select {
			case sub.ch <- event:
			default:
				// Drop: subscriber is slow; use Events() for reliable access.
			}
		}
		sub.mu.Unlock()
	}

	return nil
}

// Subscribe returns a channel that receives events for the given run starting
// after fromSeq. Events with sequence <= fromSeq are skipped; events with
// sequence > fromSeq are replayed immediately, then new events are delivered
// live on a best-effort basis (see Append). The returned cancel function
// closes the channel and unsubscribes.
//
// If the run does not exist or has been removed, returns a closed channel.
func (s *Store) Subscribe(runID string, fromSeq int64) (<-chan Event, func()) {
	rl, err := s.getLog(runID)
	if err != nil {
		ch := make(chan Event)
		close(ch)
		return ch, func() {}
	}

	// Snapshot events to replay under the lock, then send after releasing
	// to avoid deadlock when replay exceeds the channel buffer size.
	rl.mu.Lock()
	if rl.removed {
		rl.mu.Unlock()
		ch := make(chan Event)
		close(ch)
		return ch, func() {}
	}

	var replay []Event
	for _, ev := range rl.events {
		if ev.Sequence > fromSeq {
			replay = append(replay, ev)
		}
	}

	// Size the buffer to fit replay events plus headroom for live events.
	bufSize := len(replay) + 64
	sub := &logSub{
		ch: make(chan Event, bufSize),
	}
	rl.subs = append(rl.subs, sub)
	rl.mu.Unlock()

	// Replay after releasing the lock. The channel buffer is large enough
	// so these sends won't block.
	for _, ev := range replay {
		sub.ch <- ev
	}

	cancel := func() {
		sub.mu.Lock()
		defer sub.mu.Unlock()
		if sub.closed {
			return
		}
		sub.closed = true
		close(sub.ch)

		rl.mu.Lock()
		defer rl.mu.Unlock()
		for i, entry := range rl.subs {
			if entry == sub {
				copy(rl.subs[i:], rl.subs[i+1:])
				rl.subs[len(rl.subs)-1] = nil
				rl.subs = rl.subs[:len(rl.subs)-1]
				break
			}
		}
	}

	return sub.ch, cancel
}

// Get returns a copy of the run metadata.
// Returns ErrRunNotFound if the run does not exist.
func (s *Store) Get(runID string) (*Run, error) {
	rl, err := s.getLog(runID)
	if err != nil {
		return nil, err
	}

	rl.mu.RLock()
	defer rl.mu.RUnlock()
	runCopy := *rl.run
	return &runCopy, nil
}

// UpdateStatus updates the status of a run. Returns ErrRunNotFound if not found.
func (s *Store) UpdateStatus(runID string, status Status) error {
	rl, err := s.getLog(runID)
	if err != nil {
		return err
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.run.Status = status
	return nil
}

// Events returns all events for a run with sequence > fromSeq.
// Returns ErrRunNotFound if the run does not exist.
func (s *Store) Events(runID string, fromSeq int64) ([]Event, error) {
	rl, err := s.getLog(runID)
	if err != nil {
		return nil, err
	}

	rl.mu.RLock()
	defer rl.mu.RUnlock()

	result := []Event{}
	for _, ev := range rl.events {
		if ev.Sequence > fromSeq {
			result = append(result, ev)
		}
	}
	return result, nil
}

// Remove deletes a run from the store and closes all subscriber channels.
func (s *Store) Remove(runID string) {
	s.mu.Lock()
	rl, ok := s.runs[runID]
	if !ok {
		s.mu.Unlock()
		return
	}
	delete(s.runs, runID)
	s.mu.Unlock()

	rl.mu.Lock()
	rl.removed = true
	subs := rl.subs
	rl.subs = nil
	rl.mu.Unlock()

	for _, sub := range subs {
		sub.mu.Lock()
		if !sub.closed {
			sub.closed = true
			close(sub.ch)
		}
		sub.mu.Unlock()
	}
}

func (s *Store) getLog(runID string) (*runLog, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rl, ok := s.runs[runID]
	if !ok {
		return nil, fmt.Errorf("run %q: %w", runID, ErrRunNotFound)
	}
	return rl, nil
}
