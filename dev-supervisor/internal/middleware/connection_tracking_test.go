package middleware_test

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
)

// mockWebSocketTracker implements middleware.WebSocketTracker for testing
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

// TestWebSocketTrackerInterface verifies that the interface is correctly defined
// and can be implemented by external types. This ensures the decoupling works
// as intended without tightly coupling to ProcessManager implementation.
func TestWebSocketTrackerInterface(t *testing.T) {
	// Verify we can create a mock implementation
	tracker := &mockWebSocketTracker{}

	// Verify the mock implements the interface at compile time
	var _ middleware.WebSocketTracker = tracker

	// Verify basic functionality
	var mockConn net.Conn // nil is fine for this interface test

	tracker.RegisterWebSocket(mockConn)
	if len(tracker.registered) != 1 {
		t.Errorf("RegisterWebSocket not called, got %d calls", len(tracker.registered))
	}

	tracker.UnregisterWebSocket(mockConn)
	if len(tracker.unregistered) != 1 {
		t.Errorf("UnregisterWebSocket not called, got %d calls", len(tracker.unregistered))
	}
}

// TestConnectionTrackingNilTracker verifies that passing nil tracker returns
// the handler unchanged and doesn't panic (no-op behavior)
func TestConnectionTrackingNilTracker(t *testing.T) {
	called := false
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := middleware.ConnectionTracking(nextHandler, nil)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("Expected next handler to be called with nil tracker")
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

// TestConnectionTrackingWithMockTracker verifies that the middleware properly
// wraps the next handler even with a non-nil tracker
func TestConnectionTrackingWithMockTracker(t *testing.T) {
	tracker := &mockWebSocketTracker{}
	called := false

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := middleware.ConnectionTracking(nextHandler, tracker)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("Expected next handler to be called with tracker")
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	// Note: WebSocket upgrade would require Hijack() which isn't testable
	// with httptest.ResponseRecorder since it doesn't implement http.Hijacker.
	// The full WebSocket tracking behavior is tested in connection_tracking_internal_test.go
	// which has access to unexported types.
}
