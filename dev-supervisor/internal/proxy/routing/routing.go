package routing

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path"
)

// LoadOptions defines the inputs for loading routing configuration.
type LoadOptions struct {
	ConfigPath string
	APIPrefix  string
	StaticRoot string
	SPAMode    bool
}

// Config defines advanced routing rules loaded from JSON file (optional).
type Config struct {
	StaticRoot   string        `json:"static_root"`
	SPAMode      bool          `json:"spa_mode"`
	APIPrefix    string        `json:"api_prefix"`
	ForwardRules []ForwardRule `json:"forward_rules"`
	CacheControl CacheSettings `json:"cache_control"`
}

// ForwardRule defines a custom routing rule for advanced request forwarding.
type ForwardRule struct {
	PathPattern string   `json:"path_pattern"` // Regex or glob pattern
	TargetURL   string   `json:"target_url"`   // Where to forward
	Rewrite     string   `json:"rewrite"`      // Optional path rewrite
	Methods     []string `json:"methods"`      // HTTP methods (default: all)
}

// CacheSettings defines cache control headers for static assets.
type CacheSettings struct {
	EnableCaching bool           `json:"enable_caching"`
	MaxAge        map[string]int `json:"max_age"` // file extension -> seconds
}

// NewStaticFileHandler creates an http.Handler for serving static files with caching.
func NewStaticFileHandler(root string, cacheSettings CacheSettings) http.Handler {
	fs := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ensure intermediaries cache distinct variants per negotiated encoding
		w.Header().Add("Vary", "Accept-Encoding")

		// Set cache headers based on file extension
		if cacheSettings.EnableCaching {
			ext := path.Ext(r.URL.Path)
			if maxAge, ok := cacheSettings.MaxAge[ext]; ok {
				w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
			}
		}

		fs.ServeHTTP(w, r)
	})
}

// LoadConfig loads routing configuration from file or returns defaults.
func LoadConfig(options LoadOptions) (Config, error) {
	config := defaultRoutingConfig()

	// Apply environment variable overrides to defaults
	if options.APIPrefix != "" {
		config.APIPrefix = options.APIPrefix
	}
	if options.StaticRoot != "" {
		config.StaticRoot = options.StaticRoot
	}
	config.SPAMode = options.SPAMode

	// Load from JSON file if specified (JSON config takes precedence over env vars)
	if options.ConfigPath != "" {
		if err := loadRoutingConfigFromFile(&config, options.ConfigPath); err != nil {
			return config, err
		}
	}

	return config, nil
}

func defaultRoutingConfig() Config {
	return Config{
		APIPrefix: "/api",
		SPAMode:   true,
		CacheControl: CacheSettings{
			EnableCaching: true,
			MaxAge: map[string]int{
				".js":    31536000, // 1 year (content-hashed)
				".css":   31536000,
				".woff2": 31536000,
				".png":   2592000, // 30 days
				".jpg":   2592000,
				".svg":   2592000,
				".html":  0, // Never cache (SPA shell)
				".json":  0,
			},
		},
	}
}

// routingConfigJSON is used for unmarshalling JSON with optional fields.
// Uses pointers so we can distinguish between "not set" and "set to false/zero".
type routingConfigJSON struct {
	StaticRoot    *string            `json:"static_root"`
	SPAMode       *bool              `json:"spa_mode"`
	APIPrefix     *string            `json:"api_prefix"`
	ForwardRules  []ForwardRule      `json:"forward_rules"`
	CacheControl  *cacheSettingsJSON `json:"cache_control"`
	EnableCaching *bool              `json:"enable_caching"` // Deprecated: use cache_control.enable_caching instead
}

// cacheSettingsJSON is used for unmarshalling cache settings from JSON.
// Uses pointers so we can distinguish between "not set" and "set to false/zero".
type cacheSettingsJSON struct {
	EnableCaching *bool           `json:"enable_caching"`
	MaxAge        *map[string]int `json:"max_age"` // file extension -> seconds
}

// loadRoutingConfigFromFile loads routing configuration from a JSON file.
func loadRoutingConfigFromFile(config *Config, configPath string) error {
	slog.Info("loading routing config from file", "path", configPath)

	// Check if file exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return fmt.Errorf("routing config file not found: %s", configPath)
	}

	// Read file
	data, err := os.ReadFile(configPath)
	if err != nil {
		return fmt.Errorf("failed to read routing config file: %w", err)
	}

	// Unmarshal JSON using pointer struct to distinguish "not set" from "set to false/zero"
	var fileConfig routingConfigJSON
	if err := json.Unmarshal(data, &fileConfig); err != nil {
		return fmt.Errorf("failed to parse routing config JSON: %w", err)
	}

	// Merge file config with defaults (file config takes precedence)
	mergeRoutingConfig(config, &fileConfig)

	slog.Info("routing config loaded successfully",
		"api_prefix", config.APIPrefix,
		"static_root", config.StaticRoot,
		"spa_mode", config.SPAMode)

	return nil
}

// mergeRoutingConfig merges file configuration with defaults.
func mergeRoutingConfig(config *Config, fileConfig *routingConfigJSON) {
	// Only override values that were explicitly set in JSON (non-nil pointers)
	if fileConfig.StaticRoot != nil && *fileConfig.StaticRoot != "" {
		config.StaticRoot = *fileConfig.StaticRoot
	}
	if fileConfig.APIPrefix != nil && *fileConfig.APIPrefix != "" {
		config.APIPrefix = *fileConfig.APIPrefix
	}
	if fileConfig.SPAMode != nil {
		config.SPAMode = *fileConfig.SPAMode
	}

	// Merge cache control settings
	if fileConfig.CacheControl != nil {
		// Copy EnableCaching only if explicitly set in JSON
		if fileConfig.CacheControl.EnableCaching != nil {
			config.CacheControl.EnableCaching = *fileConfig.CacheControl.EnableCaching
		}

		// Copy MaxAge only if explicitly set in JSON
		if fileConfig.CacheControl.MaxAge != nil {
			config.CacheControl.MaxAge = *fileConfig.CacheControl.MaxAge
		}
	} else if fileConfig.EnableCaching != nil {
		// Support deprecated top-level enable_caching for backward compatibility
		config.CacheControl.EnableCaching = *fileConfig.EnableCaching
	}

	if fileConfig.ForwardRules != nil {
		config.ForwardRules = fileConfig.ForwardRules
		slog.Warn("forward_rules are not yet implemented and will be ignored",
			"rule_count", len(fileConfig.ForwardRules))
	}
}
