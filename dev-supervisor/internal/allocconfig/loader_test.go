package allocconfig //nolint:testpackage // Tests need access to unexported fields (loader.path)

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestDefault(t *testing.T) {
	t.Run("returns same instance across calls", func(t *testing.T) {
		a := Default()
		b := Default()
		if a != b {
			t.Error("Default() returned different pointers")
		}
	})

	t.Run("returns same instance across goroutines", func(t *testing.T) {
		const n = 50
		loaders := make([]*Loader, n)
		var wg sync.WaitGroup
		wg.Add(n)
		for i := range n {
			go func() {
				defer wg.Done()
				loaders[i] = Default()
			}()
		}
		wg.Wait()

		for i := 1; i < n; i++ {
			if loaders[i] != loaders[0] {
				t.Fatalf("goroutine %d got different pointer than goroutine 0", i)
			}
		}
	})
}

func TestNewLoader(t *testing.T) {
	t.Run("default path when empty and NOMAD_ALLOC_DIR unset", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "")
		loader := NewLoader("")
		want := "/alloc/config.json"
		if loader.path != want {
			t.Errorf("got path %q, want %q", loader.path, want)
		}
	})

	t.Run("uses NOMAD_ALLOC_DIR when set", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/nomad/alloc/abc123")
		loader := NewLoader("")
		want := "/nomad/alloc/abc123/config.json"
		if loader.path != want {
			t.Errorf("got path %q, want %q", loader.path, want)
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

func TestDefaultAllocConfigPath(t *testing.T) {
	t.Run("returns /alloc/config.json when NOMAD_ALLOC_DIR unset", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "")
		got := defaultAllocConfigPath()
		want := "/alloc/config.json"
		if got != want {
			t.Errorf("defaultAllocConfigPath() = %q, want %q", got, want)
		}
	})

	t.Run("uses NOMAD_ALLOC_DIR when set", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/nomad/alloc/abc123")
		got := defaultAllocConfigPath()
		want := "/nomad/alloc/abc123/config.json"
		if got != want {
			t.Errorf("defaultAllocConfigPath() = %q, want %q", got, want)
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

	t.Run("load config with CustomerEnv (SYSTEM_MANAGED=false)", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")
		configData := map[string]any{
			"ENV1": map[string]any{
				"SYSTEM_MANAGED": false,
				"VALUE":          "value1",
			},
			"ENV2": map[string]any{
				"SYSTEM_MANAGED": false,
				"VALUE":          "value2",
			},
			"SKIP_TRUE": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE":          "system",
			},
			"_PRIVATE": map[string]any{
				"SYSTEM_MANAGED": false,
				"VALUE":          "allowed",
			},
		}
		writeTestConfig(t, configPath, configData)
		loader := NewLoader(configPath)
		config, err := loader.Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		if len(config.CustomerEnv) != 2 {
			t.Errorf("CustomerEnv len = %d, want 2", len(config.CustomerEnv))
		}
		if config.CustomerEnv["ENV1"] != "value1" || config.CustomerEnv["ENV2"] != "value2" {
			t.Errorf("CustomerEnv = %v", config.CustomerEnv)
		}
		if _, ok := config.CustomerEnv["_PRIVATE"]; ok {
			t.Error("key starting with _ is invalid per validEnvKey, should not be in CustomerEnv")
		}
		if _, ok := config.CustomerEnv["SKIP_TRUE"]; ok {
			t.Error("SYSTEM_MANAGED=true should not be in CustomerEnv")
		}
	})

	t.Run("CustomerEnv excludes invalid key names", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")
		configData := map[string]any{
			"VALID_KEY": map[string]any{
				"SYSTEM_MANAGED": false,
				"VALUE":          "ok",
			},
			"123invalid": map[string]any{
				"SYSTEM_MANAGED": false,
				"VALUE":          "no",
			},
		}
		writeTestConfig(t, configPath, configData)
		loader := NewLoader(configPath)
		config, err := loader.Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		if config.CustomerEnv["VALID_KEY"] != "ok" {
			t.Errorf("CustomerEnv[VALID_KEY] = %q, want ok", config.CustomerEnv["VALID_KEY"])
		}
		if _, ok := config.CustomerEnv["123invalid"]; ok {
			t.Error("invalid key 123invalid should not be in CustomerEnv")
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

func TestLoader_InvalidateCache(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	configData := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE": map[string]any{
				"NAME": "first",
			},
		},
	}
	writeTestConfig(t, configPath, configData)

	loader := NewLoaderWithTTL(configPath, 1*time.Minute)

	config1, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if config1.Database.Value.Name != "first" {
		t.Errorf("initial load: got %q, want first", config1.Database.Value.Name)
	}

	configData["DATABASE"].(map[string]any)["VALUE"].(map[string]any)["NAME"] = "second"
	writeTestConfig(t, configPath, configData)

	loader.InvalidateCache()
	config2, err := loader.Load()
	if err != nil {
		t.Fatalf("Load() after InvalidateCache error = %v", err)
	}
	if config2.Database.Value.Name != "second" {
		t.Errorf("after InvalidateCache: got %q, want second", config2.Database.Value.Name)
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

func TestLoader_LoadWithProductID(t *testing.T) {
	t.Run("load config with PRODUCT_ID", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")

		configData := map[string]any{
			"PRODUCT_ID": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE":          "paas-nodejs-v1",
			},
		}

		writeTestConfig(t, configPath, configData)

		loader := NewLoader(configPath)
		config, err := loader.Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}

		if config.ProductID == nil {
			t.Fatal("PRODUCT_ID is nil")
		}
		if !config.ProductID.SystemManaged {
			t.Error("PRODUCT_ID.SYSTEM_MANAGED should be true")
		}
		if config.ProductID.Value != "paas-nodejs-v1" {
			t.Errorf("PRODUCT_ID.VALUE = %q, want %q", config.ProductID.Value, "paas-nodejs-v1")
		}
	})

	t.Run("load config with all fields including PRODUCT_ID", func(t *testing.T) {
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
				"VALUE":          "https://example.com/redirect",
			},
			"PRODUCT_ID": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE":          "aab-v2",
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
		if config.ProductID == nil {
			t.Fatal("PRODUCT_ID is nil")
		}
		if config.ProductID.Value != "aab-v2" {
			t.Errorf("PRODUCT_ID.VALUE = %q, want %q", config.ProductID.Value, "aab-v2")
		}
	})

	t.Run("empty file has nil PRODUCT_ID", func(t *testing.T) {
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

		if config.ProductID != nil {
			t.Error("PRODUCT_ID should be nil for empty config")
		}
	})
}

func TestConfig_CopyWithProductID(t *testing.T) {
	t.Run("Copy includes ProductID", func(t *testing.T) {
		config := &Config{
			ProductID: &Secret[string]{
				SystemManaged: true,
				Value:         "test-product-id",
			},
		}

		configCopy := config.Copy()

		if configCopy.ProductID == nil {
			t.Fatal("Copy().ProductID is nil")
		}
		if configCopy.ProductID.Value != "test-product-id" {
			t.Errorf("Copy().ProductID.Value = %q, want %q", configCopy.ProductID.Value, "test-product-id")
		}
		if configCopy.ProductID == config.ProductID {
			t.Error("Copy() should create new ProductID pointer")
		}
	})

	t.Run("Copy handles nil ProductID", func(t *testing.T) {
		config := &Config{
			Database: &Secret[DatabaseConfig]{
				Value: DatabaseConfig{Name: "testdb"},
			},
			ProductID: nil,
		}

		configCopy := config.Copy()

		if configCopy.ProductID != nil {
			t.Error("Copy().ProductID should be nil when original is nil")
		}
	})

	t.Run("Copy mutation does not affect original ProductID", func(t *testing.T) {
		config := &Config{
			ProductID: &Secret[string]{
				SystemManaged: true,
				Value:         "original-value",
			},
		}

		configCopy := config.Copy()
		configCopy.ProductID.Value = "mutated-value"

		if config.ProductID.Value != "original-value" {
			t.Errorf("Original ProductID was mutated: got %q, want %q", config.ProductID.Value, "original-value")
		}
	})
}

func TestConfig_GetProductID(t *testing.T) {
	t.Run("returns value when configured", func(t *testing.T) {
		config := &Config{
			ProductID: &Secret[string]{Value: "paas-nodejs-v1"},
		}
		if got := config.GetProductID(); got != "paas-nodejs-v1" {
			t.Errorf("GetProductID() = %q, want %q", got, "paas-nodejs-v1")
		}
	})

	t.Run("returns empty string when nil", func(t *testing.T) {
		config := &Config{}
		if got := config.GetProductID(); got != "" {
			t.Errorf("GetProductID() = %q, want empty string", got)
		}
	})
}

func TestConfig_HasProductID(t *testing.T) {
	t.Run("returns true when present and non-empty", func(t *testing.T) {
		config := &Config{
			ProductID: &Secret[string]{Value: "aab-v1"},
		}
		if !config.HasProductID() {
			t.Error("HasProductID() = false, want true")
		}
	})

	t.Run("returns false when nil", func(t *testing.T) {
		config := &Config{}
		if config.HasProductID() {
			t.Error("HasProductID() = true, want false")
		}
	})

	t.Run("returns false when empty string", func(t *testing.T) {
		config := &Config{
			ProductID: &Secret[string]{Value: ""},
		}
		if config.HasProductID() {
			t.Error("HasProductID() = true, want false")
		}
	})
}

func TestGetProductIDOrDefaultWithLoader(t *testing.T) {
	t.Run("returns product ID when config exists", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")
		writeTestConfig(t, configPath, map[string]any{
			"PRODUCT_ID": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE":          "paas-nodejs-v1",
			},
		})

		loader := NewLoader(configPath)
		result := getProductIDOrDefaultWithLoader(loader, "default-value")
		if result != "paas-nodejs-v1" {
			t.Errorf("got %q, want %q", result, "paas-nodejs-v1")
		}
	})

	t.Run("returns default when ProductID is missing", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")
		writeTestConfig(t, configPath, map[string]any{
			"DATABASE": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE": map[string]any{
					"NAME": "testdb",
				},
			},
		})

		loader := NewLoader(configPath)
		result := getProductIDOrDefaultWithLoader(loader, "default-value")
		if result != "default-value" {
			t.Errorf("got %q, want %q", result, "default-value")
		}
	})

	t.Run("returns default when ProductID value is empty", func(t *testing.T) {
		tmpDir := t.TempDir()
		configPath := filepath.Join(tmpDir, "config.json")
		writeTestConfig(t, configPath, map[string]any{
			"PRODUCT_ID": map[string]any{
				"SYSTEM_MANAGED": true,
				"VALUE":          "",
			},
		})

		loader := NewLoader(configPath)
		result := getProductIDOrDefaultWithLoader(loader, "default-value")
		if result != "default-value" {
			t.Errorf("got %q, want %q", result, "default-value")
		}
	})

	t.Run("returns default when config file missing", func(t *testing.T) {
		loader := NewLoader("/nonexistent/config.json")
		result := getProductIDOrDefaultWithLoader(loader, "fallback")
		if result != "fallback" {
			t.Errorf("got %q, want %q", result, "fallback")
		}
	})
}

func TestConfig_DatabaseEnv(t *testing.T) {
	t.Run("returns env vars when DATABASE is present", func(t *testing.T) {
		config := &Config{
			Database: &Secret[DatabaseConfig]{
				SystemManaged: true,
				Value: DatabaseConfig{
					Name:     "testdb",
					Host:     "mysql.example.com",
					Port:     3306,
					Username: "dbuser",
					Password: "secret",
				},
			},
		}

		env := config.DatabaseEnv()
		if env == nil {
			t.Fatal("DatabaseEnv() returned nil")
		}

		if env["DB_HOST"] != "mysql.example.com" {
			t.Errorf("DB_HOST = %q, want %q", env["DB_HOST"], "mysql.example.com")
		}
		if env["DB_PORT"] != "3306" {
			t.Errorf("DB_PORT = %q, want %q", env["DB_PORT"], "3306")
		}
		if env["DB_NAME"] != "testdb" {
			t.Errorf("DB_NAME = %q, want %q", env["DB_NAME"], "testdb")
		}
		if env["DB_USER"] != "dbuser" {
			t.Errorf("DB_USER = %q, want %q", env["DB_USER"], "dbuser")
		}
		if env["DB_PASSWORD"] != "secret" {
			t.Errorf("DB_PASSWORD = %q, want %q", env["DB_PASSWORD"], "secret")
		}
	})

	t.Run("returns nil when DATABASE is nil", func(t *testing.T) {
		config := &Config{}

		env := config.DatabaseEnv()
		if env != nil {
			t.Errorf("DatabaseEnv() = %v, want nil", env)
		}
	})

	t.Run("returns nil when config is nil", func(t *testing.T) {
		var config *Config

		env := config.DatabaseEnv()
		if env != nil {
			t.Errorf("DatabaseEnv() = %v, want nil", env)
		}
	})

	t.Run("returns all 5 env vars with correct keys", func(t *testing.T) {
		config := &Config{
			Database: &Secret[DatabaseConfig]{
				Value: DatabaseConfig{
					Name:     "db",
					Host:     "host",
					Port:     5432,
					Username: "user",
					Password: "pass",
				},
			},
		}

		env := config.DatabaseEnv()
		if len(env) != 5 {
			t.Errorf("DatabaseEnv() returned %d vars, want 5", len(env))
		}

		expectedKeys := []string{"DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"}
		for _, key := range expectedKeys {
			if _, ok := env[key]; !ok {
				t.Errorf("DatabaseEnv() missing key %q", key)
			}
		}
	})

	t.Run("converts port to string", func(t *testing.T) {
		config := &Config{
			Database: &Secret[DatabaseConfig]{
				Value: DatabaseConfig{
					Port: 5432,
				},
			},
		}

		env := config.DatabaseEnv()
		if env["DB_PORT"] != "5432" {
			t.Errorf("DB_PORT = %q, want %q", env["DB_PORT"], "5432")
		}
	})
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
