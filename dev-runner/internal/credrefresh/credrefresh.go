package credrefresh

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/ssocreds"
)

// Bracket represents the urgency level of token TTL.
type Bracket int

const (
	BracketHealthy  Bracket = iota // > 30m
	BracketWarning                 // > 10m
	BracketUrgent                  // > 5m
	BracketCritical                // <= 5m
)

// BracketFor returns the bracket for a given TTL.
func BracketFor(ttl time.Duration) Bracket {
	switch {
	case ttl > 30*time.Minute:
		return BracketHealthy
	case ttl > 10*time.Minute:
		return BracketWarning
	case ttl > 5*time.Minute:
		return BracketUrgent
	default:
		return BracketCritical
	}
}

// Config holds parameters for the credential refresh monitor.
type Config struct {
	CheckInterval    time.Duration
	RefreshThreshold time.Duration
	MinUsableTTL     time.Duration
	Profiles         []string
	ProjectRoot      string
}

// DefaultConfig returns a Config with standard intervals.
func DefaultConfig(profiles []string, projectRoot string) Config {
	return Config{
		CheckInterval:    2 * time.Minute,
		RefreshThreshold: 30 * time.Minute,
		MinUsableTTL:     5 * time.Minute,
		Profiles:         profiles,
		ProjectRoot:      projectRoot,
	}
}

// StatusReason classifies why a Status has its OK value.
type StatusReason int

const (
	ReasonValid         StatusReason = iota // Token is valid with usable TTL
	ReasonExpired                           // Token exists but TTL <= 0
	ReasonNotSSO                            // Profile uses static creds, not SSO
	ReasonNoData                            // Cannot inspect (no home dir, no config)
	ReasonNotFound                          // Profile or cache file not found
	ReasonParseError                        // Cache file malformed
	ReasonRefreshFailed                     // Silent refresh attempted and failed
)

// Status represents the current state of a profile's SSO token.
type Status struct {
	Profile   string
	ExpiresAt time.Time
	TTL       time.Duration
	OK        bool
	Reason    StatusReason
	Message   string
}

// SSOTokenCache represents the SSO token cache file contents.
// Uses a raw map to preserve unknown fields that other AWS tooling may depend on.
type SSOTokenCache struct {
	raw map[string]any
}

func (c *SSOTokenCache) AccessToken() string  { return c.getString("accessToken") }
func (c *SSOTokenCache) ExpiresAt() string    { return c.getString("expiresAt") }
func (c *SSOTokenCache) RefreshToken() string { return c.getString("refreshToken") }
func (c *SSOTokenCache) ClientID() string     { return c.getString("clientId") }
func (c *SSOTokenCache) ClientSecret() string { return c.getString("clientSecret") }

func (c *SSOTokenCache) SetAccessToken(v string)  { c.raw["accessToken"] = v }
func (c *SSOTokenCache) SetExpiresAt(v string)    { c.raw["expiresAt"] = v }
func (c *SSOTokenCache) SetRefreshToken(v string) { c.raw["refreshToken"] = v }

func (c *SSOTokenCache) getString(key string) string {
	v, _ := c.raw[key].(string)
	return v
}

func ParseSSOTokenCache(data []byte) (*SSOTokenCache, error) {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	return &SSOTokenCache{raw: raw}, nil
}

func (c *SSOTokenCache) Marshal() ([]byte, error) {
	return json.Marshal(c.raw)
}

// ssoTokenInfo is the subset of an SSO access token cache file we need.
type ssoTokenInfo struct {
	ExpiresAt string `json:"expiresAt"`
}

// cachedTokenFilepath computes the SSO cache file path using the same SHA1
// logic as ssocreds.StandardCachedTokenFilepath, but rooted at the given
// homeDir instead of os.UserHomeDir(). This enables testing with temp dirs.
func cachedTokenFilepath(homeDir string, cacheKey string) string {
	hash := fmt.Sprintf("%x", sha1.Sum([]byte(cacheKey)))
	return filepath.Join(homeDir, ".aws", "sso", "cache", hash+".json")
}

// ResolveSSO resolves the SSO session name and region for a profile.
// Returns (sessionName, ssoRegion, error).
func ResolveSSO(profile string, homeDir string) (string, string, error) {
	if homeDir == "" {
		var err error
		homeDir, err = os.UserHomeDir()
		if err != nil {
			return "", "", fmt.Errorf("cannot determine home directory: %w", err)
		}
	}

	awsDir := filepath.Join(homeDir, ".aws")
	configPath := filepath.Join(awsDir, "config")

	cfg, err := awsconfig.LoadSharedConfigProfile(context.Background(), profile,
		func(o *awsconfig.LoadSharedConfigOptions) {
			o.ConfigFiles = []string{configPath}
			o.CredentialsFiles = []string{filepath.Join(awsDir, "credentials")}
		},
	)
	if err != nil {
		return "", "", fmt.Errorf("profile %q: %w", profile, err)
	}

	switch {
	case cfg.SSOSession != nil:
		return cfg.SSOSession.Name, cfg.SSOSession.SSORegion, nil
	case cfg.SSOStartURL != "":
		return cfg.SSOStartURL, cfg.SSORegion, nil
	default:
		return "", "", fmt.Errorf("profile %q is not an SSO profile", profile)
	}
}

// ReadTokenCache reads the full SSO token cache file for a profile.
func ReadTokenCache(profile string, homeDir string) (*SSOTokenCache, string, error) {
	homeDirOverride := homeDir != ""
	if !homeDirOverride {
		var err error
		homeDir, err = os.UserHomeDir()
		if err != nil {
			return nil, "", fmt.Errorf("cannot determine home directory: %w", err)
		}
	}

	awsDir := filepath.Join(homeDir, ".aws")
	configPath := filepath.Join(awsDir, "config")

	cfg, err := awsconfig.LoadSharedConfigProfile(context.Background(), profile,
		func(o *awsconfig.LoadSharedConfigOptions) {
			o.ConfigFiles = []string{configPath}
			o.CredentialsFiles = []string{filepath.Join(awsDir, "credentials")}
		},
	)
	if err != nil {
		return nil, "", fmt.Errorf("profile %q: %w", profile, err)
	}

	var cacheKey string
	switch {
	case cfg.SSOSession != nil:
		cacheKey = cfg.SSOSession.Name
	case cfg.SSOStartURL != "":
		cacheKey = cfg.SSOStartURL
	default:
		return nil, "", fmt.Errorf("profile %q is not an SSO profile", profile)
	}

	var cachePath string
	if homeDirOverride {
		cachePath = cachedTokenFilepath(homeDir, cacheKey)
	} else {
		cachePath, err = ssocreds.StandardCachedTokenFilepath(cacheKey)
		if err != nil {
			return nil, "", fmt.Errorf("cache path: %w", err)
		}
	}

	data, err := os.ReadFile(cachePath)
	if err != nil {
		return nil, "", fmt.Errorf("reading cache: %w", err)
	}

	cache, err := ParseSSOTokenCache(data)
	if err != nil {
		return nil, "", fmt.Errorf("parsing cache: %w", err)
	}

	return cache, cachePath, nil
}

// WriteTokenCache atomically writes the SSO token cache back to disk.
// Uses write-to-temp + rename to avoid corrupting the cache if a crash or
// concurrent reader observes a partial write.
func WriteTokenCache(cachePath string, cache *SSOTokenCache) error {
	data, err := cache.Marshal()
	if err != nil {
		return fmt.Errorf("marshaling cache: %w", err)
	}

	dir := filepath.Dir(cachePath)
	tmp, err := os.CreateTemp(dir, ".sso-cache-*.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("setting permissions: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}
	if err := os.Rename(tmpPath, cachePath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("renaming temp to cache: %w", err)
	}
	return nil
}

// CheckToken reads the SSO cache for the given profile and returns its status.
// homeDir overrides ~ for testing; pass "" to use os.UserHomeDir().
func CheckToken(profile string, homeDir string) Status {
	homeDirOverride := homeDir != ""
	if !homeDirOverride {
		var err error
		homeDir, err = os.UserHomeDir()
		if err != nil {
			return Status{Profile: profile, OK: false, Reason: ReasonNoData, Message: "cannot determine home directory"}
		}
	}

	awsDir := filepath.Join(homeDir, ".aws")
	configPath := filepath.Join(awsDir, "config")

	if _, err := os.Stat(configPath); errors.Is(err, fs.ErrNotExist) {
		return Status{Profile: profile, OK: false, Reason: ReasonNoData, Message: "~/.aws/config not found"}
	}

	cfg, err := awsconfig.LoadSharedConfigProfile(context.Background(), profile,
		func(o *awsconfig.LoadSharedConfigOptions) {
			o.ConfigFiles = []string{configPath}
			o.CredentialsFiles = []string{filepath.Join(awsDir, "credentials")}
		},
	)
	if err != nil {
		return Status{Profile: profile, OK: false, Reason: ReasonNotFound, Message: fmt.Sprintf("profile %q: %s", profile, err)}
	}

	var cacheKey string
	switch {
	case cfg.SSOSession != nil:
		cacheKey = cfg.SSOSession.Name
	case cfg.SSOStartURL != "":
		cacheKey = cfg.SSOStartURL
	default:
		return Status{Profile: profile, OK: true, Reason: ReasonNotSSO, Message: "not an SSO profile"}
	}

	var cachePath string
	if homeDirOverride {
		cachePath = cachedTokenFilepath(homeDir, cacheKey)
	} else {
		var pathErr error
		cachePath, pathErr = ssocreds.StandardCachedTokenFilepath(cacheKey)
		if pathErr != nil {
			return Status{Profile: profile, OK: false, Reason: ReasonParseError, Message: fmt.Sprintf("cache path: %s", pathErr)}
		}
	}

	data, err := os.ReadFile(cachePath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Status{Profile: profile, OK: false, Reason: ReasonNotFound, Message: fmt.Sprintf("SSO token not found for %q", profile)}
		}
		return Status{Profile: profile, OK: false, Reason: ReasonParseError, Message: fmt.Sprintf("reading cache: %s", err)}
	}

	var token ssoTokenInfo
	if err := json.Unmarshal(data, &token); err != nil {
		return Status{Profile: profile, OK: false, Reason: ReasonParseError, Message: fmt.Sprintf("parsing cache: %s", err)}
	}
	if token.ExpiresAt == "" {
		return Status{Profile: profile, OK: false, Reason: ReasonParseError, Message: "cache missing expiresAt"}
	}

	expiresAt, err := time.Parse(time.RFC3339, token.ExpiresAt)
	if err != nil {
		return Status{Profile: profile, OK: false, Reason: ReasonParseError, Message: fmt.Sprintf("parsing expiresAt: %s", err)}
	}

	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return Status{
			Profile:   profile,
			ExpiresAt: expiresAt,
			TTL:       ttl,
			OK:        false,
			Reason:    ReasonExpired,
			Message:   fmt.Sprintf("expired %s ago", (-ttl).Truncate(time.Minute)),
		}
	}

	return Status{
		Profile:   profile,
		ExpiresAt: expiresAt,
		TTL:       ttl,
		OK:        true,
		Reason:    ReasonValid,
		Message:   fmt.Sprintf("expires in %s", ttl.Truncate(time.Minute)),
	}
}
