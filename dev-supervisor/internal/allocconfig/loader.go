package allocconfig

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

const (
	// DefaultCacheTTL is the default cache duration for config values
	// Short duration (5s) balances:
	// - Freshness: Config changes picked up quickly (within 5 seconds)
	// - DoS resistance: Limits file I/O during authentication floods
	DefaultCacheTTL = 5 * time.Second
)

// defaultAllocConfigPath returns the path to config.json based on NOMAD_ALLOC_DIR.
// In production, Nomad sets NOMAD_ALLOC_DIR to the allocation directory.
// In local dev, it defaults to /alloc (where docker-compose mounts the alloc directory).
func defaultAllocConfigPath() string {
	allocDir := os.Getenv("NOMAD_ALLOC_DIR")
	if allocDir == "" {
		allocDir = "/alloc"
	}
	return filepath.Join(allocDir, "config.json")
}

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

// validEnvKey matches allowed environment variable names (POSIX-style).
var validEnvKey = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]*$`)

// Config represents the structure of /alloc/config.json
// This file contains deployment-time secrets and configuration.
// CustomerEnv holds top-level keys that are Secret[string] with SYSTEM_MANAGED=false (reloaded with config).
type Config struct {
	Database       *Secret[DatabaseConfig] `json:"DATABASE"`
	JWTRedirectURL *Secret[string]         `json:"JWT_REDIRECT_URL"`
	ProductID      *Secret[string]         `json:"PRODUCT_ID"`
	CustomerEnv    map[string]string       `json:"-"` // Populated from other top-level entries; not from JSON tag
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

	if c.ProductID != nil {
		pidCopy := *c.ProductID
		configCopy.ProductID = &pidCopy
	}

	if len(c.CustomerEnv) > 0 {
		configCopy.CustomerEnv = make(map[string]string, len(c.CustomerEnv))
		maps.Copy(configCopy.CustomerEnv, c.CustomerEnv)
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
		defaultLoader = NewLoaderWithTTL(defaultAllocConfigPath(), DefaultCacheTTL)
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
// If path is empty, uses defaultAllocConfigPath() (respects NOMAD_ALLOC_DIR)
func NewLoader(path string) *Loader {
	return NewLoaderWithTTL(path, DefaultCacheTTL)
}

// NewLoaderWithTTL creates a new config loader with custom cache TTL
// Set ttl to 0 to disable caching (always read from disk)
func NewLoaderWithTTL(path string, ttl time.Duration) *Loader {
	if path == "" {
		path = defaultAllocConfigPath()
	}
	return &Loader{
		path:     path,
		cacheTTL: ttl,
	}
}

// InvalidateCache clears the loader cache so the next Load() reads from disk.
// Use when the caller needs to force a fresh read (e.g. process restart).
func (l *Loader) InvalidateCache() {
	if l.cacheTTL <= 0 {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.cachedConfig = nil
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

		var raw map[string]json.RawMessage
		if err := json.Unmarshal(data, &raw); err != nil {
			return nil, fmt.Errorf("parse config: %w", err)
		}

		config := &Config{}
		for k, v := range raw {
			switch k {
			case "DATABASE":
				var s Secret[DatabaseConfig]
				if err := json.Unmarshal(v, &s); err != nil {
					continue
				}
				config.Database = &s
			case "JWT_REDIRECT_URL":
				var s Secret[string]
				if err := json.Unmarshal(v, &s); err != nil {
					continue
				}
				config.JWTRedirectURL = &s
			case "PRODUCT_ID":
				var s Secret[string]
				if err := json.Unmarshal(v, &s); err != nil {
					continue
				}
				config.ProductID = &s
			default:
				if validEnvKey.MatchString(k) {
					var s Secret[string]
					if err := json.Unmarshal(v, &s); err != nil {
						continue
					}
					if !s.SystemManaged {
						if config.CustomerEnv == nil {
							config.CustomerEnv = make(map[string]string)
						}
						config.CustomerEnv[k] = s.Value
					}
				}
			}
		}

		// Update cache if TTL > 0
		if l.cacheTTL > 0 {
			l.mu.Lock()
			l.cachedConfig = config
			l.cacheExpiry = time.Now().Add(l.cacheTTL)
			l.mu.Unlock()
		}

		return config, nil
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
