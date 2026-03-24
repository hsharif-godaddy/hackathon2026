package run

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestRun() *Run {
	return &Run{
		ID:        "run1",
		AppID:     "app1",
		AgentID:   "develop",
		Status:    StatusCreated,
		CreatedAt: time.Now(),
	}
}

func createTestRun(t *testing.T, s *Store) {
	t.Helper()
	require.NoError(t, s.Create(newTestRun()))
}

func TestStore_CreateAndGet(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	got, err := s.Get("run1")
	require.NoError(t, err)
	assert.Equal(t, "run1", got.ID)
	assert.Equal(t, "app1", got.AppID)
}

func TestStore_Create_Duplicate(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	err := s.Create(newTestRun())
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrRunExists)
}

func TestStore_Get_NotFound(t *testing.T) {
	s := NewStore()

	_, err := s.Get("nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrRunNotFound)
}

func TestStore_Get_ReturnsCopy(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	got, err := s.Get("run1")
	require.NoError(t, err)

	// Mutating the returned copy should not affect the store.
	got.Status = StatusCompleted

	got2, err := s.Get("run1")
	require.NoError(t, err)
	assert.Equal(t, StatusCreated, got2.Status)
}

func TestStore_Append_AutoIncrementsSequence(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	ev1 := NewEvent(EventLLMToken, TokenData{Text: "a"})
	ev2 := NewEvent(EventLLMToken, TokenData{Text: "b"})
	ev3 := NewEvent(EventLLMToken, TokenData{Text: "c"})

	require.NoError(t, s.Append("run1", ev1))
	require.NoError(t, s.Append("run1", ev2))
	require.NoError(t, s.Append("run1", ev3))

	events, err := s.Events("run1", 0)
	require.NoError(t, err)
	require.Len(t, events, 3)
	assert.Equal(t, int64(1), events[0].Sequence)
	assert.Equal(t, int64(2), events[1].Sequence)
	assert.Equal(t, int64(3), events[2].Sequence)
}

func TestStore_Append_NotFound(t *testing.T) {
	s := NewStore()

	err := s.Append("nonexistent", NewEvent(EventLLMToken, nil))
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrRunNotFound)
}

func TestStore_Events_FromOffset(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	for i := range 5 {
		ev := NewEvent(EventLLMToken, TokenData{Text: string(rune('a' + i))})
		require.NoError(t, s.Append("run1", ev))
	}

	events, err := s.Events("run1", 3)
	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, int64(4), events[0].Sequence)
	assert.Equal(t, int64(5), events[1].Sequence)
}

func TestStore_Events_NotFound(t *testing.T) {
	s := NewStore()

	_, err := s.Events("nonexistent", 0)
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrRunNotFound)
}

func TestStore_Subscribe_FromBeginning(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	// Append some events before subscribing.
	require.NoError(t, s.Append("run1", NewEvent(EventRunStarted, nil)))
	require.NoError(t, s.Append("run1", NewEvent(EventLLMToken, TokenData{Text: "hi"})))

	ch, cancel := s.Subscribe("run1", 0)
	defer cancel()

	// Should replay existing events.
	ev1 := readEvent(t, ch)
	assert.Equal(t, EventRunStarted, ev1.Type)
	assert.Equal(t, int64(1), ev1.Sequence)

	ev2 := readEvent(t, ch)
	assert.Equal(t, EventLLMToken, ev2.Type)
	assert.Equal(t, int64(2), ev2.Sequence)

	// Append a new event after subscribing.
	require.NoError(t, s.Append("run1", NewEvent(EventRunCompleted, nil)))

	ev3 := readEvent(t, ch)
	assert.Equal(t, EventRunCompleted, ev3.Type)
	assert.Equal(t, int64(3), ev3.Sequence)
}

func TestStore_Subscribe_FromOffset(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	for i := range 5 {
		ev := NewEvent(EventLLMToken, TokenData{Text: string(rune('a' + i))})
		require.NoError(t, s.Append("run1", ev))
	}

	// Subscribe from seq 3 — should replay events 4 and 5.
	ch, cancel := s.Subscribe("run1", 3)
	defer cancel()

	ev1 := readEvent(t, ch)
	assert.Equal(t, int64(4), ev1.Sequence)

	ev2 := readEvent(t, ch)
	assert.Equal(t, int64(5), ev2.Sequence)
}

func TestStore_Subscribe_ReplayLargeHistory(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	const totalEvents = 200 // Exceeds default channel buffer of 64.

	for range totalEvents {
		ev := NewEvent(EventLLMToken, TokenData{Text: "event"})
		require.NoError(t, s.Append("run1", ev))
	}

	// Subscribe should not deadlock even with >64 events to replay.
	ch, cancel := s.Subscribe("run1", 0)
	defer cancel()

	for i := range totalEvents {
		ev := readEvent(t, ch)
		assert.Equal(t, int64(i+1), ev.Sequence)
	}

	// Live delivery still works after large replay.
	require.NoError(t, s.Append("run1", NewEvent(EventRunCompleted, nil)))

	ev := readEvent(t, ch)
	assert.Equal(t, int64(totalEvents+1), ev.Sequence)
}

func TestStore_Subscribe_BlocksUntilEvents(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	ch, cancel := s.Subscribe("run1", 0)
	defer cancel()

	// No events yet — channel should block.
	select {
	case <-ch:
		t.Fatal("should not receive events yet")
	case <-time.After(50 * time.Millisecond):
		// Expected.
	}

	// Now append an event.
	require.NoError(t, s.Append("run1", NewEvent(EventRunStarted, nil)))

	ev := readEvent(t, ch)
	assert.Equal(t, EventRunStarted, ev.Type)
}

func TestStore_Subscribe_MultipleConcurrent(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	ch1, cancel1 := s.Subscribe("run1", 0)
	defer cancel1()
	ch2, cancel2 := s.Subscribe("run1", 0)
	defer cancel2()

	require.NoError(t, s.Append("run1", NewEvent(EventRunStarted, nil)))

	ev1 := readEvent(t, ch1)
	ev2 := readEvent(t, ch2)
	assert.Equal(t, EventRunStarted, ev1.Type)
	assert.Equal(t, EventRunStarted, ev2.Type)
}

func TestStore_Subscribe_CancelStopsDelivery(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	ch, cancel := s.Subscribe("run1", 0)
	cancel()

	// Channel should be closed after cancel.
	_, ok := <-ch
	assert.False(t, ok)
}

func TestStore_Subscribe_NonexistentRun(t *testing.T) {
	s := NewStore()

	ch, cancel := s.Subscribe("nonexistent", 0)
	defer cancel()

	// Should get a closed channel.
	_, ok := <-ch
	assert.False(t, ok)
}

func TestStore_Append_AfterAllSubscribersClose(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	ch, cancel := s.Subscribe("run1", 0)
	cancel()

	// Appending after all subscribers close should not panic.
	require.NoError(t, s.Append("run1", NewEvent(EventRunStarted, nil)))

	// Event is stored.
	events, err := s.Events("run1", 0)
	require.NoError(t, err)
	assert.Len(t, events, 1)

	// Channel is closed.
	_, ok := <-ch
	assert.False(t, ok)
}

func TestStore_Remove(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)
	require.NoError(t, s.Append("run1", NewEvent(EventRunStarted, nil)))

	s.Remove("run1")

	_, err := s.Get("run1")
	require.ErrorIs(t, err, ErrRunNotFound)

	_, err = s.Events("run1", 0)
	assert.ErrorIs(t, err, ErrRunNotFound)
}

func TestStore_Remove_ClosesSubscribers(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	ch, cancel := s.Subscribe("run1", 0)
	defer cancel()

	s.Remove("run1")

	// Subscriber channel should be closed.
	_, ok := <-ch
	assert.False(t, ok)
}

func TestStore_Subscribe_AfterRemove(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)
	s.Remove("run1")

	// Subscribing to a removed run should return a closed channel.
	ch, cancel := s.Subscribe("run1", 0)
	defer cancel()

	_, ok := <-ch
	assert.False(t, ok)
}

func TestStore_ConcurrentAppendAndSubscribe(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	const n = 50
	ch, cancel := s.Subscribe("run1", 0)
	defer cancel()

	var wg sync.WaitGroup
	wg.Go(func() {
		for i := range n {
			ev := NewEvent(EventLLMToken, TokenData{Text: string(rune('a' + (i % 26)))})
			_ = s.Append("run1", ev)
		}
	})

	received := 0
	timeout := time.After(2 * time.Second)
	for received < n {
		select {
		case _, ok := <-ch:
			if !ok {
				t.Fatal("channel closed unexpectedly")
			}
			received++
		case <-timeout:
			t.Fatalf("timed out after receiving %d/%d events", received, n)
		}
	}

	wg.Wait()
	assert.Equal(t, n, received)
}

func TestStore_UpdateStatus(t *testing.T) {
	s := NewStore()
	createTestRun(t, s)

	require.NoError(t, s.UpdateStatus("run1", StatusRunning))

	got, err := s.Get("run1")
	require.NoError(t, err)
	assert.Equal(t, StatusRunning, got.Status)
}

func TestStore_UpdateStatus_NotFound(t *testing.T) {
	s := NewStore()

	err := s.UpdateStatus("nonexistent", StatusRunning)
	assert.ErrorIs(t, err, ErrRunNotFound)
}

// readEvent reads one event from ch or fails the test after 100ms.
func readEvent(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case ev, ok := <-ch:
		require.True(t, ok, "channel closed unexpectedly")
		return ev
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for event")
		return Event{} // unreachable
	}
}
