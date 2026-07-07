package awsconfig

import (
	"fmt"
	"os"
	"path/filepath"
)

const (
	DefaultProfile   = "airobuild-dev-private-sso"
	ExpectedRoleName = "PowerUser"
	SSOStartURL      = "https://d-9267a7c4d5.awsapps.com/start/#"
	SSOSessionName   = "airo-sso"
	SSOAccountID     = "694282668781"
	SSORegion        = "us-west-2"
)

// SSOSessionConfig returns the [sso-session] block for ~/.aws/config.
func SSOSessionConfig() string {
	return fmt.Sprintf(`[sso-session %s]
sso_start_url = %s
sso_region = %s
sso_registration_scopes = sso:account:access`, SSOSessionName, SSOStartURL, SSORegion)
}

// ConfigPath returns the absolute path to ~/.aws/config.
func ConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".aws", "config"), nil
}
