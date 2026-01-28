package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsCORSPreflight(t *testing.T) {
	rr := &RequestRouter{}

	t.Run("returns true when Access-Control-Request-Method is present", func(t *testing.T) {
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		req.Header.Set("Access-Control-Request-Method", "POST")

		if !rr.isCORSPreflight(req) {
			t.Error("Expected isCORSPreflight to return true for request with Access-Control-Request-Method")
		}
	})

	t.Run("returns true when Access-Control-Request-Headers is present", func(t *testing.T) {
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		req.Header.Set("Access-Control-Request-Headers", "Content-Type")

		if !rr.isCORSPreflight(req) {
			t.Error("Expected isCORSPreflight to return true for request with Access-Control-Request-Headers")
		}
	})

	t.Run("returns true when both CORS headers are present", func(t *testing.T) {
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "Content-Type")

		if !rr.isCORSPreflight(req) {
			t.Error("Expected isCORSPreflight to return true for request with both CORS headers")
		}
	})

	t.Run("returns false for OPTIONS without CORS headers", func(t *testing.T) {
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)

		if rr.isCORSPreflight(req) {
			t.Error("Expected isCORSPreflight to return false for OPTIONS without CORS headers")
		}
	})

	t.Run("returns false for non-OPTIONS request with CORS headers", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Access-Control-Request-Method", "POST")

		if rr.isCORSPreflight(req) {
			t.Error("Expected isCORSPreflight to return false for non-OPTIONS request")
		}
	})

	t.Run("returns false for other HTTP methods", func(t *testing.T) {
		methods := []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"}
		for _, method := range methods {
			req := httptest.NewRequest(method, "/api/test", nil)
			if rr.isCORSPreflight(req) {
				t.Errorf("Expected isCORSPreflight to return false for %s method", method)
			}
		}
	})
}

func TestCORSPreflightHandling(t *testing.T) {
	t.Run("CORS preflight returns static response without triggering startup", func(t *testing.T) {
		// Create RequestRouter with mock dependencies
		// Empty allowedOrigins = permissive mode (allow all origins)
		rr := &RequestRouter{
			allowedOrigins: []string{},
		}

		// Create CORS preflight request
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		req.Header.Set("Origin", "http://example.com")
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "Content-Type")

		// Record response
		w := httptest.NewRecorder()

		// Handle request
		rr.ServeHTTP(w, req)

		// Verify response
		resp := w.Result()
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("Expected status 204, got %d", resp.StatusCode)
		}

		// Verify CORS headers are present
		if resp.Header.Get("Access-Control-Allow-Origin") == "" {
			t.Error("Expected Access-Control-Allow-Origin header to be set")
		}

		if resp.Header.Get("Access-Control-Allow-Methods") == "" {
			t.Error("Expected Access-Control-Allow-Methods header to be set")
		}
	})
}

func TestConnectMethodRejection(t *testing.T) {
	t.Run("CONNECT method returns 405 Method Not Allowed", func(t *testing.T) {
		rr := &RequestRouter{}

		req := httptest.NewRequest("CONNECT", "example.com:443", nil)
		w := httptest.NewRecorder()

		rr.ServeHTTP(w, req)

		resp := w.Result()
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Expected status 405, got %d", resp.StatusCode)
		}

		// Verify Allow header is present
		allowHeader := resp.Header.Get("Allow")
		if allowHeader == "" {
			t.Error("Expected Allow header to be set")
		}

		// Verify CONNECT is not in the Allow header
		if strings.Contains(allowHeader, "CONNECT") {
			t.Error("CONNECT should not be in Allow header")
		}
	})
}

func TestTraceMethodRejection(t *testing.T) {
	t.Run("TRACE method returns 405 Method Not Allowed", func(t *testing.T) {
		rr := &RequestRouter{}

		req := httptest.NewRequest("TRACE", "/api/test", nil)
		w := httptest.NewRecorder()

		rr.ServeHTTP(w, req)

		resp := w.Result()
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Expected status 405, got %d", resp.StatusCode)
		}

		// Verify Allow header is present
		allowHeader := resp.Header.Get("Allow")
		if allowHeader == "" {
			t.Error("Expected Allow header to be set")
		}

		// Verify TRACE is not in the Allow header
		if strings.Contains(allowHeader, "TRACE") {
			t.Error("TRACE should not be in Allow header")
		}
	})
}

func TestUnknownMethodRejection(t *testing.T) {
	t.Run("unknown methods return 405 Method Not Allowed", func(t *testing.T) {
		rr := &RequestRouter{}

		// Test various unknown methods
		unknownMethods := []string{"PROPFIND", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "CUSTOMMETHOD"}

		for _, method := range unknownMethods {
			req := httptest.NewRequest(method, "/api/test", nil)
			w := httptest.NewRecorder()

			rr.ServeHTTP(w, req)

			resp := w.Result()
			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Errorf("Method %s: Expected status 405, got %d", method, resp.StatusCode)
			}

			// Verify Allow header is present
			allowHeader := resp.Header.Get("Allow")
			if allowHeader == "" {
				t.Errorf("Method %s: Expected Allow header to be set", method)
			}

			// Verify unknown method is not in the Allow header
			if strings.Contains(allowHeader, method) {
				t.Errorf("Method %s should not be in Allow header", method)
			}
		}
	})
}

func TestRealOptionsHandling(t *testing.T) {
	t.Run("real OPTIONS without CORS headers follows normal routing", func(t *testing.T) {
		// Create mock proxy handler that verifies OPTIONS is proxied
		proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "OPTIONS" {
				t.Errorf("Expected OPTIONS method, got %s", r.Method)
			}
			w.WriteHeader(http.StatusOK)
			_, err := w.Write([]byte("OK"))
			if err != nil {
				t.Errorf("Error writing response: %v", err)
			}
		})

		rr := &RequestRouter{
			proxyHandler:     proxyHandler,
			apiPrefix:        "/api",
			isProductionMode: false, // Proxy everything
		}

		// Create real OPTIONS request (no CORS headers)
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		w := httptest.NewRecorder()

		// Handle request
		rr.ServeHTTP(w, req)

		// Verify request was proxied to backend
		resp := w.Result()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("Expected status 200, got %d", resp.StatusCode)
		}
	})
}
