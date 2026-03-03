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
