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
		RefreshThreshold: 10 * time.Minute,
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
