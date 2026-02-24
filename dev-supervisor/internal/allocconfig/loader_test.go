package allocconfig //nolint:testpackage // Tests need access to unexported fields (loader.path)

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewLoader(t *testing.T) {
	t.Run("default path when empty", func(t *testing.T) {
		loader := NewLoader("")
		if loader.path != DefaultAllocConfigPath {
			t.Errorf("got path %q, want %q", loader.path, DefaultAllocConfigPath)
		}
	})

	t.Run("custom path when provided", func(t *testing.T) {
		customPath := "/custom/config.json"
		loader := NewLoader(customPath)
		if loader.path != customPath {
			t.Errorf("got path %q, want %q", loader.path, customPath)
		}
	})
}

func TestLoader_Load(t *testing.T) {
	t.Run("load valid config with DATABASE only", func(t *testing.T) {
		// Create temp file with DATABASE config
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")

		configData := map[string]any{
			"DATABASE": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE": map[string]any{
					"NAME":     "testdb",
					"HOST":     "mysql.example.com",
					"IP":       "10.0.0.1",
					"PORT":     3306,
					"USERNAME": "dbuser",
					"PASSWORD": "secret",
					"VARIANT":  "preview",
				},
			},
		}

		writeTestConfig(t, configPath, configData)

		loader := NewLoader(configPath)
		config, err := loader.Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}

		if config.Database == nil {
			t.Fatal("DATABASE is nil")
		}
		if !config.Database.SystemManaged {
			t.Error("DATABASE.SYSTEM_MANAGED should be true")
		}
		if config.Database.Value.Name != "testdb" {
			t.Errorf("DATABASE.VALUE.NAME = %q, want %q", config.Database.Value.Name, "testdb")
		}
		if config.Database.Value.Port != 3306 {
			t.Errorf("DATABASE.VALUE.PORT = %d, want %d", config.Database.Value.Port, 3306)
		}
	})

	t.Run("load valid config with DATABASE and JWT_REDIRECT_URL", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")

		configData := map[string]any{
			"DATABASE": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE": map[string]any{
					"NAME":     "testdb",
					"HOST":     "mysql.example.com",
					"IP":       "10.0.0.1",
					"PORT":     3306,
					"USERNAME": "dbuser",
					"PASSWORD": "secret",
					"VARIANT":  "preview",
				},
			},
			"JWT_REDIRECT_URL": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE":          "https://airo-builder.test-godaddy.com/develop/abc123?siteId=abc123",
			},
		}

		writeTestConfig(t, configPath, configData)

		loader := NewLoader(configPath)
		config, err := loader.Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}

		if config.Database == nil {
			t.Fatal("DATABASE is nil")
		}
		if config.JWTRedirectURL == nil {
			t.Fatal("JWT_REDIRECT_URL is nil")
		}
		if !config.JWTRedirectURL.SystemManaged {
			t.Error("JWT_REDIRECT_URL.SYSTEM_MANAGED should be true")
		}
		expectedURL := "https://airo-builder.test-godaddy.com/develop/abc123?siteId=abc123"
		if config.JWTRedirectURL.Value != expectedURL {
			t.Errorf("JWT_REDIRECT_URL.VALUE = %q, want %q", config.JWTRedirectURL.Value, expectedURL)
		}
	})

	t.Run("missing file returns error", func(t *testing.T) {
		loader := NewLoader("/nonexistent/config.json")
		_, err := loader.Load()
		if err == nil {
			t.Fatal("Load() should return error for missing file")
		}
	})

	t.Run("invalid JSON returns error", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")

		if err := os.WriteFile(configPath, []byte("{invalid json}"), 0600); err != nil {
			t.Fatalf("failed to write test file: %v", err)
		}

		loader := NewLoader(configPath)
		_, err := loader.Load()
		if err == nil {
			t.Fatal("Load() should return error for invalid JSON")
		}
	})

	t.Run("empty file returns empty config", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")

		if err := os.WriteFile(configPath, []byte("{}"), 0600); err != nil {
			t.Fatalf("failed to write test file: %v", err)
		}

		loader := NewLoader(configPath)
		config, err := loader.Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}

		if config.Database != nil {
			t.Error("DATABASE should be nil for empty config")
		}
		if config.JWTRedirectURL != nil {
			t.Error("JWT_REDIRECT_URL should be nil for empty config")
		}
	})
}

func TestConfig_GetDatabaseConfig(t *testing.T) {
	t.Run("returns database config when present", func(t *testing.T) {
		config := &Config{
			Database: &Secret[DatabaseConfig]{
				SystemManaged: true,
				Value: DatabaseConfig{
					Name:     "testdb",
					Host:     "mysql.example.com",
					IP:       "10.0.0.1",
					Port:     3306,
					Username: "dbuser",
					Password: "secret",
					Variant:  "preview",
				},
			},
		}

		dbConfig, err := config.GetDatabaseConfig()
		if err != nil {
			t.Fatalf("GetDatabaseConfig() error = %v", err)
		}

		if dbConfig.Name != "testdb" {
			t.Errorf("Name = %q, want %q", dbConfig.Name, "testdb")
		}
		if dbConfig.Port != 3306 {
			t.Errorf("Port = %d, want %d", dbConfig.Port, 3306)
		}
	})

	t.Run("returns error when DATABASE is nil", func(t *testing.T) {
		config := &Config{}

		_, err := config.GetDatabaseConfig()
		if err == nil {
			t.Fatal("GetDatabaseConfig() should return error when DATABASE is nil")
		}
	})
}

func TestConfig_GetJWTRedirectURL(t *testing.T) {
	t.Run("returns URL when present", func(t *testing.T) {
		expectedURL := "https://airo-builder.test-godaddy.com/develop/abc123?siteId=abc123"
		config := &Config{
			JWTRedirectURL: &Secret[string]{
				SystemManaged: true,
				Value:         expectedURL,
			},
		}

		url := config.GetJWTRedirectURL()
		if url != expectedURL {
			t.Errorf("GetJWTRedirectURL() = %q, want %q", url, expectedURL)
		}
	})

	t.Run("returns empty string when nil", func(t *testing.T) {
		config := &Config{}

		url := config.GetJWTRedirectURL()
		if url != "" {
			t.Errorf("GetJWTRedirectURL() = %q, want empty string", url)
		}
	})
}

func TestConfig_HasDatabase(t *testing.T) {
	t.Run("returns true when DATABASE present", func(t *testing.T) {
		config := &Config{
			Database: &Secret[DatabaseConfig]{
				SystemManaged: true,
				Value:         DatabaseConfig{Name: "testdb"},
			},
		}

		if !config.HasDatabase() {
			t.Error("HasDatabase() = false, want true")
		}
	})

	t.Run("returns false when DATABASE is nil", func(t *testing.T) {
		config := &Config{}

		if config.HasDatabase() {
			t.Error("HasDatabase() = true, want false")
		}
	})
}

func TestConfig_HasJWTRedirectURL(t *testing.T) {
	t.Run("returns true when JWT_REDIRECT_URL present and non-empty", func(t *testing.T) {
		config := &Config{
			JWTRedirectURL: &Secret[string]{
				SystemManaged: true,
				Value:         "https://example.com/redirect",
			},
		}

		if !config.HasJWTRedirectURL() {
			t.Error("HasJWTRedirectURL() = false, want true")
		}
	})

	t.Run("returns false when JWT_REDIRECT_URL is nil", func(t *testing.T) {
		config := &Config{}

		if config.HasJWTRedirectURL() {
			t.Error("HasJWTRedirectURL() = true, want false")
		}
	})

	t.Run("returns false when JWT_REDIRECT_URL is empty string", func(t *testing.T) {
		config := &Config{
			JWTRedirectURL: &Secret[string]{
				SystemManaged: true,
				Value:         "",
			},
		}

		if config.HasJWTRedirectURL() {
			t.Error("HasJWTRedirectURL() = true, want false")
		}
	})
}

func TestLoader_CacheHit(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	configData := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE": map[string]any{
				"NAME": "testdb",
				"HOST": "mysql.example.com",
				"IP":   "10.0.0.1",
				"PORT": 3306,
			},
		},
	}
	writeTestConfig(t, configPath, configData)

	// Create loader with 1 minute TTL (long enough for this test)
	loader := NewLoaderWithTTL(configPath, 1*time.Minute)

	// First load - cache miss, reads from file
	config1, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	// Second load - cache hit, should return cached value
	config2, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	// Verify both configs have same data
	if config1.Database.Value.Name != config2.Database.Value.Name {
		t.Errorf("cache hit returned different data")
	}

	// Verify second load returned a copy (different pointer)
	if config1 == config2 {
		t.Error("cache should return copies, not same pointer")
	}
}

func TestLoader_CacheExpiry(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	configData := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE": map[string]any{
				"NAME": "testdb",
			},
		},
	}
	writeTestConfig(t, configPath, configData)

	// Create loader with very short TTL
	loader := NewLoaderWithTTL(configPath, 50*time.Millisecond)

	// First load
	_, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	// Wait for cache to expire
	time.Sleep(100 * time.Millisecond)

	// Update file with new data
	configData["DATABASE"].(map[string]any)["VALUE"].(map[string]any)["NAME"] = "newdb"
	writeTestConfig(t, configPath, configData)

	// Load again - cache expired, should read new data
	config, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if config.Database.Value.Name != "newdb" {
		t.Errorf("cache expiry failed: got %q, want %q", config.Database.Value.Name, "newdb")
	}
}

func TestLoader_CopyPreventsMutation(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	configData := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE": map[string]any{
				"NAME": "testdb",
			},
		},
	}
	writeTestConfig(t, configPath, configData)

	loader := NewLoaderWithTTL(configPath, 1*time.Minute)

	// Load config
	config1, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	// Mutate returned config
	config1.Database.Value.Name = "mutated"

	// Load again - should return original cached value, not mutated
	config2, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if config2.Database.Value.Name != "testdb" {
		t.Errorf("cache mutation leaked: got %q, want %q", config2.Database.Value.Name, "testdb")
	}
}

func TestLoader_ConcurrentAccess(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	configData := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE": map[string]any{
				"NAME": "testdb",
			},
		},
	}
	writeTestConfig(t, configPath, configData)

	loader := NewLoaderWithTTL(configPath, 10*time.Millisecond)

	// Run multiple concurrent loads
	const numGoroutines = 10
	errors := make(chan error, numGoroutines)

	for range numGoroutines {
		go func() {
			config, err := loader.Load()
			if err != nil {
				errors <- err
				return
			}
			if config.Database.Value.Name != "testdb" {
				errors <- fmt.Errorf("unexpected name: %s", config.Database.Value.Name)
				return
			}
			errors <- nil
		}()
	}

	// Collect results
	for i := range numGoroutines {
		if err := <-errors; err != nil {
			t.Errorf("concurrent load %d failed: %v", i, err)
		}
	}
}

func TestLoader_NoCaching(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	configData := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE": map[string]any{
				"NAME": "testdb",
			},
		},
	}
	writeTestConfig(t, configPath, configData)

	// Create loader with TTL=0 (no caching)
	loader := NewLoaderWithTTL(configPath, 0)

	// First load
	_, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	// Update file
	configData["DATABASE"].(map[string]any)["VALUE"].(map[string]any)["NAME"] = "newdb"
	writeTestConfig(t, configPath, configData)

	// Load again - should read new data immediately (no cache)
	config, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if config.Database.Value.Name != "newdb" {
		t.Errorf("no-cache mode failed: got %q, want %q", config.Database.Value.Name, "newdb")
	}
}

func TestConfig_CopyNil(t *testing.T) {
	var config *Config
	result := config.Copy()
	if result != nil {
		t.Error("Copy() of nil config should return nil")
	}
}

// writeTestConfig is a helper that writes test config data to a file
func writeTestConfig(t *testing.T, path string, data map[string]any) {
	t.Helper()

	jsonData, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("failed to marshal test config: %v", err)
	}

	if err := os.WriteFile(path, jsonData, 0600); err != nil {
		t.Fatalf("failed to write test config: %v", err)
	}
}
