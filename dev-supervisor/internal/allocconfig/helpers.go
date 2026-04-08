package allocconfig

import "errors"

// GetDatabaseConfig returns the database configuration
// Returns error if DATABASE is not configured
func (c *Config) GetDatabaseConfig() (DatabaseConfig, error) {
	if c.Database == nil {
		return DatabaseConfig{}, errors.New("DATABASE not configured")
	}
	return c.Database.Value, nil
}

// GetJWTRedirectURL returns the JWT redirect URL
// Returns empty string if not configured
func (c *Config) GetJWTRedirectURL() string {
	if c.JWTRedirectURL == nil {
		return ""
	}
	return c.JWTRedirectURL.Value
}

// HasDatabase returns true if DATABASE is configured
func (c *Config) HasDatabase() bool {
	return c.Database != nil
}

// HasJWTRedirectURL returns true if JWT_REDIRECT_URL is configured and non-empty
func (c *Config) HasJWTRedirectURL() bool {
	return c.JWTRedirectURL != nil && c.JWTRedirectURL.Value != ""
}

// GetProductID returns the product ID value.
// Returns empty string if not configured.
func (c *Config) GetProductID() string {
	if c.ProductID == nil {
		return ""
	}
	return c.ProductID.Value
}

// HasProductID returns true if PRODUCT_ID is configured and non-empty
func (c *Config) HasProductID() bool {
	return c.ProductID != nil && c.ProductID.Value != ""
}

// GetProductIDOrDefault loads config using Default() and returns the product ID.
// Returns defaultValue if config cannot be loaded or PRODUCT_ID is not set.
func GetProductIDOrDefault(defaultValue string) string {
	return getProductIDOrDefaultWithLoader(Default(), defaultValue)
}

// getProductIDOrDefaultWithLoader is the internal implementation that accepts a loader.
// This allows testing with custom loaders while the public function uses Default().
func getProductIDOrDefaultWithLoader(loader *Loader, defaultValue string) string {
	cfg, err := loader.Load()
	if err != nil {
		return defaultValue
	}
	if cfg.HasProductID() {
		return cfg.GetProductID()
	}
	return defaultValue
}
