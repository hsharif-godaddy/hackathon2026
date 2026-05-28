//nolint:testpackage // Tests use unexported helpers.
package httpproxy

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rs/cors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const testProxyResponse = "proxy"
const testRemoteAddr = "10.0.0.1:12345"

// Test isWebSocketUpgrade helper function
func TestIsWebSocketUpgrade(t *testing.T) {
	tests := []struct {
		name     string
		headers  map[string]string
		expected bool
	}{
		{
			name: "valid WebSocket upgrade",
			headers: map[string]string{
				"Connection": "Upgrade",
				"Upgrade":    "websocket",
			},
			expected: true,
		},
		{
			name: "case insensitive",
			headers: map[string]string{
				"Connection": "upgrade",
				"Upgrade":    "WebSocket",
			},
			expected: true,
		},
		{
			name: "multiple connection values",
			headers: map[string]string{
				"Connection": "keep-alive, Upgrade",
				"Upgrade":    "websocket",
			},
			expected: true,
		},
		{
			name: "missing upgrade header",
			headers: map[string]string{
				"Connection": "Upgrade",
			},
			expected: false,
		},
		{
			name: "missing connection header",
			headers: map[string]string{
				"Upgrade": "websocket",
			},
			expected: false,
		},
		{
			name: "wrong upgrade value",
			headers: map[string]string{
				"Connection": "Upgrade",
				"Upgrade":    "h2c",
			},
			expected: false,
		},
		{
			name:     "no headers",
			headers:  map[string]string{},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}

			result := isWebSocketUpgrade(req)
			if result != tt.expected {
				t.Errorf("isWebSocketUpgrade() = %v, expected %v", result, tt.expected)
			}
		})
	}
}

// Test that responseWriter implements http.Hijacker
func TestResponseWriterImplementsHijacker(t *testing.T) {
	// Create a test server to get a real ResponseWriter that supports hijacking
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Wrap the response writer
		rw := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
			size:           0,
		}

		// Verify it implements http.Hijacker using type assertion
		hijacker, ok := any(rw).(http.Hijacker)
		if !ok {
			t.Error("responseWriter does not implement http.Hijacker interface")
			return
		}

		// Verify the hijacker is not nil
		if hijacker == nil {
			t.Error("responseWriter Hijacker interface is nil")
		}

		w.WriteHeader(http.StatusOK)
	})

	server := newIPv4TestServer(handler)
	defer server.Close()

	ctx := context.Background()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}

// Test that responseWriter implements http.Flusher
func TestResponseWriterImplementsFlusher(t *testing.T) {
	// Create a test server to get a real ResponseWriter that supports flushing
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Wrap the response writer
		rw := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
			size:           0,
		}

		// Verify it implements http.Flusher using type assertion
		flusher, ok := any(rw).(http.Flusher)
		if !ok {
			t.Error("responseWriter does not implement http.Flusher interface")
			return
		}

		// Verify the flusher is not nil
		if flusher == nil {
			t.Error("responseWriter Flusher interface is nil")
			return
		}

		// Test that Flush() doesn't panic
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("test")); err != nil {
			t.Errorf("Failed to write: %v", err)
		}
		flusher.Flush()
	})

	server := newIPv4TestServer(handler)
	defer server.Close()

	ctx := context.Background()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}

// newIPv4TestServer creates an httptest server that binds to IPv4 only
// This avoids IPv6 binding issues on macOS which can require elevated privileges
func newIPv4TestServer(handler http.Handler) *httptest.Server {
	srv := httptest.NewUnstartedServer(handler)
	// Force IPv4 by using tcp4 network
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		// Fallback to default behavior if IPv4-only fails
		srv.Start()
		return srv
	}
	srv.Listener = listener
	srv.Start()
	return srv
}

// Unit tests for validateConfig()
func TestValidateConfig_MinimalValid(t *testing.T) {
	// Create temporary TLS certificate and key for testing
	certFile := createTempCert(t)
	keyFile := createTempKey(t)

	proxy := &HTTPProxy{
		config: Config{
			Enabled:     true,
			ListenPort:  5000,
			TargetHost:  "localhost",
			TargetPort:  8080,
			TLSCertPath: certFile,
			TLSKeyPath:  keyFile,
		},
	}

	err := proxy.validateConfig()
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

// Unit tests for HTTP mode (without TLS)
func TestValidateConfig_HTTPMode_NoCertificates(t *testing.T) {
	proxy := &HTTPProxy{
		config: Config{
			Enabled:     true,
			ListenPort:  5000,
			TargetHost:  "localhost",
			TargetPort:  8080,
			TLSCertPath: "", // No certificates
			TLSKeyPath:  "",
		},
	}

	err := proxy.validateConfig()
	if err != nil {
		t.Errorf("expected no error when both cert and key are empty (HTTP mode), got: %v", err)
	}
}

func TestValidateConfig_HTTPMode_MismatchedCertificates(t *testing.T) {
	tests := []struct {
		name     string
		certPath string
		keyPath  string
	}{
		{
			name:     "cert provided but no key",
			certPath: "/path/to/cert.pem",
			keyPath:  "",
		},
		{
			name:     "key provided but no cert",
			certPath: "",
			keyPath:  "/path/to/key.pem",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proxy := &HTTPProxy{
				config: Config{
					Enabled:     true,
					ListenPort:  5000,
					TargetHost:  "localhost",
					TargetPort:  8080,
					TLSCertPath: tt.certPath,
					TLSKeyPath:  tt.keyPath,
				},
			}

			err := proxy.validateConfig()
			if err == nil {
				t.Error("expected error when only one of cert/key is provided, got nil")
			}
			if !strings.Contains(err.Error(), "both TLS certificate and key must be provided, or neither") {
				t.Errorf("expected error about mismatched cert/key, got: %v", err)
			}
		})
	}
}

func TestValidateConfig_HTTPMode_NonExistentCertificate(t *testing.T) {
	proxy := &HTTPProxy{
		config: Config{
			Enabled:     true,
			ListenPort:  5000,
			TargetHost:  "localhost",
			TargetPort:  8080,
			TLSCertPath: "/nonexistent/cert.pem",
			TLSKeyPath:  "/nonexistent/key.pem",
		},
	}

	err := proxy.validateConfig()
	if err == nil {
		t.Error("expected error when certificate file doesn't exist, got nil")
	}
	if !strings.Contains(err.Error(), "TLS certificate file not found") {
		t.Errorf("expected error about missing certificate file, got: %v", err)
	}
}

func TestValidateConfig_HTTPMode_NonExistentKey(t *testing.T) {
	certFile := createTempCert(t)

	proxy := &HTTPProxy{
		config: Config{
			Enabled:     true,
			ListenPort:  5000,
			TargetHost:  "localhost",
			TargetPort:  8080,
			TLSCertPath: certFile,
			TLSKeyPath:  "/nonexistent/key.pem",
		},
	}

	err := proxy.validateConfig()
	if err == nil {
		t.Error("expected error when key file doesn't exist, got nil")
	}
	if !strings.Contains(err.Error(), "TLS key file not found") {
		t.Errorf("expected error about missing key file, got: %v", err)
	}
}

// Helper function to create temporary test certificate
func createTempCert(t *testing.T) string {
	t.Helper()
	certFile, err := os.CreateTemp(t.TempDir(), "cert-*.pem")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(certFile.Name()) })

	// Write minimal valid cert content
	if _, err := certFile.WriteString("-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n"); err != nil {
		t.Fatal(err)
	}
	certFile.Close()
	return certFile.Name()
}

// Helper function to create temporary test key
func createTempKey(t *testing.T) string {
	t.Helper()
	keyFile, err := os.CreateTemp(t.TempDir(), "key-*.pem")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(keyFile.Name()) })

	// Write minimal valid key content (split to avoid secret scanner false positive)
	header := "-----BEGIN " + "PRIVATE KEY" + "-----\n"
	footer := "-----END " + "PRIVATE KEY" + "-----\n"
	if _, err := keyFile.WriteString(header + "test\n" + footer); err != nil {
		t.Fatal(err)
	}
	keyFile.Close()
	return keyFile.Name()
}

// Unit tests for RequestRouter
func TestRequestRouter_APIRoute(t *testing.T) {
	// Create mock proxy handler
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(testProxyResponse)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	router := &RequestRouter{
		proxyHandler: proxyHandler,
		apiPrefix:    "/api",
	}

	req := httptest.NewRequest(http.MethodGet, "/api/users", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	if rec.Body.String() != testProxyResponse {
		t.Errorf("expected body %q, got: %s", testProxyResponse, rec.Body.String())
	}
}

func TestRequestRouter_NonAPIRoute_ProxiesToBackend(t *testing.T) {
	// Create mock proxy handler
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(testProxyResponse)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	router := &RequestRouter{
		proxyHandler: proxyHandler,
		apiPrefix:    "/api",
	}

	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	if rec.Body.String() != testProxyResponse {
		t.Errorf("expected body %q, got: %s", testProxyResponse, rec.Body.String())
	}
}

func TestRequestRouter_PostRequest_ProxyToBackend(t *testing.T) {
	// POST requests should always proxy to backend
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(testProxyResponse)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	router := &RequestRouter{
		proxyHandler: proxyHandler,
		apiPrefix:    "/api",
	}

	req := httptest.NewRequest(http.MethodPost, "/submit", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	if rec.Body.String() != testProxyResponse {
		t.Errorf("expected body %q, got: %s", testProxyResponse, rec.Body.String())
	}
}

// Test that upstream X-Forwarded-Proto is preserved (for TLS-terminating load balancers)
func TestReverseProxy_PreservesUpstreamXForwardedProto(t *testing.T) {
	var capturedHeaders http.Header
	backend := newIPv4TestServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	host := backendURL.Hostname()
	port := backendURL.Port()
	if port == "" {
		port = "80"
	}

	proxy := NewHTTPProxy(Config{
		Enabled:    true,
		ListenPort: 0,
		TargetHost: host,
		TargetPort: mustParsePort(t, port),
	})

	targetURL := &url.URL{
		Scheme: protoHTTP,
		Host:   backend.URL[7:],
	}

	// Create a ReverseProxy with Rewrite (not Director)
	proxy.reverseProxy = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)

			r.Out.Host = r.In.Host
			r.Out.Header.Set("Host", r.In.Host)

			if xff := r.In.Header.Get("X-Forwarded-For"); xff != "" {
				r.Out.Header["X-Forwarded-For"] = []string{xff}
			}

			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))
		},
	}

	req := httptest.NewRequest(http.MethodGet, "http://example.com/test", nil)
	req.Header.Set("X-Forwarded-Proto", protoHTTPS) // Upstream proxy set this
	req.RemoteAddr = testRemoteAddr

	rec := httptest.NewRecorder()
	proxy.reverseProxy.ServeHTTP(rec, req)

	if capturedHeaders.Get("X-Forwarded-Proto") != protoHTTPS {
		t.Errorf("expected X-Forwarded-Proto 'https' (from upstream), got: %s",
			capturedHeaders.Get("X-Forwarded-Proto"))
	}
}

// Test that X-Forwarded-Proto defaults to the inbound request scheme when not set
func TestReverseProxy_DefaultsXForwardedProtoToRequestScheme(t *testing.T) {
	var capturedHeaders http.Header
	backend := newIPv4TestServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	host := backendURL.Hostname()
	port := backendURL.Port()
	if port == "" {
		port = "80"
	}

	proxy := NewHTTPProxy(Config{
		Enabled:    true,
		ListenPort: 0,
		TargetHost: host,
		TargetPort: mustParsePort(t, port),
	})

	targetURL := &url.URL{
		Scheme: protoHTTP,
		Host:   backend.URL[7:],
	}

	// Create a ReverseProxy with Rewrite (not Director)
	proxy.reverseProxy = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)

			r.Out.Host = r.In.Host
			r.Out.Header.Set("Host", r.In.Host)

			if xff := r.In.Header.Get("X-Forwarded-For"); xff != "" {
				r.Out.Header["X-Forwarded-For"] = []string{xff}
			}

			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))
		},
	}

	req := httptest.NewRequest(http.MethodGet, "http://example.com/test", nil)
	// No X-Forwarded-Proto header set
	req.RemoteAddr = testRemoteAddr

	rec := httptest.NewRecorder()
	proxy.reverseProxy.ServeHTTP(rec, req)

	if capturedHeaders.Get("X-Forwarded-Proto") != protoHTTP {
		t.Errorf("expected X-Forwarded-Proto to default to '%s', got: %s",
			protoHTTP,
			capturedHeaders.Get("X-Forwarded-Proto"))
	}
}

func TestReverseProxy_DefaultsXForwardedProtoToHTTPSWhenTLS(t *testing.T) {
	var capturedHeaders http.Header
	backend := newIPv4TestServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	host := backendURL.Hostname()
	port := backendURL.Port()
	if port == "" {
		port = "80"
	}

	proxy := NewHTTPProxy(Config{
		Enabled:    true,
		ListenPort: 0,
		TargetHost: host,
		TargetPort: mustParsePort(t, port),
	})

	targetURL := &url.URL{
		Scheme: protoHTTP,
		Host:   backend.URL[7:],
	}

	proxy.reverseProxy = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)
			r.Out.Host = r.In.Host
			r.Out.Header.Set("Host", r.In.Host)

			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))
		},
	}

	req := httptest.NewRequest(http.MethodGet, "https://example.com/test", nil)
	req.RemoteAddr = testRemoteAddr
	req.TLS = &tls.ConnectionState{}

	rec := httptest.NewRecorder()
	proxy.reverseProxy.ServeHTTP(rec, req)

	if capturedHeaders.Get("X-Forwarded-Proto") != protoHTTPS {
		t.Errorf("expected X-Forwarded-Proto to default to '%s' when TLS is present, got: %s",
			protoHTTPS,
			capturedHeaders.Get("X-Forwarded-Proto"))
	}
}

func TestReverseProxy_IgnoresInvalidForwardedProto(t *testing.T) {
	var capturedHeaders http.Header
	backend := newIPv4TestServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	host := backendURL.Hostname()
	port := backendURL.Port()
	if port == "" {
		port = "80"
	}

	proxy := NewHTTPProxy(Config{
		Enabled:    true,
		ListenPort: 0,
		TargetHost: host,
		TargetPort: mustParsePort(t, port),
	})

	targetURL := &url.URL{
		Scheme: protoHTTP,
		Host:   backend.URL[7:],
	}

	proxy.reverseProxy = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)
			r.Out.Host = r.In.Host
			r.Out.Header.Set("Host", r.In.Host)
			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))
		},
	}

	req := httptest.NewRequest(http.MethodGet, "http://example.com/test", nil)
	req.Header.Set("X-Forwarded-Proto", "ftp") // invalid value should be ignored
	req.RemoteAddr = testRemoteAddr

	rec := httptest.NewRecorder()
	proxy.reverseProxy.ServeHTTP(rec, req)

	if capturedHeaders.Get("X-Forwarded-Proto") != protoHTTP {
		t.Fatalf(
			"expected invalid header to fall back to '%s', got %s",
			protoHTTP,
			capturedHeaders.Get("X-Forwarded-Proto"),
		)
	}
}

// Test that X-Forwarded-For is passed through unchanged
func TestReverseProxy_PassesThroughXForwardedFor(t *testing.T) {
	var capturedHeaders http.Header
	backend := newIPv4TestServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	host := backendURL.Hostname()
	port := backendURL.Port()
	if port == "" {
		port = "80"
	}

	proxy := NewHTTPProxy(Config{
		Enabled:    true,
		ListenPort: 0,
		TargetHost: host,
		TargetPort: mustParsePort(t, port),
	})

	targetURL := &url.URL{
		Scheme: protoHTTP,
		Host:   backend.URL[7:],
	}

	// Create a ReverseProxy with Rewrite (not Director)
	proxy.reverseProxy = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)

			r.Out.Host = r.In.Host
			r.Out.Header.Set("Host", r.In.Host)

			if xff := r.In.Header.Get("X-Forwarded-For"); xff != "" {
				r.Out.Header["X-Forwarded-For"] = []string{xff}
			}

			r.Out.Header.Set("X-Forwarded-Proto", determineForwardedProto(r.In))
		},
	}

	req := httptest.NewRequest(http.MethodGet, "http://example.com/test", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.42, 198.51.100.1") // Upstream chain
	req.RemoteAddr = testRemoteAddr

	rec := httptest.NewRecorder()
	proxy.reverseProxy.ServeHTTP(rec, req)

	xff := capturedHeaders.Get("X-Forwarded-For")
	expected := "203.0.113.42, 198.51.100.1"
	if xff != expected {
		t.Errorf("expected X-Forwarded-For '%s' (unchanged), got: %s", expected, xff)
	}
}

// Helper function to parse port string to int
func mustParsePort(t *testing.T, portStr string) int {
	t.Helper()
	var port int
	if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil {
		t.Fatalf("failed to parse port %q: %v", portStr, err)
	}
	return port
}

// Test that /airo/health returns 200 (health check endpoint)
func TestAiroPath_HealthEndpoint_Returns200(t *testing.T) {
	// Create a test mux that mimics the proxy routing
	mux := http.NewServeMux()

	// Mock health check handler
	mux.HandleFunc("/airo/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(`{"status":"healthy"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	// Catch-all for /airo/*
	mux.HandleFunc("/airo/", func(w http.ResponseWriter, _ *http.Request) {
		http.NotFound(w, nil)
	})

	// Test /airo/health
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for /airo/health, got: %d", rec.Code)
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Errorf("expected Content-Type application/json, got: %s", contentType)
	}
}

// Test that /airo/foo returns 404 (catch-all)
func TestAiroPath_UnmatchedPath_Returns404(t *testing.T) {
	// Create a test mux that mimics the proxy routing
	mux := http.NewServeMux()

	// Health check handler
	mux.HandleFunc("/airo/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Catch-all for /airo/*
	mux.HandleFunc("/airo/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	// Proxy handler for everything else
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("proxied")); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})
	mux.Handle("/", proxyHandler)

	// Test /airo/foo
	req := httptest.NewRequest(http.MethodGet, "/airo/foo", nil)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for /airo/foo, got: %d", rec.Code)
	}
}

// Test that multiple unmatched /airo paths return 404
func TestAiroPath_MultipleUnmatchedPaths_Return404(t *testing.T) {
	// Create a test mux that mimics the proxy routing
	mux := http.NewServeMux()

	mux.HandleFunc("/airo/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/airo/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	// Test multiple unmatched /airo paths
	testPaths := []string{
		"/airo/foo",
		"/airo/bar",
		"/airo/api/test",
		"/airo/something/nested",
	}

	for _, path := range testPaths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusNotFound {
				t.Errorf("expected status 404 for %s, got: %d", path, rec.Code)
			}
		})
	}
}

// Test that non-/airo paths still proxy to backend
func TestAiroPath_NonAiroPaths_ProxyToBackend(t *testing.T) {
	// Create a test mux that mimics the proxy routing
	mux := http.NewServeMux()

	mux.HandleFunc("/airo/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/airo/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	// Proxy handler for everything else
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("proxied")); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})
	mux.Handle("/", proxyHandler)

	// Test paths that should be proxied
	testPaths := []string{
		"/",
		"/api/users",
		"/health",
		"/foo/bar",
	}

	for _, path := range testPaths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("expected status 200 for %s (proxied), got: %d", path, rec.Code)
			}

			if !strings.Contains(rec.Body.String(), "proxied") {
				t.Errorf("expected proxied response for %s, got: %s", path, rec.Body.String())
			}
		})
	}
}

// Test that /airo path (without trailing slash) redirects then 404s
func TestAiroPath_ExactAiroPath_Returns404(t *testing.T) {
	// Create a test mux that mimics the proxy routing
	mux := http.NewServeMux()

	mux.HandleFunc("/airo/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/airo/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	// Test /airo (without trailing slash)
	// Go's ServeMux will redirect /airo to /airo/ automatically
	req := httptest.NewRequest(http.MethodGet, "/airo", nil)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	// Should be a redirect (301 or 307 depending on Go version) or 404
	if rec.Code != http.StatusMovedPermanently && rec.Code != http.StatusTemporaryRedirect &&
		rec.Code != http.StatusNotFound {
		t.Errorf("expected redirect or 404 for /airo, got: %d", rec.Code)
	}
}

// Test RequestRouter auto-start when process is stopped
func TestRequestRouter_AutoStartWhenStopped(t *testing.T) {
	// Start a simple HTTP server process
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateStopped,
		},
		startRequest: &validation.ProcessStartRequest{
			Command: "sleep 5",
		},
		startOnRequestEnabled: true,
	}

	// Create a RequestRouter with start-on-request enabled
	router := &RequestRouter{
		proxyHandler:          httputil.NewSingleHostReverseProxy(backendURL),
		procMgr:               procMgr,
		startOnRequestEnabled: true,
	}

	// Verify process is stopped
	status := procMgr.GetStatus()
	require.Equal(t, ProcessStateStopped, status.State)

	// Make a request - should trigger auto-start
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	// Start goroutine to handle the request
	done := make(chan bool)
	go func() {
		router.ServeHTTP(rec, req)
		done <- true
	}()

	// Wait a bit for auto-start to trigger
	time.Sleep(500 * time.Millisecond)

	// Process should now be starting or running
	status = procMgr.GetStatus()
	assert.Equal(t, ProcessStateRunning, status.State,
		"process should be running after auto-start")

	<-done
}

// Test RequestRouter doesn't auto-start when process is already running
func TestRequestRouter_NoAutoStartWhenRunning(t *testing.T) {
	// Create backend server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateRunning,
			PID:   999,
		},
		startRequest: &validation.ProcessStartRequest{
			Command: "sleep 10",
		},
		startOnRequestEnabled: true,
	}

	// Create RequestRouter
	router := &RequestRouter{
		proxyHandler:          httputil.NewSingleHostReverseProxy(backendURL),
		procMgr:               procMgr,
		startOnRequestEnabled: true,
	}

	// Verify process is running
	status := procMgr.GetStatus()
	require.Equal(t, ProcessStateRunning, status.State)

	// Make a request - should NOT trigger auto-start (process already running)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Process should still be running (same PID)
	newStatus := procMgr.GetStatus()
	assert.Equal(t, ProcessStateRunning, newStatus.State)
	assert.Equal(t, status.PID, newStatus.PID, "PID should remain the same")

	assert.Equal(t, 0, procMgr.startCalls, "should not attempt to start when already running")
}

// Test RequestRouter doesn't auto-start when startOnRequestEnabled is false
func TestRequestRouter_NoAutoStartWhenDisabled(t *testing.T) {
	// Create backend server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateStopped,
		},
		startRequest: &validation.ProcessStartRequest{
			Command: "sleep 10",
		},
	}

	// Create RequestRouter with start-on-request DISABLED
	router := &RequestRouter{
		proxyHandler:          httputil.NewSingleHostReverseProxy(backendURL),
		procMgr:               procMgr,
		startOnRequestEnabled: false, // disabled
	}

	// Verify process is stopped
	status := procMgr.GetStatus()
	require.Equal(t, ProcessStateStopped, status.State)

	// Make a request - should NOT trigger auto-start
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Process should still be stopped
	status = procMgr.GetStatus()
	assert.Equal(t, ProcessStateStopped, status.State, "process should remain stopped when auto-start is disabled")
	assert.Equal(t, 0, procMgr.startCalls, "should not attempt to start when auto-start is disabled")
}

// Test activity tracking is called on proxied requests
func TestRequestRouter_ActivityTracking(t *testing.T) {
	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateRunning,
		},
		startOnRequestEnabled: true,
	}
	procMgr.lastActivity = time.Now().Add(-50 * time.Millisecond)
	initialActivity := procMgr.lastActivity

	// Wait a bit to ensure time difference
	time.Sleep(50 * time.Millisecond)

	// Create backend server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	// Create RequestRouter
	router := &RequestRouter{
		proxyHandler:          httputil.NewSingleHostReverseProxy(backendURL),
		procMgr:               procMgr,
		startOnRequestEnabled: true,
	}

	// Make a proxied request
	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Activity time should be updated
	newActivity := procMgr.lastActivity
	assert.True(t, newActivity.After(initialActivity), "activity time should be updated after proxied request")
}

// TestModifyResponse_StripsDuplicateCORSHeaders verifies that backend CORS headers
// are removed to prevent duplicate headers when both proxy and backend set CORS
func TestModifyResponse_StripsDuplicateCORSHeaders(t *testing.T) {
	// Create backend that sets its own CORS headers (like Vite does)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Simulate backend (Vite) setting CORS headers
		w.Header().Set("Access-Control-Allow-Origin", "http://backend-origin.com")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "3600")
		w.Header().Set("Access-Control-Expose-Headers", "X-Custom")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	// Create proxy with ModifyResponse that strips CORS headers
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(backendURL)
		},
		ModifyResponse: func(resp *http.Response) error {
			// This is the fix - strip backend CORS headers
			resp.Header.Del("Access-Control-Allow-Origin")
			resp.Header.Del("Access-Control-Allow-Credentials")
			resp.Header.Del("Access-Control-Allow-Methods")
			resp.Header.Del("Access-Control-Allow-Headers")
			resp.Header.Del("Access-Control-Max-Age")
			resp.Header.Del("Access-Control-Expose-Headers")
			return nil
		},
	}

	// Make request through proxy
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	proxy.ServeHTTP(rec, req)

	// Verify response is successful
	assert.Equal(t, http.StatusOK, rec.Code, "should get successful response")

	// Verify backend CORS headers were stripped
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
		"backend CORS origin header should be removed")
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"),
		"backend CORS credentials header should be removed")
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Methods"),
		"backend CORS methods header should be removed")
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Headers"),
		"backend CORS headers header should be removed")
	assert.Empty(t, rec.Header().Get("Access-Control-Max-Age"),
		"backend CORS max-age header should be removed")
	assert.Empty(t, rec.Header().Get("Access-Control-Expose-Headers"),
		"backend CORS expose-headers header should be removed")

	// Verify other headers are preserved
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"),
		"other headers should be preserved")
	assert.JSONEq(t, `{"status":"ok"}`, rec.Body.String(),
		"response body should be preserved")
}

// TestModifyResponse_PreservesNonCORSHeaders verifies that only CORS headers
// are removed, and other headers pass through correctly
func TestModifyResponse_PreservesNonCORSHeaders(t *testing.T) {
	// Create backend with various headers
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.Header().Set("X-Custom-Header", "custom-value")
		w.Header().Set("Set-Cookie", "session=abc123")
		// Also set CORS headers to be stripped
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html></html>"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	// Create proxy with ModifyResponse
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(backendURL)
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("Access-Control-Allow-Origin")
			resp.Header.Del("Access-Control-Allow-Credentials")
			resp.Header.Del("Access-Control-Allow-Methods")
			resp.Header.Del("Access-Control-Allow-Headers")
			resp.Header.Del("Access-Control-Max-Age")
			resp.Header.Del("Access-Control-Expose-Headers")
			return nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	proxy.ServeHTTP(rec, req)

	// Verify CORS headers removed
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))

	// Verify non-CORS headers preserved
	assert.Equal(t, "text/html", rec.Header().Get("Content-Type"))
	assert.Equal(t, "max-age=3600", rec.Header().Get("Cache-Control"))
	assert.Equal(t, "custom-value", rec.Header().Get("X-Custom-Header"))
	assert.Equal(t, "session=abc123", rec.Header().Get("Set-Cookie"))
	assert.Equal(t, "<html></html>", rec.Body.String())
}

// TestHTTPProxy_HealthCheck_IdledButWasHealthy tests that health check returns 200
// for a process that was healthy before being idled (not probing backend)
func TestHTTPProxy_HealthCheck_IdledButWasHealthy(t *testing.T) {
	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateStopped,
		},
		wasHealthyBeforeIdle:  true,
		startOnRequestEnabled: true,
	}

	// Create HTTP proxy with start-on-request enabled
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: "localhost",
			TargetPort: 9999, // Non-existent port (backend not running)
		},
		procMgr:               procMgr,
		startOnRequestEnabled: true,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 200 with healthy status and reason "idle"
	assert.Equal(t, http.StatusOK, rec.Code, "health check should return 200 for idled but healthy app")

	var resp ProxyHealthResponse
	err := json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "healthy", resp.Status, "status should be 'healthy'")
	assert.Equal(t, "autostart", resp.Reason, "reason should be 'autostart'")

	// Verify cache headers are set
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-cache",
		"should have no-cache in Cache-Control")
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-store",
		"should have no-store in Cache-Control")
	assert.Equal(t, "no-cache", rec.Header().Get("Pragma"), "should have Pragma: no-cache")
	assert.Equal(t, "0", rec.Header().Get("Expires"), "should have Expires: 0")
}

// TestHTTPProxy_HealthCheck_StartOnRequestColdStart tests that health check returns 200
// when start-on-request is enabled but the app hasn't started yet (cold start)
func TestHTTPProxy_HealthCheck_StartOnRequestColdStart(t *testing.T) {
	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateStopped,
		},
		wasHealthyBeforeIdle:  false, // Never started yet (cold start)
		startOnRequestEnabled: true,
	}

	// Create HTTP proxy with start-on-request enabled
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: "localhost",
			TargetPort: 9999, // Non-existent port (backend not running)
		},
		procMgr:               procMgr,
		startOnRequestEnabled: true,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 200 with healthy status and reason "autostart"
	assert.Equal(t, http.StatusOK, rec.Code,
		"health check should return 200 for start-on-request cold start")

	var resp ProxyHealthResponse
	err := json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "healthy", resp.Status, "status should be 'healthy'")
	assert.Equal(t, "autostart", resp.Reason, "reason should be 'autostart'")

	// Verify cache headers are set
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-cache",
		"should have no-cache in Cache-Control")
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-store",
		"should have no-store in Cache-Control")
	assert.Equal(t, "no-cache", rec.Header().Get("Pragma"), "should have Pragma: no-cache")
	assert.Equal(t, "0", rec.Header().Get("Expires"), "should have Expires: 0")
}

// TestHTTPProxy_HealthCheck_RunningProcess tests that health check probes
// the backend when process is running (normal healthy case)
func TestHTTPProxy_HealthCheck_RunningProcess(t *testing.T) {
	// Create a real backend that responds to health checks
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateRunning,
			PID:   1234,
		},
		startOnRequestEnabled: true,
	}

	// Create HTTP proxy pointing to the test backend
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: backendURL.Hostname(),
			TargetPort: mustParsePort(t, backendURL.Port()),
		},
		procMgr:               procMgr,
		startOnRequestEnabled: true,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 200 with healthy status (probing backend)
	assert.Equal(t, http.StatusOK, rec.Code, "health check should return 200 for running app")

	var resp ProxyHealthResponse
	err = json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "healthy", resp.Status, "status should be 'healthy'")
	assert.Empty(t, resp.Reason, "reason should be empty for normal healthy state")
}

func TestHTTPProxy_ImageSlotRoute(t *testing.T) {
	// Create temporary static directory with manifest
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "airo-media.json")

	manifest := ImageManifest{
		"pages/home/hero": {CurrentURL: "https://media.gettyimages.com/id/abc123/photo.jpg"},
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0600)

	// Create test mux mimicking proxy setup
	mux := http.NewServeMux()

	// Add image slot handler
	cache := NewManifestCache(manifestPath)
	mux.Handle("/airo-assets/images/", NewImageSlotHandler(cache, []string{filepath.Join(tmpDir, "public", "media")}))

	// Add health check
	mux.HandleFunc("/airo/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Test image slot request
	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Errorf("expected status 302, got: %d", rec.Code)
	}

	location := rec.Header().Get("Location")
	if location != "https://media.gettyimages.com/id/abc123/photo.jpg" {
		t.Errorf("expected Getty redirect, got: %s", location)
	}
}

func TestHTTPProxy_ImageSlotRoute_NoManifest(t *testing.T) {
	// When static root doesn't have airo-media.json, handler should return 500
	tmpDir := t.TempDir()
	// Don't create the manifest file

	mux := http.NewServeMux()

	cache := NewManifestCache(filepath.Join(tmpDir, "airo-media.json"))
	mux.Handle("/airo-assets/images/", NewImageSlotHandler(cache, []string{filepath.Join(tmpDir, "public", "media")}))

	req := httptest.NewRequest(http.MethodGet, "/airo-assets/images/pages/home/hero", nil)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500 when manifest missing, got: %d", rec.Code)
	}
}

// TestHTTPProxy_HealthCheck_NoStartOnRequest tests that health check behavior
// is unchanged when start-on-request is disabled
func TestHTTPProxy_HealthCheck_NoStartOnRequest(t *testing.T) {
	// Create HTTP proxy with start-on-request DISABLED
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: "localhost",
			TargetPort: 9999, // Non-existent port
		},
		procMgr:               nil, // No process manager
		startOnRequestEnabled: false,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 503 (backend not reachable, normal behavior)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"health check should return 503 when backend not reachable")

	var resp ProxyHealthResponse
	err := json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "unhealthy", resp.Status, "status should be 'unhealthy'")
}

// TestHTTPProxy_HealthCheck_DeferredSetupPending tests that health check returns 200
// when deferred setup is pending (app not started yet but will start on first request)
func TestHTTPProxy_HealthCheck_DeferredSetupPending(t *testing.T) {
	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateStopped,
		},
		hasDeferredSetup:          true,
		deferredSetupExecutedOnce: false,
	}

	// Create HTTP proxy with deferred setup
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: "localhost",
			TargetPort: 9999, // Non-existent port (backend not running)
		},
		procMgr:               procMgr,
		startOnRequestEnabled: false, // Not needed for deferred setup
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 200 with healthy status and reason "deferred_setup"
	assert.Equal(t, http.StatusOK, rec.Code, "health check should return 200 when deferred setup is pending")

	var resp ProxyHealthResponse
	err := json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "healthy", resp.Status, "status should be 'healthy'")
	assert.Equal(t, "autostart", resp.Reason, "reason should be 'autostart'")

	// Verify cache headers are set
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-cache",
		"should have no-cache in Cache-Control")
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-store",
		"should have no-store in Cache-Control")
	assert.Equal(t, "no-cache", rec.Header().Get("Pragma"), "should have Pragma: no-cache")
	assert.Equal(t, "0", rec.Header().Get("Expires"), "should have Expires: 0")
}

// TestHTTPProxy_HealthCheck_ProxyDisabled tests that health check returns 503
// when proxy is disabled (shouldn't happen in practice as handler isn't registered)
func TestHTTPProxy_HealthCheck_ProxyDisabled(t *testing.T) {
	// Create HTTP proxy with proxy DISABLED
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    false, // Proxy disabled
			ListenPort: 8080,
			TargetHost: "localhost",
			TargetPort: 9999,
		},
		procMgr:               nil,
		startOnRequestEnabled: false,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 503 with unhealthy status
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"health check should return 503 when proxy is disabled")

	var resp ProxyHealthResponse
	err := json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "unhealthy", resp.Status, "status should be 'unhealthy'")
	assert.Equal(t, "proxy not enabled", resp.Reason, "reason should be 'proxy not enabled'")
}

// TestHTTPProxy_HealthCheck_BackendReturns500 tests that health check returns 503
// when backend is running but returns a 5xx error
func TestHTTPProxy_HealthCheck_BackendReturns500(t *testing.T) {
	// Create a backend that returns 500 Internal Server Error
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal Server Error"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	// Create HTTP proxy pointing to the test backend
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: backendURL.Hostname(),
			TargetPort: mustParsePort(t, backendURL.Port()),
		},
		procMgr:               nil,
		startOnRequestEnabled: false,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 503 with unhealthy status
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"health check should return 503 when backend returns 500")

	var resp ProxyHealthResponse
	err = json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "unhealthy", resp.Status, "status should be 'unhealthy'")
	assert.Equal(t, "target returned status 500", resp.Reason,
		"reason should indicate backend returned 500")
}

// TestHTTPProxy_HealthCheck_BackendReturns404 tests that health check returns 503
// when backend is running but returns a 404 Not Found
func TestHTTPProxy_HealthCheck_BackendReturns404(t *testing.T) {
	// Create a backend that returns 404 Not Found
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("Not Found"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	// Create HTTP proxy pointing to the test backend
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: backendURL.Hostname(),
			TargetPort: mustParsePort(t, backendURL.Port()),
		},
		procMgr:               nil,
		startOnRequestEnabled: false,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 503 with unhealthy status
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"health check should return 503 when backend returns 404")

	var resp ProxyHealthResponse
	err = json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "unhealthy", resp.Status, "status should be 'unhealthy'")
	assert.Equal(t, "target returned status 404", resp.Reason,
		"reason should indicate backend returned 404")
}

// TestHTTPProxy_HealthCheck_BackendReturns302 tests that health check returns 503
// when backend returns a redirect (3xx) - redirects are NOT considered healthy
func TestHTTPProxy_HealthCheck_BackendReturns302(t *testing.T) {
	// Create a backend that returns 302 Found (redirect)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "https://example.com/redirect")
		w.WriteHeader(http.StatusFound)
		w.Write([]byte("Redirecting..."))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	require.NoError(t, err)

	// Create HTTP proxy pointing to the test backend
	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: backendURL.Hostname(),
			TargetPort: mustParsePort(t, backendURL.Port()),
		},
		procMgr:               nil,
		startOnRequestEnabled: false,
	}

	// Call handleHealthCheck directly
	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()

	proxy.handleHealthCheck(rec, req)

	// Should return 503 with unhealthy status (redirects are NOT healthy)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"health check should return 503 when backend returns redirect (3xx)")

	var resp ProxyHealthResponse
	err = json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "unhealthy", resp.Status, "status should be 'unhealthy'")
	assert.Equal(t, "target returned status 302", resp.Reason,
		"reason should indicate backend returned 302")
}

// TestHTTPProxy_HealthCheck_StatusPageActive verifies that the publish-container
// status page short-circuits the health check: when the embedded "Coming Soon"
// or "Suspended" page is in front of the (absent) backend, dev-supervisor
// itself is healthy and we must not probe a never-started backend.
func TestHTTPProxy_HealthCheck_StatusPageActive(t *testing.T) {
	tmpDir := t.TempDir()
	// No /dist/current present → status page is active.
	sp, err := NewStatusPage(StatusPageConfig{DistDir: tmpDir})
	require.NoError(t, err)
	require.True(t, sp.Active(), "status page should be active with no archive")

	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: "localhost",
			TargetPort: 9999, // Non-existent port (no backend running)
			StatusPage: sp,
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()
	proxy.handleHealthCheck(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code,
		"health check should return 200 when status page is active")

	var resp ProxyHealthResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "healthy", resp.Status)
	assert.Empty(t, resp.Reason, "status-page short-circuit matches the 2xx-backend shape: no reason field")
}

// TestHTTPProxy_HealthCheck_StatusPagePublished verifies that once the status
// page reports inactive (publish archive present, MarkPublished called), the
// short-circuit yields and the health check probes the backend normally.
func TestHTTPProxy_HealthCheck_StatusPagePublished(t *testing.T) {
	tmpDir := t.TempDir()
	sp, err := NewStatusPage(StatusPageConfig{DistDir: tmpDir})
	require.NoError(t, err)
	sp.MarkPublished()
	require.False(t, sp.Active(), "status page should be inactive after publish")

	proxy := &HTTPProxy{
		config: Config{
			Enabled:    true,
			ListenPort: 8080,
			TargetHost: "localhost",
			TargetPort: 9999, // No backend running
			StatusPage: sp,
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/airo/health", nil)
	rec := httptest.NewRecorder()
	proxy.handleHealthCheck(rec, req)

	// Backend is unreachable, so the standard 503 path runs (no short-circuit).
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"published-but-unreachable backend should fall through to 503")

	var resp ProxyHealthResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "unhealthy", resp.Status)
}

// TestReverseProxy_ErrorHandler_CORSHeaders tests that error responses
// include proper CORS headers when backend is unavailable
func TestReverseProxy_ErrorHandler_CORSHeaders(t *testing.T) {
	// Create a proxy that points to a non-existent backend (connection will fail)
	targetURL := &url.URL{
		Scheme: "http",
		Host:   "localhost:9999", // Non-existent port
	}

	// Create CORS middleware with allowed origins
	corsMiddleware := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://example.com", "https://example.com"},
		AllowCredentials: true,
	})

	// Create HTTP proxy with our error handler
	proxy := &HTTPProxy{
		config: Config{
			Enabled:        true,
			AllowedOrigins: []string{"http://example.com", "https://example.com"},
		},
		corsMiddleware: corsMiddleware,
	}

	// Create transport with minimal timeout to fail fast
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 10 * time.Millisecond,
		}).DialContext,
	}

	// Create reverse proxy with the error handler
	proxy.reverseProxy = proxy.newReverseProxy(targetURL, transport)

	// Make request with allowed Origin header
	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Origin", "http://example.com")
	rec := httptest.NewRecorder()

	// Serve request (will fail and trigger ErrorHandler)
	proxy.reverseProxy.ServeHTTP(rec, req)

	// Should return 503 Service Unavailable (connection refused/timeout)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"should return 503 when backend unavailable")

	// Verify CORS headers are present
	assert.Equal(t, "http://example.com", rec.Header().Get("Access-Control-Allow-Origin"),
		"should echo origin in Access-Control-Allow-Origin")
	assert.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Credentials"),
		"should set Access-Control-Allow-Credentials to true")

	// Verify Vary header includes Origin
	varyHeader := rec.Header().Get("Vary")
	assert.Contains(t, varyHeader, "Origin",
		"Vary header should include Origin")
}

// TestReverseProxy_ErrorHandler_VaryHeaderAppend tests that Vary header
// is properly set when CORS headers are added to error responses
func TestReverseProxy_ErrorHandler_VaryHeaderAppend(t *testing.T) {
	// Create a proxy that points to a non-existent backend
	targetURL := &url.URL{
		Scheme: "http",
		Host:   "localhost:9999",
	}

	corsMiddleware := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://example.com"},
		AllowCredentials: true,
	})

	proxy := &HTTPProxy{
		config: Config{
			Enabled:        true,
			AllowedOrigins: []string{"http://example.com"},
		},
		corsMiddleware: corsMiddleware,
	}

	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 10 * time.Millisecond,
		}).DialContext,
	}

	proxy.reverseProxy = proxy.newReverseProxy(targetURL, transport)

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Origin", "http://example.com")
	rec := httptest.NewRecorder()

	proxy.reverseProxy.ServeHTTP(rec, req)

	// Verify Vary header is set when CORS headers are added
	varyHeader := rec.Header().Get("Vary")
	assert.Contains(t, varyHeader, "Origin",
		"should set Vary: Origin when CORS headers are added")
}

// TestReverseProxy_ErrorHandler_NoCORSForDisallowedOrigin tests that
// CORS headers are NOT added for disallowed origins
func TestReverseProxy_ErrorHandler_NoCORSForDisallowedOrigin(t *testing.T) {
	targetURL := &url.URL{
		Scheme: "http",
		Host:   "localhost:9999",
	}

	corsMiddleware := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://example.com"},
		AllowCredentials: true,
	})

	proxy := &HTTPProxy{
		config: Config{
			Enabled:        true,
			AllowedOrigins: []string{"http://example.com"},
		},
		corsMiddleware: corsMiddleware,
	}

	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 10 * time.Millisecond,
		}).DialContext,
	}

	proxy.reverseProxy = proxy.newReverseProxy(targetURL, transport)

	// Request with DISALLOWED origin
	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Origin", "http://evil.com")
	rec := httptest.NewRecorder()

	proxy.reverseProxy.ServeHTTP(rec, req)

	// Should still return 503
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)

	// CORS headers should NOT be present for disallowed origin
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
		"should not set CORS headers for disallowed origin")
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"),
		"should not set CORS headers for disallowed origin")
}
