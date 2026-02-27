package allocconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

const (
	// DefaultAllocConfigPath is the standard location for allocation configuration
	DefaultAllocConfigPath = "/alloc/config.json"

	// DefaultCacheTTL is the default cache duration for config values
	// Short duration (5s) balances:
	// - Freshness: Config changes picked up quickly (within 5 seconds)
	// - DoS resistance: Limits file I/O during authentication floods
	DefaultCacheTTL = 5 * time.Second
)

// Secret represents a generic SYSTEM_MANAGED secret wrapper
// T is the type of the secret value (string, DatabaseConfig, etc.)
type Secret[T any] struct {
	SystemManaged bool `json:"SYSTEM_MANAGED"`
	Value         T    `json:"VALUE"`
}

// DatabaseConfig represents MySQL connection credentials
type DatabaseConfig struct {
	Name     string `json:"NAME"`
	Host     string `json:"HOST"`
	IP       string `json:"IP"`
	Port     int    `json:"PORT"`
	Username string `json:"USERNAME"`
	Password string `json:"PASSWORD"`
	Variant  string `json:"VARIANT"`
}

// Config represents the structure of /alloc/config.json
// This file contains deployment-time secrets and configuration
type Config struct {
	Database       *Secret[DatabaseConfig] `json:"DATABASE"`
	JWTRedirectURL *Secret[string]         `json:"JWT_REDIRECT_URL"`
}

// Copy returns a deep copy of the Config
// Prevents callers from mutating cached config
func (c *Config) Copy() *Config {
	if c == nil {
		return nil
	}

	configCopy := &Config{}

	if c.Database != nil {
		dbCopy := *c.Database
		configCopy.Database = &dbCopy
	}

	if c.JWTRedirectURL != nil {
		jwtCopy := *c.JWTRedirectURL
		configCopy.JWTRedirectURL = &jwtCopy
	}

	return configCopy
}

var (
	defaultLoader     *Loader
	defaultLoaderOnce sync.Once
)

// Default returns the process-wide shared Loader for /alloc/config.json.
// All production consumers should use this instead of creating their own Loader,
// ensuring singleflight deduplication and cache sharing across the process.
// Use NewLoader/NewLoaderWithTTL for tests that need custom paths or TTL values.
func Default() *Loader {
	defaultLoaderOnce.Do(func() {
		defaultLoader = NewLoaderWithTTL(DefaultAllocConfigPath, DefaultCacheTTL)
	})
	return defaultLoader
}

// Loader provides file-based config loading with optional TTL caching
// Caching balances performance (avoid repeated file reads) with responsiveness
// (pick up config changes within TTL window)
// Uses singleflight to prevent cache stampedes (multiple goroutines loading file on expiry)
type Loader struct {
	path         string
	cacheTTL     time.Duration
	cachedConfig *Config
	cacheExpiry  time.Time
	mu           sync.RWMutex
	sf           singleflight.Group
}

// NewLoader creates a new config loader with default cache TTL
// If path is empty, uses DefaultAllocConfigPath
func NewLoader(path string) *Loader {
	return NewLoaderWithTTL(path, DefaultCacheTTL)
}

// NewLoaderWithTTL creates a new config loader with custom cache TTL
// Set ttl to 0 to disable caching (always read from disk)
func NewLoaderWithTTL(path string, ttl time.Duration) *Loader {
	if path == "" {
		path = DefaultAllocConfigPath
	}
	return &Loader{
		path:     path,
		cacheTTL: ttl,
	}
}

// Load reads and parses the config file with optional TTL caching
// Returns error if file cannot be read or parsed
// If caching is enabled (TTL > 0), returns cached value if still valid
// Returns a copy of the config to prevent data races (caller cannot mutate cache)
// Uses singleflight to prevent stampedes on all loads (even when TTL=0)
func (l *Loader) Load() (*Config, error) {
	// Fast path: check cache if TTL > 0
	if l.cacheTTL > 0 {
		l.mu.RLock()
		if l.cachedConfig != nil && time.Now().Before(l.cacheExpiry) {
			// Return a deep copy to prevent caller mutations from affecting cache
			configCopy := l.cachedConfig.Copy()
			l.mu.RUnlock()
			return configCopy, nil
		}
		l.mu.RUnlock()
	}

	// Cache miss or expired - use singleflight to prevent stampede
	// All concurrent callers share one file read, even when caching disabled
	result, err, _ := l.sf.Do("load", func() (any, error) {
		// Read and parse config from disk
		data, err := os.ReadFile(l.path)
		if err != nil {
			return nil, fmt.Errorf("read config: %w", err)
		}

		var config Config
		if err := json.Unmarshal(data, &config); err != nil {
			return nil, fmt.Errorf("parse config: %w", err)
		}

		// Update cache if TTL > 0
		if l.cacheTTL > 0 {
			l.mu.Lock()
			l.cachedConfig = &config
			l.cacheExpiry = time.Now().Add(l.cacheTTL)
			l.mu.Unlock()
		}

		return &config, nil
	})

	if err != nil {
		return nil, err
	}

	config, ok := result.(*Config)
	if !ok {
		return nil, fmt.Errorf("unexpected type from singleflight: %T", result)
	}
	// Return a copy to prevent caller mutations from affecting future calls
	// (cache miss path must match cache hit path behavior)
	return config.Copy(), nil
}
