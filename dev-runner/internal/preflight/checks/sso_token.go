package checks

import (
	"context"
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

// ssoTokenMinValidity is the minimum remaining lifetime an SSO access token
// must have to be considered valid. The Node.js AWS SDK refuses to use an SSO
// token that is already expired and surfaces the "Token is expired" error
// immediately; we fail a few minutes early to avoid the app starting in a
// state that is about to break mid-request.
const ssoTokenMinValidity = 5 * time.Minute

// ssoTokenInfo is the subset of an SSO access token cache file we care about.
// AWS writes ~/.aws/sso/cache/<sha1>.json with many more fields, but we only
// need the expiry to predict whether the JS SDK will accept it.
type ssoTokenInfo struct {
	ExpiresAt string `json:"expiresAt"`
}

// checkSSOToken verifies that the SSO access token cache for the given AWS
// profile exists and is not expired (or about to expire).
//
// Returns (true, "") when the profile is not an SSO profile, signalling the
// caller that no SSO-token guarantee can be made and other checks (e.g. STS)
// should be relied on. Returns (true, "") when the token is valid. Returns
// (false, message) when the profile entry is missing from ~/.aws/config, or
// when the SSO token is missing/expired/malformed.
//
// The motivation: the Go AWS SDK's SSO token provider transparently refreshes
// an expired access token using the cached refresh token, so an STS call can
// still succeed after the access token at ~/.aws/sso/cache/ has expired. The
// app's JS SDK does not refresh and fails the moment expiresAt passes ("Token
// is expired"). Reading expiresAt directly here catches the gap that STS-based
// checks miss. We deliberately do not delegate to the SDK's token provider,
// which would auto-refresh and re-introduce the exact false-green this guards
// against — this is coupled to the JS SDK not refreshing; revisit if it gains
// that ability.
func checkSSOToken(profile string) (ok bool, message string) {
	home, err := os.UserHomeDir()
	if err != nil {
		// No home dir means we can't locate the cache; treat as "no SSO data
		// available" rather than a hard fail so STS still gets a chance to
		// validate access-key style credentials.
		return true, ""
	}

	awsDir := filepath.Join(home, ".aws")
	configPath := filepath.Join(awsDir, "config")

	// Absent ~/.aws/config there is no SSO configuration to inspect; defer to
	// STS, which can still validate static-credential profiles. We stat the
	// file explicitly because LoadSharedConfigProfile treats an unreadable
	// config file as empty and would otherwise report the profile as missing.
	if _, err := os.Stat(configPath); errors.Is(err, fs.ErrNotExist) {
		return true, ""
	}

	cfg, err := awsconfig.LoadSharedConfigProfile(context.Background(), profile,
		func(o *awsconfig.LoadSharedConfigOptions) {
			o.ConfigFiles = []string{configPath}
			o.CredentialsFiles = []string{filepath.Join(awsDir, "credentials")}
		},
	)
	if err != nil {
		var notExist awsconfig.SharedConfigProfileNotExistError
		if errors.As(err, &notExist) {
			return false, fmt.Sprintf("AWS profile %q not found in ~/.aws/config (run: aws sso login --profile %s)", profile, profile)
		}
		return false, fmt.Sprintf("reading ~/.aws/config for profile %q: %s", profile, err)
	}

	// Derive the SSO access-token cache key: the modern [sso-session] flow keys
	// the token cache by session name, the legacy inline flow by start URL. A
	// profile with neither is not an SSO profile, so defer to STS for static
	// credentials (access key / session token) validation.
	var cacheKey string
	switch {
	case cfg.SSOSession != nil:
		cacheKey = cfg.SSOSession.Name
	case cfg.SSOStartURL != "":
		cacheKey = cfg.SSOStartURL
	default:
		return true, ""
	}

	cachePath, err := ssocreds.StandardCachedTokenFilepath(cacheKey)
	if err != nil {
		return false, fmt.Sprintf("deriving SSO cache path for profile %q: %s", profile, err)
	}

	data, err := os.ReadFile(cachePath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, fmt.Sprintf("AWS SSO token not found for profile %q (run: aws sso login --profile %s)", profile, profile)
		}
		return false, fmt.Sprintf("reading SSO token cache for profile %q: %s", profile, err)
	}

	var token ssoTokenInfo
	if err := json.Unmarshal(data, &token); err != nil {
		return false, fmt.Sprintf("parsing SSO token cache for profile %q: %s", profile, err)
	}
	if token.ExpiresAt == "" {
		return false, fmt.Sprintf("SSO token cache for profile %q is missing expiresAt (run: aws sso login --profile %s)", profile, profile)
	}

	// Current AWS CLI v2 writes expiresAt as RFC3339 with a `Z` suffix. (CLIs
	// older than 2.1.13 wrote a literal `UTC` suffix that won't parse here; it
	// fails closed below — forcing a re-login — and self-heals on next login.)
	expiresAt, err := time.Parse(time.RFC3339, token.ExpiresAt)
	if err != nil {
		return false, fmt.Sprintf("parsing SSO token expiresAt for profile %q: %s", profile, err)
	}

	if time.Now().Add(ssoTokenMinValidity).After(expiresAt) {
		return false, fmt.Sprintf("AWS SSO session expired for profile %q (run: aws sso login --profile %s)", profile, profile)
	}

	return true, ""
}
