package main

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"sync"
)

/**
 * connectionTrackingMiddleware wraps handlers to track WebSocket connections
 * Single responsibility: Track WebSocket lifecycle for idle monitoring
 *
 * This middleware intercepts WebSocket upgrades by implementing http.Hijacker
 * and registering/unregistering connections with ProcessManager for idle tracking.
 *
 * @param next - Next handler in the chain
 * @param procMgr - Process manager for WebSocket tracking
 * @returns Wrapped handler that tracks WebSocket connections
 */
func connectionTrackingMiddleware(next http.Handler, procMgr *ProcessManager) http.Handler {
	// Return no-op if ProcessManager is nil
	if procMgr == nil {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Wrap response writer to intercept WebSocket upgrades
		wrapper := &connectionTrackingWriter{
			ResponseWriter: w,
			procMgr:        procMgr,
		}

		next.ServeHTTP(wrapper, r)
	})
}

/**
 * connectionTrackingWriter wraps http.ResponseWriter to track WebSocket upgrades
 * Implements http.Hijacker to intercept connection upgrades
 */
type connectionTrackingWriter struct {
	http.ResponseWriter

	procMgr *ProcessManager
}

// Hijack implements http.Hijacker interface to support WebSocket upgrades
// Registers the hijacked connection with ProcessManager for idle tracking
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
		procMgr: w.procMgr,
	}

	// Register WebSocket connection for idle tracking
	w.procMgr.RegisterWebSocket(trackedConn)

	return trackedConn, buf, nil
}

// Flush implements http.Flusher interface to support Server-Sent Events (SSE)
// and chunked transfer encoding. Required for streaming responses.
func (w *connectionTrackingWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

/**
 * trackedConnection wraps net.Conn to automatically unregister WebSocket connections
 * when they close, ensuring accurate idle tracking
 */
type trackedConnection struct {
	net.Conn

	procMgr *ProcessManager
	once    sync.Once
}

// Close unregisters the WebSocket connection and closes the underlying connection
// Uses sync.Once to ensure unregistration happens exactly once
func (c *trackedConnection) Close() error {
	// Unregister exactly once, even if Close is called multiple times
	c.once.Do(func() {
		if c.procMgr != nil {
			c.procMgr.UnregisterWebSocket(c)
		}
	})
	return c.Conn.Close()
}
