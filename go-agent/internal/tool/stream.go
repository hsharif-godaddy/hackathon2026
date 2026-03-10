package tool

import (
	"maps"
	"strings"
	"sync"
)

// BufferedStream is a thread-safe OutputStream that collects output in memory.
type BufferedStream struct {
	mu       sync.Mutex
	buf      strings.Builder
	errBuf   strings.Builder
	metadata map[string]any
}

// Write appends a chunk to the output buffer.
func (s *BufferedStream) Write(chunk string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf.WriteString(chunk)
}

// WriteError appends a chunk to the error output buffer.
func (s *BufferedStream) WriteError(chunk string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.errBuf.WriteString(chunk)
}

// SetMetadata stores a key-value pair in the stream's metadata map.
func (s *BufferedStream) SetMetadata(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.metadata == nil {
		s.metadata = make(map[string]any)
	}
	s.metadata[key] = value
}

// String returns all accumulated output.
// The returned string is a stable copy safe to use after further writes.
func (s *BufferedStream) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.Clone(s.buf.String())
}

// ErrorString returns all accumulated error output.
// The returned string is a stable copy safe to use after further writes.
func (s *BufferedStream) ErrorString() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.Clone(s.errBuf.String())
}

// Metadata returns a snapshot copy of the metadata map, or nil if no metadata was set.
// Modifying the returned map does not affect the BufferedStream's internal metadata.
func (s *BufferedStream) Metadata() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.metadata == nil {
		return nil
	}
	return maps.Clone(s.metadata)
}
