package routing_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/routing"
)

// Unit tests for LoadConfig()
func TestLoadConfig_Defaults(t *testing.T) {
	config, err := routing.LoadConfig(routing.LoadOptions{
		SPAMode: true, // Match default from env var handling in main.go
	})
	if err != nil {
		t.Errorf("expected no error with default config, got: %v", err)
	}

	if config.APIPrefix != "/api" {
		t.Errorf("expected default API prefix '/api', got: %s", config.APIPrefix)
	}
	if !config.SPAMode {
		t.Error("expected SPAMode to be true by default")
	}
	if !config.CacheControl.EnableCaching {
		t.Error("expected caching to be enabled by default")
	}
}

func TestLoadConfig_NonExistentFile(t *testing.T) {
	_, err := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: "/nonexistent/config.json",
		SPAMode:    true,
	})
	if err == nil {
		t.Error("expected error when config file does not exist, got nil")
	}
	if !strings.Contains(err.Error(), "routing config file not found") {
		t.Errorf("expected error about missing file, got: %v", err)
	}
}

func TestLoadConfig_MalformedJSON(t *testing.T) {
	// Create temporary file with malformed JSON
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	if _, writeErr := tmpFile.WriteString("{ invalid json }"); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	_, loadErr := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: tmpFile.Name(),
		SPAMode:    true,
	})
	if loadErr == nil {
		t.Error("expected error when JSON is malformed, got nil")
	}
	if !strings.Contains(loadErr.Error(), "failed to parse routing config JSON") {
		t.Errorf("expected error about malformed JSON, got: %v", loadErr)
	}
}

func TestLoadConfig_ValidJSON(t *testing.T) {
	// Create temporary file with valid JSON
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	config := routing.Config{
		StaticRoot: "/custom/root",
		SPAMode:    false,
		APIPrefix:  "/custom-api",
		CacheControl: routing.CacheSettings{
			EnableCaching: true,
			MaxAge: map[string]int{
				".js": 3600,
			},
		},
	}

	data, marshalErr := json.Marshal(config)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if _, writeErr := tmpFile.Write(data); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, err := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: tmpFile.Name(),
		SPAMode:    true,
	})
	if err != nil {
		t.Errorf("expected no error with valid JSON, got: %v", err)
	}
	if loaded.StaticRoot != "/custom/root" {
		t.Errorf("expected static root '/custom/root', got: %s", loaded.StaticRoot)
	}
	if loaded.SPAMode {
		t.Error("expected SPAMode to be false")
	}
	if loaded.APIPrefix != "/custom-api" {
		t.Errorf("expected API prefix '/custom-api', got: %s", loaded.APIPrefix)
	}
}

func TestLoadConfig_EnvVarAPIPrefix(t *testing.T) {
	loaded, err := routing.LoadConfig(routing.LoadOptions{
		APIPrefix: "/custom-env-api",
		SPAMode:   true,
	})
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
	if loaded.APIPrefix != "/custom-env-api" {
		t.Errorf("expected API prefix from env var '/custom-env-api', got: %s", loaded.APIPrefix)
	}
}

func TestLoadConfig_EnvVarStaticRoot(t *testing.T) {
	loaded, err := routing.LoadConfig(routing.LoadOptions{
		StaticRoot: "/env/static",
		SPAMode:    true,
	})
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
	if loaded.StaticRoot != "/env/static" {
		t.Errorf("expected static root from env var '/env/static', got: %s", loaded.StaticRoot)
	}
}

func TestLoadConfig_EnvVarSPAMode(t *testing.T) {
	loaded, err := routing.LoadConfig(routing.LoadOptions{
		SPAMode: false,
	})
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
	if loaded.SPAMode {
		t.Error("expected SPAMode from env var to be false")
	}
}

func TestLoadConfig_JSONOverridesEnvVar(t *testing.T) {
	// Create temporary file with JSON config
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	config := routing.Config{
		APIPrefix:  "/json-api",
		StaticRoot: "/json/static",
		SPAMode:    false,
	}

	data, marshalErr := json.Marshal(config)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if _, writeErr := tmpFile.Write(data); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, err := routing.LoadConfig(routing.LoadOptions{
		APIPrefix:  "/env-api",
		StaticRoot: "/env/static",
		SPAMode:    true,
		ConfigPath: tmpFile.Name(),
	})
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
	// JSON config should override env vars
	if loaded.APIPrefix != "/json-api" {
		t.Errorf("expected JSON to override env var '/json-api', got: %s", loaded.APIPrefix)
	}
	if loaded.StaticRoot != "/json/static" {
		t.Errorf("expected JSON to override env var '/json/static', got: %s", loaded.StaticRoot)
	}
	if loaded.SPAMode {
		t.Error("expected JSON to override env var SPAMode to false")
	}
}

func TestLoadConfig_ForwardRulesWarning(t *testing.T) {
	// Create temporary file with forward rules
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	config := routing.Config{
		ForwardRules: []routing.ForwardRule{
			{PathPattern: "/test", TargetURL: "http://example.com"},
		},
	}

	data, marshalErr := json.Marshal(config)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if _, writeErr := tmpFile.Write(data); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, err := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: tmpFile.Name(),
		SPAMode:    true,
	})
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
	if len(loaded.ForwardRules) != 1 {
		t.Errorf("expected 1 forward rule, got: %d", len(loaded.ForwardRules))
	}
	// Note: The warning is logged but we can't test it easily without capturing logs
}

func TestLoadConfig_SPAModeOmittedInJSON(t *testing.T) {
	// Test that omitting spa_mode in JSON preserves the env var value
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	// JSON with only cache settings, spa_mode omitted
	jsonContent := `{
		"cache_control": {
			"enable_caching": true,
			"max_age": {
				".js": 3600
			}
		}
	}`
	if _, writeErr := tmpFile.WriteString(jsonContent); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, loadErr := routing.LoadConfig(routing.LoadOptions{
		SPAMode:    true,
		ConfigPath: tmpFile.Name(),
	})
	if loadErr != nil {
		t.Errorf("expected no error, got: %v", loadErr)
	}

	// SPAMode should still be true (from env var), not overwritten to false
	if !loaded.SPAMode {
		t.Error("expected SPAMode to remain true when omitted from JSON")
	}
}

func TestLoadConfig_SPAModeExplicitlyFalseInJSON(t *testing.T) {
	// Test that explicitly setting spa_mode: false in JSON overrides env var
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	jsonContent := `{
		"spa_mode": false
	}`
	if _, writeErr := tmpFile.WriteString(jsonContent); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, loadErr := routing.LoadConfig(routing.LoadOptions{
		SPAMode:    true,
		ConfigPath: tmpFile.Name(),
	})
	if loadErr != nil {
		t.Errorf("expected no error, got: %v", loadErr)
	}

	// SPAMode should be false (from JSON), overriding env var
	if loaded.SPAMode {
		t.Error("expected SPAMode to be false when explicitly set in JSON")
	}
}

func TestLoadConfig_DisableCachingWithoutMaxAge(t *testing.T) {
	// Test that enable_caching: false works without providing max_age
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	jsonContent := `{
		"cache_control": {
			"enable_caching": false
		}
	}`
	if _, writeErr := tmpFile.WriteString(jsonContent); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, loadErr := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: tmpFile.Name(),
		SPAMode:    true,
	})
	if loadErr != nil {
		t.Errorf("expected no error, got: %v", loadErr)
	}

	// EnableCaching should be false
	if loaded.CacheControl.EnableCaching {
		t.Error("expected EnableCaching to be false when set in JSON")
	}

	// MaxAge should still have defaults
	if loaded.CacheControl.MaxAge[".js"] != 31536000 {
		t.Errorf("expected default max_age for .js to be preserved, got: %d", loaded.CacheControl.MaxAge[".js"])
	}
}

func TestLoadConfig_EnableCachingWithCustomMaxAge(t *testing.T) {
	// Test that both enable_caching and max_age can be set together
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	jsonContent := `{
		"cache_control": {
			"enable_caching": false,
			"max_age": {
				".js": 3600
			}
		}
	}`
	if _, writeErr := tmpFile.WriteString(jsonContent); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, loadErr := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: tmpFile.Name(),
		SPAMode:    true,
	})
	if loadErr != nil {
		t.Errorf("expected no error, got: %v", loadErr)
	}

	// EnableCaching should be false
	if loaded.CacheControl.EnableCaching {
		t.Error("expected EnableCaching to be false")
	}

	// MaxAge should be from JSON
	if loaded.CacheControl.MaxAge[".js"] != 3600 {
		t.Errorf("expected max_age for .js to be 3600, got: %d", loaded.CacheControl.MaxAge[".js"])
	}
}

func TestLoadConfig_EmptyCacheControlPreservesDefaults(t *testing.T) {
	// Test that an empty cache_control object {} doesn't overwrite defaults
	// This verifies the fix for the boolean zero-value issue
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	// JSON with empty cache_control object
	jsonContent := `{
		"cache_control": {}
	}`
	if _, writeErr := tmpFile.WriteString(jsonContent); writeErr != nil {
		t.Fatal(writeErr)
	}
	tmpFile.Close()

	loaded, loadErr := routing.LoadConfig(routing.LoadOptions{
		ConfigPath: tmpFile.Name(),
		SPAMode:    true,
	})
	if loadErr != nil {
		t.Errorf("expected no error, got: %v", loadErr)
	}

	// EnableCaching should remain true (the default)
	if !loaded.CacheControl.EnableCaching {
		t.Error("expected EnableCaching to remain true (default), but got false")
	}

	// MaxAge should have default values
	if loaded.CacheControl.MaxAge == nil {
		t.Error("expected MaxAge to have default values")
	}
}

// Unit tests for static file handler with cache control
func TestStaticFileHandler_CacheHeaders(t *testing.T) {
	// Create temporary directory with test files in a subdirectory
	// This avoids issues with FileServer and directory listings
	tmpDir := t.TempDir()
	staticDir := path.Join(tmpDir, "static")
	if err := os.Mkdir(staticDir, 0755); err != nil {
		t.Fatal(err)
	}

	jsFile := path.Join(staticDir, "app.js")
	htmlFile := path.Join(
		staticDir,
		"page.html",
	) // Use "page.html" instead of "index.html" to avoid FileServer redirect

	if err := os.WriteFile(jsFile, []byte("console.log('test')"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(htmlFile, []byte("<html></html>"), 0600); err != nil {
		t.Fatal(err)
	}

	cacheSettings := routing.CacheSettings{
		EnableCaching: true,
		MaxAge: map[string]int{
			".js":   31536000, // 1 year
			".html": 0,        // No cache
		},
	}

	handler := routing.NewStaticFileHandler(staticDir, cacheSettings)

	// Test .js file (should have long cache)
	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for .js file, got: %d", rec.Code)
	}
	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "max-age=31536000") {
		t.Errorf("expected Cache-Control with max-age=31536000, got: %s", cacheControl)
	}

	// Verify Vary header is set for CDN caching
	vary := rec.Header().Get("Vary")
	if vary != "Accept-Encoding" {
		t.Errorf("expected Vary: Accept-Encoding, got: %s", vary)
	}

	// Test .html file (should have no cache)
	// Note: Using "page.html" instead of "index.html" because FileServer redirects index.html to ./
	req = httptest.NewRequest(http.MethodGet, "/page.html", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for .html file, got: %d", rec.Code)
	}
	cacheControl = rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "max-age=0") {
		t.Errorf("expected Cache-Control with max-age=0, got: %s", cacheControl)
	}
}

func TestStaticFileHandler_CachingDisabled(t *testing.T) {
	// Create temporary directory with test file
	tmpDir := t.TempDir()
	jsFile := path.Join(tmpDir, "app.js")

	if err := os.WriteFile(jsFile, []byte("console.log('test')"), 0600); err != nil {
		t.Fatal(err)
	}

	cacheSettings := routing.CacheSettings{
		EnableCaching: false,
	}

	handler := routing.NewStaticFileHandler(tmpDir, cacheSettings)

	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got: %d", rec.Code)
	}

	// Should not have Cache-Control header when caching is disabled
	cacheControl := rec.Header().Get("Cache-Control")
	if strings.Contains(cacheControl, "max-age") {
		t.Errorf("expected no cache headers when caching disabled, got: %s", cacheControl)
	}
}
