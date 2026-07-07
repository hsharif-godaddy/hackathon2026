package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/awsconfig"
)

// profileConfig builds the default profile block, referencing the given
// sso-session by name.
func profileConfig(sessionName string) string {
	return fmt.Sprintf(`[profile %s]
sso_session = %s
sso_account_id = %s
sso_role_name = %s
region = us-west-2
output = json`, awsconfig.DefaultProfile, sessionName, awsconfig.SSOAccountID, awsconfig.ExpectedRoleName)
}

// AWSSSOFixer triggers an AWS SSO login and waits for credentials to become valid.
type AWSSSOFixer struct {
	// Profile is the AWS CLI profile to use. Defaults to "airobuild-dev-private-sso".
	Profile string
}

func (f *AWSSSOFixer) profile() string {
	if f.Profile != "" {
		return f.Profile
	}
	return awsconfig.DefaultProfile
}

func (f *AWSSSOFixer) Fix(ctx context.Context, projectRoot string) error {
	profile := f.profile()

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

// ensureAWSConfig makes sure ~/.aws/config has a usable profile for SSO login.
//
// If the profile already exists we leave the config untouched: its referenced
// sso-session is assumed to exist (the AWS CLI will surface a clear error on
// login if it doesn't), so there's no need to append a duplicate session.
//
// If the profile is missing, we only know how to create the default one. When
// creating it we reuse an existing sso-session that already points at our SSO
// start URL (so a user who has set one up under their own name keeps a single
// session), and only fall back to creating the airo-sso session when none
// matches.
func ensureAWSConfig(profile string) error {
	configPath, err := awsconfig.ConfigPath()
	if err != nil {
		return fmt.Errorf("getting config path: %w", err)
	}

	// Ensure ~/.aws/ directory exists
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		return fmt.Errorf("creating ~/.aws/: %w", err)
	}

	content, err := os.ReadFile(configPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("reading %s: %w", configPath, err)
	}

	// Profile already present: assume its session exists, change nothing.
	if awsconfig.SectionExists(string(content), "profile "+profile) {
		return nil
	}

	// We can only auto-create the default profile. A custom profile that's
	// missing is left for the login command to report.
	if profile != awsconfig.DefaultProfile {
		return nil
	}

	var toAppend []string

	// Reuse an existing session pointing at our start URL, else create airo-sso.
	sessionName, found := awsconfig.FindSSOSessionByStartURL(string(content), awsconfig.SSOStartURL)
	if !found {
		sessionName = awsconfig.SSOSessionName
		toAppend = append(toAppend, awsconfig.SSOSessionConfig())
	}
	toAppend = append(toAppend, profileConfig(sessionName))

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
