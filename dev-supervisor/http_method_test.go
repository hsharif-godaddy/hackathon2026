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

// TestJWTMiddlewareOptionsWhenDisabled tests that OPTIONS requests are handled
// with proper CORS headers even when JWT authentication is disabled.
// This is critical for preview apps where JWT is disabled but CORS headers
// including Access-Control-Allow-Credentials must still be set.
func TestJWTMiddlewareOptionsWhenDisabled(t *testing.T) {
	t.Run("OPTIONS preflight sets CORS headers when JWT is disabled", func(t *testing.T) {
		// Create a handler that should NOT be called for OPTIONS
		backendCalled := false
		backend := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			backendCalled = true
			w.WriteHeader(http.StatusOK)
		})

		// Create JWT middleware with JWT DISABLED but with allowed origins
		allowedOrigins := []string{"https://airo-builder.test-godaddy.com"}
		middleware := NewJWTMiddleware(JWTMiddlewareConfig{
			Enabled:        false, // JWT is disabled
			AllowedOrigins: allowedOrigins,
		})

		// Wrap the backend with JWT middleware
		handler := middleware.Wrap(backend)

		// Create CORS preflight request
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		req.Header.Set("Origin", "https://airo-builder.test-godaddy.com")
		req.Header.Set("Access-Control-Request-Method", "HEAD")
		req.Header.Set("Access-Control-Request-Headers", "authorization")

		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		resp := w.Result()

		// Verify response status
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("Expected status 204, got %d", resp.StatusCode)
		}

		// Backend should NOT be called for OPTIONS preflight
		if backendCalled {
			t.Error("Backend should not be called for OPTIONS preflight")
		}

		// Verify all CORS headers are set correctly
		origin := resp.Header.Get("Access-Control-Allow-Origin")
		if origin != "https://airo-builder.test-godaddy.com" {
			t.Errorf("Expected Access-Control-Allow-Origin to be 'https://airo-builder.test-godaddy.com', got '%s'", origin)
		}

		credentials := resp.Header.Get("Access-Control-Allow-Credentials")
		if credentials != "true" {
			t.Errorf("Expected Access-Control-Allow-Credentials to be 'true', got '%s'", credentials)
		}

		methods := resp.Header.Get("Access-Control-Allow-Methods")
		if methods == "" {
			t.Error("Expected Access-Control-Allow-Methods header to be set")
		}

		headers := resp.Header.Get("Access-Control-Allow-Headers")
		if headers == "" {
			t.Error("Expected Access-Control-Allow-Headers header to be set")
		}

		maxAge := resp.Header.Get("Access-Control-Max-Age")
		if maxAge != "86400" {
			t.Errorf("Expected Access-Control-Max-Age to be '86400', got '%s'", maxAge)
		}

		vary := resp.Header.Get("Vary")
		if !strings.Contains(vary, "Origin") {
			t.Errorf("Expected Vary header to contain 'Origin', got '%s'", vary)
		}
	})

	t.Run("non-OPTIONS requests pass through when JWT is disabled", func(t *testing.T) {
		// Create a handler that SHOULD be called for non-OPTIONS
		backendCalled := false
		backend := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			backendCalled = true
			w.WriteHeader(http.StatusOK)
		})

		// Create JWT middleware with JWT DISABLED
		middleware := NewJWTMiddleware(JWTMiddlewareConfig{
			Enabled:        false,
			AllowedOrigins: []string{"https://airo-builder.test-godaddy.com"},
		})

		handler := middleware.Wrap(backend)

		// Create a HEAD request (not OPTIONS)
		req := httptest.NewRequest("HEAD", "/", nil)
		req.Header.Set("Origin", "https://airo-builder.test-godaddy.com")

		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		// Backend SHOULD be called for non-OPTIONS requests
		if !backendCalled {
			t.Error("Backend should be called for non-OPTIONS requests when JWT is disabled")
		}
	})

	t.Run("OPTIONS with disallowed origin does not set CORS headers", func(t *testing.T) {
		backend := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		// Create JWT middleware with specific allowed origins
		middleware := NewJWTMiddleware(JWTMiddlewareConfig{
			Enabled:        false,
			AllowedOrigins: []string{"https://allowed-origin.com"},
		})

		handler := middleware.Wrap(backend)

		// Create CORS preflight request from DISALLOWED origin
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		req.Header.Set("Origin", "https://malicious-site.com")
		req.Header.Set("Access-Control-Request-Method", "POST")

		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		resp := w.Result()

		// Response should still be 204 (preflight handled)
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("Expected status 204, got %d", resp.StatusCode)
		}

		// But CORS headers should NOT be set for disallowed origin
		origin := resp.Header.Get("Access-Control-Allow-Origin")
		if origin != "" {
			t.Errorf("Expected Access-Control-Allow-Origin to be empty for disallowed origin, got '%s'", origin)
		}

		credentials := resp.Header.Get("Access-Control-Allow-Credentials")
		if credentials != "" {
			t.Errorf("Expected Access-Control-Allow-Credentials to be empty for disallowed origin, got '%s'", credentials)
		}
	})
}
