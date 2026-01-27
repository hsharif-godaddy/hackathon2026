//go:build linux

package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGetPeerCredentials(t *testing.T) {
	// Create a temporary Unix socket
	tempDir := t.TempDir()
	socketPath := filepath.Join(tempDir, "test.sock")

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("failed to create listener: %v", err)
	}
	defer listener.Close()

	// Accept connection in goroutine
	connChan := make(chan net.Conn, 1)
	errChan := make(chan error, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			errChan <- acceptErr
			return
		}
		connChan <- conn
	}()

	// Connect to socket
	clientConn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer clientConn.Close()

	// Get server-side connection
	select {
	case serverConn := <-connChan:
		defer serverConn.Close()

		// Get peer credentials
		cred, err := getPeerCredentials(serverConn)
		if err != nil {
			t.Fatalf("failed to get peer credentials: %v", err)
		}

		// Verify we got valid credentials
		if cred.PID <= 0 {
			t.Errorf("expected positive PID, got %d", cred.PID)
		}

		// UID should match current process (we're connecting to ourselves)
		expectedUID := os.Getuid()
		if cred.UID != uint32(expectedUID) { //nolint:gosec // UID values are always non-negative
			t.Errorf("expected UID %d, got %d", expectedUID, cred.UID)
		}

		expectedGID := os.Getgid()
		if cred.GID != uint32(expectedGID) { //nolint:gosec // GID values are always non-negative
			t.Errorf("expected GID %d, got %d", expectedGID, cred.GID)
		}

		t.Logf("Got credentials: PID=%d, UID=%d, GID=%d", cred.PID, cred.UID, cred.GID)

	case err := <-errChan:
		t.Fatalf("accept failed: %v", err)
	}
}

func TestPeerCredFromContext(t *testing.T) {
	t.Run("returns nil for empty context", func(t *testing.T) {
		ctx := context.Background()
		cred := peerCredFromContext(ctx)
		if cred != nil {
			t.Errorf("expected nil, got %+v", cred)
		}
	})

	t.Run("returns credentials when present", func(t *testing.T) {
		ctx := context.Background()
		expected := &PeerCredentials{PID: 123, UID: 1000, GID: 1000}
		ctx = context.WithValue(ctx, peerCredContextKey{}, expected)

		cred := peerCredFromContext(ctx)
		if cred == nil {
			t.Fatal("expected credentials, got nil")
		}
		if cred.PID != expected.PID || cred.UID != expected.UID || cred.GID != expected.GID {
			t.Errorf("expected %+v, got %+v", expected, cred)
		}
	})
}

func TestPeerCredPID1Middleware(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK")) //nolint:errcheck // test handler, error not relevant
	})

	middleware := peerCredPID1Middleware(nextHandler)

	t.Run("rejects request without credentials", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		req := httptest.NewRequest("GET", "/test", nil)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected status %d, got %d", http.StatusForbidden, rec.Code)
		}
	})

	t.Run("rejects request with non-PID1 credentials", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		req := httptest.NewRequest("GET", "/test", nil)
		ctx := context.WithValue(req.Context(), peerCredContextKey{}, &PeerCredentials{PID: 42, UID: 1000, GID: 1000})
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected status %d, got %d", http.StatusForbidden, rec.Code)
		}
	})

	t.Run("allows request with PID 1 credentials", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		req := httptest.NewRequest("GET", "/test", nil)
		ctx := context.WithValue(req.Context(), peerCredContextKey{}, &PeerCredentials{PID: 1, UID: 0, GID: 0})
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
	})

	t.Run("bypasses restriction when nomad env missing", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "")
		req := httptest.NewRequest("GET", "/test", nil)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
	})
}
