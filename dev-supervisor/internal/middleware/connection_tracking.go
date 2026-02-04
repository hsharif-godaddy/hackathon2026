package middleware

import (
	"bufio"
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

// Close unregisters the WebSocket connection and closes the underlying connection
// Uses sync.Once to ensure unregistration happens exactly once
func (c *trackedConnection) Close() error {
	// Unregister exactly once, even if Close is called multiple times
	c.once.Do(func() {
		if c.tracker != nil {
			c.tracker.UnregisterWebSocket(c)
		}
	})
	return c.Conn.Close()
}
