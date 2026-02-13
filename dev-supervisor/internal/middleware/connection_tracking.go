package middleware

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
)

// WebSocketTracker defines operations needed for WebSocket connection tracking
type WebSocketTracker interface {
	RegisterWebSocket(conn net.Conn)
	UnregisterWebSocket(conn net.Conn)
}

// ConnectionTracking wraps handlers to track WebSocket connections
// Single responsibility: Track WebSocket lifecycle for idle monitoring
//
// This middleware intercepts WebSocket upgrades by implementing http.Hijacker
// and registering/unregistering connections with the tracker for idle monitoring.
func ConnectionTracking(next http.Handler, tracker WebSocketTracker) http.Handler {
	// Return no-op if tracker is nil
	if tracker == nil {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Wrap response writer to intercept WebSocket upgrades
		wrapper := &connectionTrackingWriter{
			ResponseWriter: w,
			tracker:        tracker,
		}

		next.ServeHTTP(wrapper, r)
	})
}

// connectionTrackingWriter wraps http.ResponseWriter to track WebSocket upgrades
// Implements http.Hijacker to intercept connection upgrades
type connectionTrackingWriter struct {
	http.ResponseWriter

	tracker WebSocketTracker
}

// Hijack implements http.Hijacker interface to support WebSocket upgrades
// Registers the hijacked connection with tracker for idle tracking
func (w *connectionTrackingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("underlying ResponseWriter does not implement http.Hijacker")
	}

	conn, buf, err := hijacker.Hijack()
	if err != nil {
		return nil, nil, err
	}

	// Wrap connection to track WebSocket lifecycle
	trackedConn := &trackedConnection{
		Conn:    conn,
		tracker: w.tracker,
	}

	// Register WebSocket connection for idle tracking
	w.tracker.RegisterWebSocket(trackedConn)

	return trackedConn, buf, nil
}

// WriteHeader forwards the status code to the underlying ResponseWriter
// Required to properly propagate HTTP status codes through the wrapper
func (w *connectionTrackingWriter) WriteHeader(statusCode int) {
	w.ResponseWriter.WriteHeader(statusCode)
}

// Write forwards the response body to the underlying ResponseWriter
// Explicitly implemented for clarity and consistency with other forwarding methods
func (w *connectionTrackingWriter) Write(b []byte) (int, error) {
	return w.ResponseWriter.Write(b)
}

// Flush implements http.Flusher interface to support Server-Sent Events (SSE)
// and chunked transfer encoding. Required for streaming responses.
func (w *connectionTrackingWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Unwrap returns the underlying ResponseWriter
// Allows http.ResponseController to access the original ResponseWriter
func (w *connectionTrackingWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// Push implements http.Pusher interface for HTTP/2 server push
func (w *connectionTrackingWriter) Push(target string, opts *http.PushOptions) error {
	if pusher, ok := w.ResponseWriter.(http.Pusher); ok {
		return pusher.Push(target, opts)
	}
	return http.ErrNotSupported
}

// ReadFrom implements io.ReaderFrom for efficient copying
// Allows http.ResponseWriter optimizations when copying large responses
//
// The fallback uses io.Copy which internally uses a 32KB buffer and handles
// efficient copying through WriteString and WriteTo if available. This is
// sufficient for the middleware's transparent proxy behavior without needing
// to manage custom buffer allocation.
func (w *connectionTrackingWriter) ReadFrom(src io.Reader) (int64, error) {
	if rf, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return rf.ReadFrom(src)
	}
	// Fall back to io.Copy which provides efficient buffered copying
	// Uses 32KB internal buffer and optimizes for WriteTo/WriteString
	return io.Copy(w.ResponseWriter, src)
}

// trackedConnection wraps net.Conn to automatically unregister WebSocket connections
// when they close, ensuring accurate idle tracking
type trackedConnection struct {
	net.Conn

	tracker WebSocketTracker
	once    sync.Once
}

// Read wraps the underlying connection's Read method and triggers cleanup on terminal errors.
// This ensures that connections are unregistered even when the client abruptly disconnects
// (browser closed, network error, TCP connection drop) without the owner calling Close().
func (c *trackedConnection) Read(b []byte) (int, error) {
	n, err := c.Conn.Read(b)
	if err != nil && isTerminalError(err) {
		// Explicitly ignore error from Close() as we're already handling a read error
		// and Close() is idempotent (can be called multiple times safely)
		_ = c.Close()
	}
	return n, err
}

// Write wraps the underlying connection's Write method and triggers cleanup on terminal errors.
// This ensures that connections are unregistered when write failures indicate the connection
// is no longer viable (peer disconnect, network error).
func (c *trackedConnection) Write(b []byte) (int, error) {
	n, err := c.Conn.Write(b)
	if err != nil && isTerminalError(err) {
		// Explicitly ignore error from Close() as we're already handling a write error
		// and Close() is idempotent (can be called multiple times safely)
		_ = c.Close()
	}
	return n, err
}

// Close unregisters the WebSocket connection and closes the underlying connection.
// Uses sync.Once to ensure unregistration happens exactly once, while allowing
// the underlying connection's Close() to be called multiple times (it is idempotent).
func (c *trackedConnection) Close() error {
	// Unregister exactly once, even if Close is called multiple times.
	// The unregistration is wrapped in sync.Once to prevent duplicate map deletions.
	c.once.Do(func() {
		if c.tracker != nil {
			c.tracker.UnregisterWebSocket(c)
		}
	})
	// Call the underlying connection's Close() outside of sync.Once because
	// net.Conn.Close() is idempotent and safe to call multiple times.
	// This ensures the connection is properly closed even if this method
	// is called multiple times from different code paths.
	return c.Conn.Close()
}

// isTerminalError determines if an error indicates the connection is no longer usable
// and should be cleaned up. Timeout-related errors and context cancellation are not
// considered terminal as they may be recoverable or represent intentional interruption.
func isTerminalError(err error) bool {
	if err == nil {
		return false
	}

	// EOF indicates the peer has closed the connection
	if errors.Is(err, io.EOF) {
		return true
	}

	// Context deadline exceeded is not terminal - it's a timeout condition
	// This can occur when read/write deadlines are set on the connection
	if errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	// Context canceled is not terminal - it represents intentional cancellation
	// This can occur during graceful shutdown or request cancellation
	if errors.Is(err, context.Canceled) {
		return false
	}

	// Check if this is a timeout error (not terminal)
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return false
	}

	// All other errors are considered terminal
	// This includes connection refused, connection reset, broken pipe, etc.
	return true
}
