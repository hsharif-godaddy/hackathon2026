package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
)

// E2EFixer mirrors scripts/setup-e2e.sh:
//  1. pnpm install (if node_modules missing)
//  2. pnpm exec playwright install
//  3. write tests/.env with E2E_USERNAME/E2E_PASSWORD (mode 0600), if needed
//  4. smoke-test by listing project=e2e
//
// FormFields() returns the credential prompts only when tests/.env doesn't
// already have a recognised pair — otherwise the TUI skips the form and goes
// straight to Fix(), so re-runs that only need the browser install don't
// re-prompt for credentials we already have.
//
// ProjectRoot must be set by the caller (mirrors PortsFixer/EnvFixer pattern
// where construction-time config is wired in buildPreflightRunner). FormFields
// runs before Fix() gets projectRoot, so it can't ask the framework for it.
type E2EFixer struct {
	ProjectRoot string

	username string
	password string
}

func (f *E2EFixer) FormFields() []preflight.FormField {
	// readErr is non-nil only when tests/.env exists but is unreadable
	// (file present + permission denied or similar). Surface it in the
	// form description so the user understands why they're being asked
	// for credentials again rather than thinking the previous fix was
	// silently ignored. Fix() will re-encounter the same error and
	// surface it to the framework if the read still fails on retry.
	var readErr error
	if f.ProjectRoot != "" {
		hasCreds, err := checks.HasE2ECredentialPair(filepath.Join(f.ProjectRoot, "tests", ".env"))
		if err == nil && hasCreds {
			return nil
		}
		readErr = err
	}
	usernameDesc := "Your own GoDaddy SSO account. It must exist in the target env (PLAYWRIGHT_ENV, default: test) and have enough Airo AI Builder credits to run the scenarios."
	if readErr != nil {
		usernameDesc = fmt.Sprintf("Could not read existing tests/.env (%v). Re-enter credentials below.", readErr)
	}
	return []preflight.FormField{
		{
			Key:         "username",
			Label:       "E2E SSO username",
			Description: usernameDesc,
			Placeholder: "someone@example.com",
			Required:    true,
		},
		{
			Key:      "password",
			Label:    "E2E SSO password",
			Required: true,
			Password: true,
		},
	}
}

func (f *E2EFixer) SetFormValues(values map[string]string) {
	f.username = strings.TrimSpace(values["username"])
	f.password = values["password"]
}

func (f *E2EFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := os.Stat(filepath.Join(projectRoot, "node_modules")); os.IsNotExist(err) {
		if _, err := RunCommand(ctx, projectRoot, "pnpm", "install"); err != nil {
			return fmt.Errorf("pnpm install: %w", err)
		}
	}

	hasBrowsers, err := checks.PlaywrightBrowsersInstalled()
	if err != nil {
		return fmt.Errorf("locating Playwright cache: %w", err)
	}
	if !hasBrowsers {
		if _, err := RunCommand(ctx, projectRoot, "pnpm", "exec", "playwright", "install"); err != nil {
			return fmt.Errorf("playwright install: %w", err)
		}
	}

	// Re-check creds at write time rather than blindly trusting the form
	// values. The preflight runner reuses fixer instances across attempts,
	// so a second Fix() call (e.g., re-verify after another fixer ran) could
	// otherwise re-write/append credentials that are already on disk.
	envPath := filepath.Join(projectRoot, "tests", ".env")
	hasCreds, err := checks.HasE2ECredentialPair(envPath)
	if err != nil {
		return fmt.Errorf("checking tests/.env: %w", err)
	}
	if !hasCreds {
		if f.username == "" || f.password == "" {
			// Without this, Fix() returns nil with no creds written. The
			// verify pass re-runs E2ECheck (which still fails), the user is
			// offered the same fix, and the cycle repeats with no
			// explanation. Surface it as an error so the framework reports
			// the failure instead of silently looping.
			return fmt.Errorf("tests/.env has no E2E credentials and the form did not provide both fields; re-open the fixer and enter username and password")
		}
		if err := f.writeCredentials(projectRoot); err != nil {
			return err
		}
		// Clear the in-memory password as soon as it's been persisted, so it
		// doesn't sit in the long-lived TUI process any longer than needed.
		f.username = ""
		f.password = ""
	}

	// Same gate as setup-e2e.sh:171: surface tsconfig / config errors before
	// telling the user setup is done.
	if _, err := RunCommand(ctx, projectRoot, "pnpm", "exec", "playwright", "test", "--list", "--project=e2e"); err != nil {
		return fmt.Errorf("playwright config verification failed: %w", err)
	}

	return nil
}

// writeCredentials appends E2E_USERNAME/E2E_PASSWORD to tests/.env at mode 0600.
// Existing content is preserved (so an env file with TEST_* or DEV_* pairs
// keeps them) and backed up before mutation. dotenv has no in-band escape for
// single quotes, so we reject values containing one rather than corrupt the
// file silently — matches scripts/setup-e2e.sh:117-119.
func (f *E2EFixer) writeCredentials(projectRoot string) error {
	if strings.ContainsRune(f.username, '\'') || strings.ContainsRune(f.password, '\'') {
		return fmt.Errorf("E2E credentials cannot contain a single quote (dotenv has no escape); edit tests/.env manually")
	}

	envPath := filepath.Join(projectRoot, "tests", ".env")
	if err := os.MkdirAll(filepath.Dir(envPath), 0755); err != nil {
		return fmt.Errorf("creating tests dir: %w", err)
	}

	existing, err := os.ReadFile(envPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("reading tests/.env: %w", err)
	}

	if len(existing) > 0 {
		backup := envPath + ".bak"
		if err := os.WriteFile(backup, existing, 0600); err != nil {
			return fmt.Errorf("backing up tests/.env: %w", err)
		}
	}

	// Strip any pre-existing E2E_USERNAME/E2E_PASSWORD assignments before
	// appending fresh ones. Without this, a re-run leaves duplicate keys in
	// the file and dotenv parsers vary on which value wins, making effective
	// credentials unpredictable. Other prefixes (TEST_*, DEV_*, …) are left
	// alone — the caller wants those preserved.
	filtered := stripEnvKeys(string(existing), "E2E_USERNAME", "E2E_PASSWORD")
	var b strings.Builder
	b.WriteString(filtered)
	if len(filtered) > 0 && filtered[len(filtered)-1] != '\n' {
		b.WriteByte('\n')
	}
	fmt.Fprintf(&b, "E2E_USERNAME='%s'\n", f.username)
	fmt.Fprintf(&b, "E2E_PASSWORD='%s'\n", f.password)

	// Write at mode 0600 to keep credentials off the umask=0644 default.
	// O_TRUNC is needed because the existing file may be longer than what we
	// produce when the user re-runs the fixer (re-writing the same creds).
	file, err := os.OpenFile(envPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("opening tests/.env: %w", err)
	}
	defer file.Close()
	if _, err := file.WriteString(b.String()); err != nil {
		return fmt.Errorf("writing tests/.env: %w", err)
	}
	// Re-chmod in case the file existed with looser perms and OpenFile reused
	// them (mode arg is only honored on creation).
	if err := os.Chmod(envPath, 0600); err != nil {
		return fmt.Errorf("chmod tests/.env: %w", err)
	}
	return nil
}

// stripEnvKeys returns content with any line whose trimmed prefix is one of
// the given `KEY=` assignments removed. Comments and unrelated keys pass
// through unchanged. Trailing newline structure is preserved so the caller's
// append logic stays simple.
func stripEnvKeys(content string, keys ...string) string {
	if content == "" || len(keys) == 0 {
		return content
	}
	prefixes := make([]string, len(keys))
	for i, k := range keys {
		prefixes[i] = k + "="
	}
	lines := strings.Split(content, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimLeft(line, " \t")
		drop := false
		for _, p := range prefixes {
			if strings.HasPrefix(trimmed, p) {
				drop = true
				break
			}
		}
		if !drop {
			out = append(out, line)
		}
	}
	return strings.Join(out, "\n")
}
