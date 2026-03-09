package id

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestNewHasPrefix(t *testing.T) {
	got := New("evt")
	assert.True(t, strings.HasPrefix(got, "evt_"), "expected evt_ prefix, got: %s", got)
}

func TestNewIDsAreUnique(t *testing.T) {
	seen := make(map[string]bool)
	for i := range 1000 {
		id := New("evt")
		assert.False(t, seen[id], "collision at iteration %d: %s", i, id)
		seen[id] = true
	}
}

func TestNewIDLength(t *testing.T) {
	got := New("evt")
	// "evt_" (4) + 20 hex chars = 24 total
	assert.Len(t, got, 24, "unexpected length: %s", got)
}

func TestNewIDsSortableAcrossMilliseconds(t *testing.T) {
	id1 := New("evt")
	time.Sleep(2 * time.Millisecond)
	id2 := New("evt")
	// Strip prefix — the hex portion should be lexicographically ordered
	// because the timestamp bytes come first (big-endian).
	hex1 := strings.TrimPrefix(id1, "evt_")
	hex2 := strings.TrimPrefix(id2, "evt_")
	assert.Less(t, hex1, hex2, "IDs from different milliseconds should sort chronologically")
}

func TestNewDifferentPrefixes(t *testing.T) {
	evtID := New("evt")
	runID := New("run")
	assert.True(t, strings.HasPrefix(evtID, "evt_"))
	assert.True(t, strings.HasPrefix(runID, "run_"))
}
