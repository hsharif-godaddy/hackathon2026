package id

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"time"
)

// New generates a unique ID with the given prefix.
// Format: {prefix}_{timestamp_hex}{random_hex}
// - 6 bytes (12 hex chars): milliseconds since epoch — time-sortable
// - 4 bytes (8 hex chars): random — collision resistance within same millisecond
// Total: prefix + "_" + 20 hex chars (e.g., "evt_018e4a2b3c4d5e6f7a8b")
func New(prefix string) string {
	var buf [10]byte

	// First 6 bytes: millisecond timestamp (big-endian, lower 6 bytes of uint64).
	var ts [8]byte
	ms := uint64(time.Now().UnixMilli()) //nolint:gosec // UnixMilli is positive until year 292278994
	binary.BigEndian.PutUint64(ts[:], ms)
	copy(buf[:6], ts[2:])

	// Last 4 bytes: random
	if _, err := rand.Read(buf[6:]); err != nil {
		panic(fmt.Sprintf("crypto/rand.Read failed: %v", err))
	}

	return prefix + "_" + hex.EncodeToString(buf[:])
}
