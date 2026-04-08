package fixers

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultAWSProfile   = "airobuild-dev-private-sso"
	ssoSessionName      = "airo-sso"
	ssoSessionConfig    = `[sso-session airo-sso]
sso_start_url = https://d-9267a7c4d5.awsapps.com/start/#
sso_region = us-west-2
sso_registration_scopes = sso:account:access`
	profileConfig = `[profile airobuild-dev-private-sso]
sso_session = airo-sso
sso_account_id = 694282668781
sso_role_name = PowerUser
region = us-west-2
output = json`
)

// AWSSSOFixer triggers an AWS SSO login and waits for credentials to become valid.
type AWSSSOFixer struct {
	// Profile is the AWS CLI profile to use. Defaults to "airobuild-dev-private-sso".
	Profile string
}

func (f *AWSSSOFixer) profile() string {
	if f.Profile != "" {
		return f.Profile
	}
	return defaultAWSProfile
}

func (f *AWSSSOFixer) Fix(ctx context.Context, projectRoot string) error {
	profile := f.profile()

	// Ensure the profile and sso-session exist in ~/.aws/config
	if err := ensureAWSConfig(profile); err != nil {
		return fmt.Errorf("setting up AWS config: %w", err)
	}

	if err := RunCommandInteractive(ctx, projectRoot, nil, "aws", "sso", "login", "--profile", profile); err != nil {
		return fmt.Errorf("aws sso login: %w", err)
	}

	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, err := RunCommand(ctx, projectRoot, "aws", "sts", "get-caller-identity", "--profile", profile); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	return fmt.Errorf("timed out waiting for AWS SSO credentials to become valid (profile: %s)", profile)
}

// ensureAWSConfig checks ~/.aws/config for the sso-session and profile blocks,
// appending any that are missing.
func ensureAWSConfig(profile string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("getting home dir: %w", err)
	}

	configPath := filepath.Join(home, ".aws", "config")

	// Ensure ~/.aws/ directory exists
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		return fmt.Errorf("creating ~/.aws/: %w", err)
	}

	content, err := os.ReadFile(configPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("reading %s: %w", configPath, err)
	}

	hasSession := containsSection(string(content), "sso-session "+ssoSessionName)
	hasProfile := containsSection(string(content), "profile "+profile)

	if hasSession && hasProfile {
		return nil
	}

	var toAppend []string
	if !hasSession {
		toAppend = append(toAppend, ssoSessionConfig)
	}
	if !hasProfile && profile == defaultAWSProfile {
		toAppend = append(toAppend, profileConfig)
	}

	if len(toAppend) == 0 {
		return nil
	}

	f, err := os.OpenFile(configPath, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("opening %s: %w", configPath, err)
	}
	defer f.Close()

	// Ensure we start on a new line
	if len(content) > 0 && !strings.HasSuffix(string(content), "\n") {
		if _, err := f.WriteString("\n"); err != nil {
			return err
		}
	}

	for _, block := range toAppend {
		if _, err := f.WriteString("\n" + block + "\n"); err != nil {
			return err
		}
	}

	return nil
}

// containsSection checks if an AWS config file contains a [section] header.
func containsSection(content, section string) bool {
	target := "[" + section + "]"
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) == target {
			return true
		}
	}
	return false
}
