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
	defaultAWSProfile = "airobuild-dev-private-sso"
	ssoSessionName    = "airo-sso"
	ssoStartURL       = "https://d-9267a7c4d5.awsapps.com/start/#"
	ssoSessionConfig  = `[sso-session airo-sso]
sso_start_url = https://d-9267a7c4d5.awsapps.com/start/#
sso_region = us-west-2
sso_registration_scopes = sso:account:access`
)

// profileConfig builds the default profile block, referencing the given
// sso-session by name.
func profileConfig(sessionName string) string {
	return fmt.Sprintf(`[profile %s]
sso_session = %s
sso_account_id = 694282668781
sso_role_name = PowerUser
region = us-west-2
output = json`, defaultAWSProfile, sessionName)
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

	// Profile already present: assume its session exists, change nothing.
	if containsSection(string(content), "profile "+profile) {
		return nil
	}

	// We can only auto-create the default profile. A custom profile that's
	// missing is left for the login command to report.
	if profile != defaultAWSProfile {
		return nil
	}

	var toAppend []string

	// Reuse an existing session pointing at our start URL, else create airo-sso.
	sessionName, found := findReusableSSOSession(string(content))
	if !found {
		sessionName = ssoSessionName
		toAppend = append(toAppend, ssoSessionConfig)
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

// findReusableSSOSession scans the config for an existing [sso-session NAME]
// block whose sso_start_url matches the non-PCI SSO portal, returning its name.
// Matching is on the start URL only — the session can be named anything.
func findReusableSSOSession(content string) (name string, found bool) {
	var (
		curName  string
		inTarget bool
	)
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			header := strings.TrimSpace(line[1 : len(line)-1])
			if rest, ok := strings.CutPrefix(header, "sso-session "); ok {
				curName = strings.TrimSpace(rest)
				inTarget = curName != ""
			} else {
				curName = ""
				inTarget = false
			}
			continue
		}

		if !inTarget {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(key) != "sso_start_url" {
			continue
		}
		if normalizeStartURL(value) == normalizeStartURL(ssoStartURL) {
			return curName, true
		}
	}
	return "", false
}

// normalizeStartURL trims trailing "#" and "/" so cosmetic URL differences
// (e.g. a missing trailing "#") still compare equal.
func normalizeStartURL(url string) string {
	return strings.TrimRight(strings.TrimSpace(url), "#/")
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
