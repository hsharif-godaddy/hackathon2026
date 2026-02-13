package middleware

import (
	"context"
	"io"
	"net"
	"testing"
)

// mockWebSocketTracker implements WebSocketTracker for testing
type mockWebSocketTracker struct {
	registered   []net.Conn
	unregistered []net.Conn
}

func (m *mockWebSocketTracker) RegisterWebSocket(conn net.Conn) {
	m.registered = append(m.registered, conn)
}

func (m *mockWebSocketTracker) UnregisterWebSocket(conn net.Conn) {
	m.unregistered = append(m.unregistered, conn)
}

// TestTrackedConnectionReadEOF verifies that EOF on Read triggers automatic cleanup
func TestTrackedConnectionReadEOF(t *testing.T) {
	tracker := &mockWebSocketTracker{}

	// Create a pipe where we can control the read side
	clientConn, serverConn := net.Pipe()
	defer serverConn.Close()

	// Create tracked connection wrapping the client side
	trackedConn := &trackedConnection{
		Conn:    clientConn,
		tracker: tracker,
	}

	// Register the connection
	tracker.RegisterWebSocket(trackedConn)

	// Close server side to trigger EOF on client read
	serverConn.Close()

	// Attempt to read - should get EOF and trigger cleanup
	buf := make([]byte, 100)
	_, err := trackedConn.Read(buf)

	if err == nil {
		t.Error("Expected EOF error, got nil")
	}

	// Verify unregister was called
	if len(tracker.unregistered) != 1 {
		t.Errorf("Expected 1 unregister call, got %d", len(tracker.unregistered))
	}
}

// TestTrackedConnectionWriteError verifies that write errors trigger automatic cleanup
func TestTrackedConnectionWriteError(t *testing.T) {
	tracker := &mockWebSocketTracker{}

	// Create a pipe where we can control the write side
	clientConn, serverConn := net.Pipe()
	defer serverConn.Close()

	// Create tracked connection wrapping the client side
	trackedConn := &trackedConnection{
		Conn:    clientConn,
		tracker: tracker,
	}
	defer trackedConn.Close()

	// Register the connection
	tracker.RegisterWebSocket(trackedConn)

	// Close server side to trigger write error (broken pipe)
	serverConn.Close()

	// Attempt to write - should get error and trigger cleanup
	_, err := trackedConn.Write([]byte("test data"))

	if err == nil {
		t.Error("Expected write error, got nil")
	}

	// Verify unregister was called
	if len(tracker.unregistered) != 1 {
		t.Errorf("Expected 1 unregister call, got %d", len(tracker.unregistered))
	}
}

// TestTrackedConnectionCloseIdempotent verifies that multiple Close calls only unregister once
func TestTrackedConnectionCloseIdempotent(t *testing.T) {
	tracker := &mockWebSocketTracker{}

	// Create a pipe
	clientConn, serverConn := net.Pipe()
	defer serverConn.Close()

	// Create tracked connection
	trackedConn := &trackedConnection{
		Conn:    clientConn,
		tracker: tracker,
	}

	// Register the connection
	tracker.RegisterWebSocket(trackedConn)

	// Close multiple times
	trackedConn.Close()
	trackedConn.Close()
	trackedConn.Close()

	// Verify unregister was called exactly once
	if len(tracker.unregistered) != 1 {
		t.Errorf("Expected exactly 1 unregister call, got %d", len(tracker.unregistered))
	}
}

// TestTrackedConnectionReadThenClose verifies that error in Read followed by Close only unregisters once
func TestTrackedConnectionReadThenClose(t *testing.T) {
	tracker := &mockWebSocketTracker{}

	// Create a pipe
	clientConn, serverConn := net.Pipe()

	// Create tracked connection
	trackedConn := &trackedConnection{
		Conn:    clientConn,
		tracker: tracker,
	}

	// Register the connection
	tracker.RegisterWebSocket(trackedConn)

	// Close server to trigger EOF
	serverConn.Close()

	// Read triggers unregister
	buf := make([]byte, 100)
	trackedConn.Read(buf)

	// Explicit Close should not unregister again
	trackedConn.Close()

	// Verify unregister was called exactly once
	if len(tracker.unregistered) != 1 {
		t.Errorf("Expected exactly 1 unregister call (via sync.Once), got %d", len(tracker.unregistered))
	}
}

// TestTrackedConnectionSuccessfulReadWrite verifies that successful operations don't trigger cleanup
func TestTrackedConnectionSuccessfulReadWrite(t *testing.T) {
	tracker := &mockWebSocketTracker{}

	// Create a pipe for bidirectional communication
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	// Create tracked connection
	trackedConn := &trackedConnection{
		Conn:    clientConn,
		tracker: tracker,
	}

	// Register the connection
	tracker.RegisterWebSocket(trackedConn)

	// Write from tracked connection (should succeed)
	testData := []byte("hello")
	go func() {
		_, err := trackedConn.Write(testData)
		if err != nil {
			t.Errorf("Unexpected write error: %v", err)
		}
	}()

	// Read from server side (should succeed)
	buf := make([]byte, len(testData))
	n, err := serverConn.Read(buf)
	if err != nil {
		t.Fatalf("Unexpected read error: %v", err)
	}

	if n != len(testData) {
		t.Errorf("Expected to read %d bytes, got %d", len(testData), n)
	}

	// Verify no unregister was called (connection still healthy)
	if len(tracker.unregistered) != 0 {
		t.Errorf("Expected 0 unregister calls, got %d", len(tracker.unregistered))
	}
}

// mockTimeoutError implements net.Error with Timeout() returning true
type mockTimeoutError struct{}

func (e mockTimeoutError) Error() string   { return "mock timeout" }
func (e mockTimeoutError) Timeout() bool   { return true }
func (e mockTimeoutError) Temporary() bool { return false }

// mockErrorConn wraps net.Conn and returns specific errors
type mockErrorConn struct {
	net.Conn

	readErr  error
	writeErr error
}

func (m *mockErrorConn) Read(b []byte) (int, error) {
	if m.readErr != nil {
		return 0, m.readErr
	}
	return m.Conn.Read(b)
}

func (m *mockErrorConn) Write(b []byte) (int, error) {
	if m.writeErr != nil {
		return 0, m.writeErr
	}
	return m.Conn.Write(b)
}

// TestTrackedConnectionTimeoutNotTerminal verifies that timeout errors don't trigger cleanup
func TestTrackedConnectionTimeoutNotTerminal(t *testing.T) {
	tracker := &mockWebSocketTracker{}

	// Create a pipe
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	// Wrap with mock that returns timeout error
	mockConn := &mockErrorConn{
		Conn:    clientConn,
		readErr: mockTimeoutError{},
	}

	// Create tracked connection
	trackedConn := &trackedConnection{
		Conn:    mockConn,
		tracker: tracker,
	}

	// Register the connection
	tracker.RegisterWebSocket(trackedConn)

	// Read with timeout error (should NOT trigger cleanup)
	buf := make([]byte, 100)
	_, err := trackedConn.Read(buf)

	if err == nil {
		t.Error("Expected timeout error, got nil")
	}

	// Verify unregister was NOT called (timeout is not terminal)
	if len(tracker.unregistered) != 0 {
		t.Errorf("Expected 0 unregister calls for timeout error, got %d", len(tracker.unregistered))
	}
}

// TestIsTerminalError verifies the error classification logic
func TestIsTerminalError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		terminal bool
	}{
		{
			name:     "nil error",
			err:      nil,
			terminal: false,
		},
		{
			name:     "EOF error",
			err:      io.EOF,
			terminal: true,
		},
		{
			name:     "unexpected EOF error",
			err:      io.ErrUnexpectedEOF,
			terminal: true,
		},
		{
			name:     "timeout error",
			err:      mockTimeoutError{},
			terminal: false,
		},
		{
			name:     "context deadline exceeded",
			err:      context.DeadlineExceeded,
			terminal: false,
		},
		{
			name:     "context canceled",
			err:      context.Canceled,
			terminal: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isTerminalError(tt.err)
			if result != tt.terminal {
				t.Errorf("isTerminalError(%v) = %v, want %v", tt.err, result, tt.terminal)
			}
		})
	}
}

// TestTrackedConnectionContextDeadlineNotTerminal verifies that context.DeadlineExceeded doesn't trigger cleanup
func TestTrackedConnectionContextDeadlineNotTerminal(t *testing.T) {
	tracker := &mockWebSocketTracker{}

	// Create a pipe
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	// Wrap with mock that returns context.DeadlineExceeded
	mockConn := &mockErrorConn{
		Conn:    clientConn,
		readErr: context.DeadlineExceeded,
	}

	// Create tracked connection
	trackedConn := &trackedConnection{
		Conn:    mockConn,
		tracker: tracker,
	}

	// Register the connection
	tracker.RegisterWebSocket(trackedConn)

	// Read with deadline exceeded error (should NOT trigger cleanup)
	buf := make([]byte, 100)
	_, err := trackedConn.Read(buf)

	if err == nil {
		t.Error("Expected context.DeadlineExceeded error, got nil")
	}

	// Verify unregister was NOT called (deadline exceeded is not terminal)
	if len(tracker.unregistered) != 0 {
		t.Errorf("Expected 0 unregister calls for context.DeadlineExceeded, got %d", len(tracker.unregistered))
	}
}
