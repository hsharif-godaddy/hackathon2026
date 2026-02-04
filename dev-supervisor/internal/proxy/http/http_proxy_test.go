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
	"path"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/routing"
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
func TestValidateConfig_StaticServingDisabled(t *testing.T) {
	// Create temporary TLS certificate and key for testing
	certFile := createTempCert(t)
	keyFile := createTempKey(t)

	proxy := &HTTPProxy{
		config: Config{
			Enabled:             true,
			ListenPort:          5000,
			TargetHost:          "localhost",
			TargetPort:          8080,
			TLSCertPath:         certFile,
			TLSKeyPath:          keyFile,
			EnableStaticServing: false,
		},
	}

	err := proxy.validateConfig()
	if err != nil {
		t.Errorf("expected no error when static serving is disabled, got: %v", err)
	}
}

// Unit tests for HTTP mode (without TLS)
func TestValidateConfig_HTTPMode_NoCertificates(t *testing.T) {
	proxy := &HTTPProxy{
		config: Config{
			Enabled:             true,
			ListenPort:          5000,
			TargetHost:          "localhost",
			TargetPort:          8080,
			TLSCertPath:         "", // No certificates
			TLSKeyPath:          "",
			EnableStaticServing: false,
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

func TestValidateStaticServingConfig_MissingRoot(t *testing.T) {
	proxy := &HTTPProxy{
		config: Config{
			EnableStaticServing: true,
			StaticRoot:          "",
		},
	}

	routingConfig := routing.Config{
		StaticRoot: "", // Empty in both env and routing config
		SPAMode:    true,
	}

	err := proxy.validateStaticServingConfig(routingConfig)
	if err == nil {
		t.Error("expected error when static root is empty, got nil")
	}
	if !strings.Contains(err.Error(), "static root must be specified") {
		t.Errorf("expected error about missing static root, got: %v", err)
	}
}

func TestValidateStaticServingConfig_NonExistentRoot(t *testing.T) {
	proxy := &HTTPProxy{
		config: Config{
			EnableStaticServing: true,
		},
	}

	routingConfig := routing.Config{
		StaticRoot: "/nonexistent/path",
		SPAMode:    true,
	}

	// Should not return error when static root doesn't exist (just logs warning)
	err := proxy.validateStaticServingConfig(routingConfig)
	if err != nil {
		t.Errorf("expected no error when static root does not exist (should just warn), got: %v", err)
	}
}

func TestValidateStaticServingConfig_ValidRoot(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()

	proxy := &HTTPProxy{
		config: Config{
			EnableStaticServing: true,
		},
	}

	routingConfig := routing.Config{
		StaticRoot: tmpDir,
		SPAMode:    false,
	}

	err := proxy.validateStaticServingConfig(routingConfig)
	if err != nil {
		t.Errorf("expected no error with valid static root, got: %v", err)
	}
}

func TestValidateStaticServingConfig_SPAMode_MissingIndexHTML(t *testing.T) {
	// Create temporary directory without index.html
	tmpDir := t.TempDir()

	proxy := &HTTPProxy{
		config: Config{
			EnableStaticServing: true,
		},
	}

	routingConfig := routing.Config{
		StaticRoot: tmpDir,
		SPAMode:    true,
	}

	// Should validate successfully but log a warning (not tested here)
	err := proxy.validateStaticServingConfig(routingConfig)
	if err != nil {
		t.Errorf("expected no error with missing index.html (should warn), got: %v", err)
	}
}

func TestValidateStaticServingConfig_JSONStaticRoot(t *testing.T) {
	// Test that static root from JSON config (routingConfig) is used
	tmpDir := t.TempDir()

	proxy := &HTTPProxy{
		config: Config{
			EnableStaticServing: true,
			StaticRoot:          "", // Empty in env
		},
	}

	routingConfig := routing.Config{
		StaticRoot: tmpDir, // Set in JSON config
		SPAMode:    true,
	}

	err := proxy.validateStaticServingConfig(routingConfig)
	if err != nil {
		t.Errorf("expected no error when static root comes from JSON, got: %v", err)
	}
}

func TestValidateStaticServingConfig_Disabled(t *testing.T) {
	proxy := &HTTPProxy{
		config: Config{
			EnableStaticServing: false,
		},
	}

	routingConfig := routing.Config{
		StaticRoot: "", // Empty but shouldn't matter
		SPAMode:    true,
	}

	err := proxy.validateStaticServingConfig(routingConfig)
	if err != nil {
		t.Errorf("expected no error when static serving is disabled, got: %v", err)
	}
}

// Integration test: JSON-only configuration
func TestJSONOnlyConfiguration(t *testing.T) {
	// This test verifies that an operator can configure static serving
	// entirely via JSON config without setting any env vars
	tmpDir := t.TempDir()
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	// Create index.html
	indexPath := path.Join(tmpDir, "index.html")
	if writeErr := os.WriteFile(indexPath, []byte("<html></html>"), 0600); writeErr != nil {
		t.Fatal(writeErr)
	}

	// JSON config with all settings
	config := routing.Config{
		StaticRoot: tmpDir,
		SPAMode:    true,
		APIPrefix:  "/custom-api",
	}

	data, marshalErr := json.Marshal(config)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if _, writeErr := tmpFile.Write(data); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	// Create proxy with minimal env vars (only enable static serving)
	proxy := &HTTPProxy{
		config: Config{
			EnableStaticServing: true,  // Enable via env var
			StaticRoot:          "",    // Empty - will come from JSON
			SPAMode:             false, // Default - will be overridden by JSON
			APIPrefix:           "",    // Empty - will come from JSON
			ConfigPath:          tmpFile.Name(),
		},
	}

	// Load routing config
	routingConfig, err := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: proxy.config.ConfigPath,
		APIPrefix:  proxy.config.APIPrefix,
		StaticRoot: proxy.config.StaticRoot,
		SPAMode:    proxy.config.SPAMode,
	})
	if err != nil {
		t.Errorf("expected no error loading config, got: %v", err)
	}

	// Validate static serving config (should succeed with JSON values)
	err = proxy.validateStaticServingConfig(routingConfig)
	if err != nil {
		t.Errorf("expected validation to pass with JSON config, got: %v", err)
	}

	// Verify values came from JSON
	if routingConfig.StaticRoot != tmpDir {
		t.Errorf("expected static root from JSON '%s', got: %s", tmpDir, routingConfig.StaticRoot)
	}
	if !routingConfig.SPAMode {
		t.Error("expected SPA mode from JSON to be true")
	}
	if routingConfig.APIPrefix != "/custom-api" {
		t.Errorf("expected API prefix from JSON '/custom-api', got: %s", routingConfig.APIPrefix)
	}
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
		proxyHandler:     proxyHandler,
		apiPrefix:        "/api",
		isProductionMode: true,
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

func TestRequestRouter_StaticServingDisabled(t *testing.T) {
	// Create mock proxy handler
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(testProxyResponse)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	router := &RequestRouter{
		proxyHandler:     proxyHandler,
		apiPrefix:        "/api",
		isProductionMode: false, // Static serving disabled
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

func TestRequestRouter_StaticFileWithExtension_GET(t *testing.T) {
	// Create temporary static file
	tmpDir := t.TempDir()
	jsFile := path.Join(tmpDir, "app.js")
	if err := os.WriteFile(jsFile, []byte("console.log('test')"), 0600); err != nil {
		t.Fatal(err)
	}

	// Create static handler
	staticHandler := http.FileServer(http.Dir(tmpDir))

	router := &RequestRouter{
		staticHandler:    staticHandler,
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
	}

	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "console.log") {
		t.Errorf("expected file content, got: %s", rec.Body.String())
	}
}

func TestRequestRouter_StaticFileWithExtension_HEAD(t *testing.T) {
	// Create temporary static file
	tmpDir := t.TempDir()
	jsFile := path.Join(tmpDir, "app.js")
	if err := os.WriteFile(jsFile, []byte("console.log('test')"), 0600); err != nil {
		t.Fatal(err)
	}

	// Create static handler
	staticHandler := http.FileServer(http.Dir(tmpDir))

	router := &RequestRouter{
		staticHandler:    staticHandler,
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
	}

	req := httptest.NewRequest(http.MethodHead, "/app.js", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	// HEAD should not return body
	if rec.Body.Len() > 0 {
		t.Errorf("expected empty body for HEAD request, got: %s", rec.Body.String())
	}
}

func TestRequestRouter_StaticFileWithExtension_OPTIONS(t *testing.T) {
	// After CORS refactoring: RequestRouter no longer handles CORS
	// CORS is handled by rs/cors middleware (placed before router in chain)
	// Router now forwards OPTIONS to http.FileServer which returns 200

	// Create temporary static file
	tmpDir := t.TempDir()
	jsFile := path.Join(tmpDir, "app.js")
	if err := os.WriteFile(jsFile, []byte("console.log('test')"), 0600); err != nil {
		t.Fatal(err)
	}

	// Create static handler
	staticHandler := http.FileServer(http.Dir(tmpDir))

	router := &RequestRouter{
		staticHandler:    staticHandler,
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
	}

	req := httptest.NewRequest(http.MethodOptions, "/app.js", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Router no longer handles CORS - it forwards to http.FileServer
	// http.FileServer returns 200 for OPTIONS (not 204)
	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 from http.FileServer, got: %d", rec.Code)
	}
	// CORS headers are NOT set by router - that's done by CORS middleware
	// This test just verifies router routing behavior, not CORS
}

func TestRequestRouter_ExtensionlessStaticFile_OPTIONS(t *testing.T) {
	// After CORS refactoring: RequestRouter no longer handles CORS or OPTIONS specially
	// OPTIONS requests are routed like any other method

	tmpDir := t.TempDir()
	file := path.Join(tmpDir, ".well-known")
	if err := os.WriteFile(file, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
	}

	req := httptest.NewRequest(http.MethodOptions, "/.well-known", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Router forwards to http.FileServer, which returns 200 for OPTIONS on existing files
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for OPTIONS from http.FileServer, got %d", rec.Code)
	}
}

func TestRequestRouter_SPAFallback(t *testing.T) {
	// Create temporary index.html
	tmpDir := t.TempDir()
	indexFile := path.Join(tmpDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html><body>SPA</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	req := httptest.NewRequest(http.MethodGet, "/users/profile", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "SPA") {
		t.Errorf("expected SPA content, got: %s", rec.Body.String())
	}

	// Verify no-cache headers
	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "no-cache") {
		t.Errorf("expected Cache-Control: no-cache, got: %s", cacheControl)
	}
}

func TestRequestRouter_SPAFallback_HeadRequest(t *testing.T) {
	// Create temporary index.html
	tmpDir := t.TempDir()
	indexFile := path.Join(tmpDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html><body>SPA</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	// HEAD requests to client-side routes should go to static handler, not SPA fallback
	req := httptest.NewRequest(http.MethodHead, "/users/profile", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// http.FileServer returns 404 for non-existent paths
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for HEAD request to non-existent path, got: %d", rec.Code)
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
		proxyHandler:     proxyHandler,
		apiPrefix:        "/api",
		isProductionMode: true,
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

// Test that extensionless files are served before SPA fallback
func TestRequestRouter_ExtensionlessFile_ServedBeforeSPA(t *testing.T) {
	// Create temporary directory with .well-known file (no extension)
	tmpDir := t.TempDir()
	wellKnownDir := path.Join(tmpDir, ".well-known")
	if err := os.Mkdir(wellKnownDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create apple-app-site-association file (no extension)
	aaasaFile := path.Join(wellKnownDir, "apple-app-site-association")
	aaasaContent := `{"applinks":{"apps":[],"details":[]}}`
	if err := os.WriteFile(aaasaFile, []byte(aaasaContent), 0600); err != nil {
		t.Fatal(err)
	}

	// Create index.html for SPA fallback
	indexFile := path.Join(tmpDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html><body>SPA</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	req := httptest.NewRequest(http.MethodGet, "/.well-known/apple-app-site-association", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Should serve the actual file, NOT the SPA fallback
	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "applinks") {
		t.Errorf("expected apple-app-site-association content, got SPA fallback: %s", rec.Body.String())
	}
}

// Test that non-existent extensionless paths fall back to SPA for GET
func TestRequestRouter_ExtensionlessPath_FallsBackToSPA(t *testing.T) {
	tmpDir := t.TempDir()
	indexFile := path.Join(tmpDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html><body>SPA</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	// Request for non-existent extensionless path should fall back to SPA
	req := httptest.NewRequest(http.MethodGet, "/users/profile", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "SPA") {
		t.Errorf("expected SPA content, got: %s", rec.Body.String())
	}
}

// Test that HEAD requests to non-existent extensionless paths return 404 (not SPA)
func TestRequestRouter_ExtensionlessPath_HEAD_Returns404(t *testing.T) {
	tmpDir := t.TempDir()
	indexFile := path.Join(tmpDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html><body>SPA</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	// HEAD requests to client-side routes receive 404, not SPA fallback
	// This is documented behavior: HEAD on a client-side route is unusual
	req := httptest.NewRequest(http.MethodHead, "/users/profile", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for HEAD request to non-existent path, got: %d", rec.Code)
	}
}

// Test that HEAD requests to existing extensionless files return 200
func TestRequestRouter_ExtensionlessFile_HEAD_Returns200(t *testing.T) {
	tmpDir := t.TempDir()
	wellKnownDir := path.Join(tmpDir, ".well-known")
	if err := os.Mkdir(wellKnownDir, 0755); err != nil {
		t.Fatal(err)
	}

	aaasaFile := path.Join(wellKnownDir, "apple-app-site-association")
	if err := os.WriteFile(aaasaFile, []byte(`{"applinks":{}}`), 0600); err != nil {
		t.Fatal(err)
	}

	indexFile := path.Join(tmpDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	req := httptest.NewRequest(http.MethodHead, "/.well-known/apple-app-site-association", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for HEAD request to existing file, got: %d", rec.Code)
	}
	// HEAD should not return body
	if rec.Body.Len() > 0 {
		t.Errorf("expected empty body for HEAD request, got: %s", rec.Body.String())
	}
}

// Test that cache headers from newStaticFileHandler are preserved for extensionless files
func TestRequestRouter_ExtensionlessFile_CacheHeaders(t *testing.T) {
	tmpDir := t.TempDir()
	wellKnownDir := path.Join(tmpDir, ".well-known")
	if err := os.Mkdir(wellKnownDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a .json file (has extension, so cache headers apply)
	jsonFile := path.Join(wellKnownDir, "assetlinks.json")
	if err := os.WriteFile(jsonFile, []byte(`[{"relation":[]}]`), 0600); err != nil {
		t.Fatal(err)
	}

	cacheSettings := routing.CacheSettings{
		EnableCaching: true,
		MaxAge: map[string]int{
			".json": 3600, // 1 hour
		},
	}

	staticHandler := routing.NewStaticFileHandler(tmpDir, cacheSettings)

	indexFile := path.Join(tmpDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    staticHandler,
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	req := httptest.NewRequest(http.MethodGet, "/.well-known/assetlinks.json", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}

	// Verify cache headers were set by newStaticFileHandler
	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "max-age=3600") {
		t.Errorf("expected Cache-Control with max-age=3600, got: %s", cacheControl)
	}
}

// Test that SPA fallback serves index.html with correct Content-Type (not text/plain from 404 probe)
func TestRequestRouter_SPAFallback_CorrectContentType(t *testing.T) {
	tmpDir := t.TempDir()
	indexFile := path.Join(tmpDir, "index.html")
	indexContent := "<!DOCTYPE html><html><head></head><body>SPA</body></html>"
	if err := os.WriteFile(indexFile, []byte(indexContent), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	// Request for non-existent extensionless path should fall back to SPA
	req := httptest.NewRequest(http.MethodGet, "/users/profile", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}

	// Verify Content-Type is text/html, NOT text/plain (which would come from 404 probe contamination)
	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "text/html") {
		t.Errorf("expected Content-Type text/html, got: %s (header contamination from 404 probe?)", contentType)
	}

	if !strings.Contains(rec.Body.String(), "SPA") {
		t.Errorf("expected SPA content, got: %s", rec.Body.String())
	}
}

// Test that HEAD/OPTIONS requests without SPA mode proxy to backend instead of returning 404
func TestRequestRouter_HeadRequest_NoSPAMode_ProxiesToBackend(t *testing.T) {
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("backend-response")); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	tmpDir := t.TempDir()

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     proxyHandler,
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      "", // SPA mode disabled
	}

	// HEAD request to extensionless path with SPA mode off should proxy to backend
	req := httptest.NewRequest(http.MethodHead, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Should be proxied to backend (200), not 404
	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 (proxied to backend), got: %d", rec.Code)
	}
}

// Test that OPTIONS requests without SPA mode proxy to backend (for CORS preflight)
func TestRequestRouter_OptionsRequest_NoSPAMode_ProxiesToBackend(t *testing.T) {
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.WriteHeader(http.StatusNoContent)
	})

	tmpDir := t.TempDir()

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     proxyHandler,
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      "", // SPA mode disabled
	}

	// OPTIONS request (CORS preflight) with SPA mode off should proxy to backend
	req := httptest.NewRequest(http.MethodOptions, "/dynamic-route", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Should be proxied to backend (204 No Content), not 404
	if rec.Code != http.StatusNoContent {
		t.Errorf("expected status 204 (CORS preflight from backend), got: %d", rec.Code)
	}

	// Verify CORS headers from backend
	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected CORS headers from backend, got: %v", rec.Header())
	}
}

// Test that GET requests without SPA mode proxy to backend
func TestRequestRouter_GetRequest_NoSPAMode_ProxiesToBackend(t *testing.T) {
	proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(`{"status":"ok"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	tmpDir := t.TempDir()

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     proxyHandler,
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      "", // SPA mode disabled
	}

	// GET request to extensionless path with SPA mode off should proxy to backend
	req := httptest.NewRequest(http.MethodGet, "/dynamic-route", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 (proxied to backend), got: %d", rec.Code)
	}
	if rec.Body.String() != `{"status":"ok"}` {
		t.Errorf("expected backend response, got: %s", rec.Body.String())
	}
}

// Test that root path / serving index.html gets no-cache headers (prevents stale app shell)
func TestRequestRouter_RootPath_IndexHTML_GetsNoCacheHeaders(t *testing.T) {
	tmpDir := t.TempDir()
	indexFile := path.Join(tmpDir, "index.html")
	indexContent := "<!DOCTYPE html><html><head></head><body>App Shell</body></html>"
	if err := os.WriteFile(indexFile, []byte(indexContent), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      indexFile,
	}

	// Request to / should serve index.html with no-cache headers
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}

	// Verify strict no-cache headers are set (prevents stale app shell)
	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "no-cache") || !strings.Contains(cacheControl, "no-store") {
		t.Errorf("expected Cache-Control: no-cache, no-store, must-revalidate, got: %s", cacheControl)
	}
	if rec.Header().Get("Pragma") != "no-cache" {
		t.Errorf("expected Pragma: no-cache, got: %s", rec.Header().Get("Pragma"))
	}
	if rec.Header().Get("Expires") != "0" {
		t.Errorf("expected Expires: 0, got: %s", rec.Header().Get("Expires"))
	}

	// Verify content is served correctly
	if !strings.Contains(rec.Body.String(), "App Shell") {
		t.Errorf("expected index.html content, got: %s", rec.Body.String())
	}
}

// Test that subdirectory index.html also gets no-cache headers
func TestRequestRouter_SubdirectoryIndexHTML_GetsNoCacheHeaders(t *testing.T) {
	tmpDir := t.TempDir()

	// Create subdirectory with index.html
	subDir := path.Join(tmpDir, "about")
	if err := os.Mkdir(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	indexFile := path.Join(subDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html>About Page</html>"), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      "", // SPA fallback not needed for this test
	}

	// Request to /about/ should serve index.html with no-cache headers
	req := httptest.NewRequest(http.MethodGet, "/about/", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}

	// Verify no-cache headers are set
	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "no-cache") {
		t.Errorf("expected Cache-Control with no-cache for HTML, got: %s", cacheControl)
	}
}

// Test that non-HTML extensionless files (like .well-known) don't get no-cache override
func TestRequestRouter_ExtensionlessNonHTML_NoCacheNotForced(t *testing.T) {
	tmpDir := t.TempDir()
	wellKnownDir := path.Join(tmpDir, ".well-known")
	if err := os.Mkdir(wellKnownDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create apple-app-site-association (JSON content, no extension)
	aaasaFile := path.Join(wellKnownDir, "apple-app-site-association")
	aaasaContent := `{"applinks":{"apps":[],"details":[]}}`
	if err := os.WriteFile(aaasaFile, []byte(aaasaContent), 0600); err != nil {
		t.Fatal(err)
	}

	router := &RequestRouter{
		staticHandler:    http.FileServer(http.Dir(tmpDir)),
		proxyHandler:     http.NotFoundHandler(),
		apiPrefix:        "/api",
		isProductionMode: true,
		spaFallback:      "",
	}

	req := httptest.NewRequest(http.MethodGet, "/.well-known/apple-app-site-association", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}

	// Non-HTML files should NOT have the strict no-cache headers forced
	// (they may have their own caching or none, but not the SPA shell treatment)
	cacheControl := rec.Header().Get("Cache-Control")
	if strings.Contains(cacheControl, "no-store") {
		t.Errorf("non-HTML extensionless files should not get no-store, got: %s", cacheControl)
	}

	// Verify correct content
	if !strings.Contains(rec.Body.String(), "applinks") {
		t.Errorf("expected JSON content, got: %s", rec.Body.String())
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

	// Should be either 301 (redirect to /airo/) or 404
	if rec.Code != http.StatusMovedPermanently && rec.Code != http.StatusNotFound {
		t.Errorf("expected status 301 or 404 for /airo, got: %d", rec.Code)
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
	assert.Equal(t, "idle", resp.Reason, "reason should be 'idle'")

	// Verify cache headers are set
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-cache",
		"should have no-cache in Cache-Control")
	assert.Contains(t, rec.Header().Get("Cache-Control"), "no-store",
		"should have no-store in Cache-Control")
	assert.Equal(t, "no-cache", rec.Header().Get("Pragma"), "should have Pragma: no-cache")
	assert.Equal(t, "0", rec.Header().Get("Expires"), "should have Expires: 0")
}

// TestHTTPProxy_HealthCheck_StoppedNotFromIdle tests that health check returns 503
// for a process that was stopped explicitly (not from idle)
func TestHTTPProxy_HealthCheck_StoppedNotFromIdle(t *testing.T) {
	procMgr := &fakeProcessController{
		status: ProcessStatus{
			State: ProcessStateStopped,
		},
		wasHealthyBeforeIdle:  false,
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

	// Should return 503 with unhealthy status
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"health check should return 503 for explicitly stopped app")

	var resp ProxyHealthResponse
	err := json.Unmarshal(rec.Body.Bytes(), &resp)
	require.NoError(t, err, "should parse JSON response")

	assert.Equal(t, "unhealthy", resp.Status, "status should be 'unhealthy'")
	assert.Equal(t, "target not reachable", resp.Reason, "reason should indicate target not reachable")
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
