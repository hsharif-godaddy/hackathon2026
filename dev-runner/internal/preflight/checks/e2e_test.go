package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestHasE2ECredentialPair(t *testing.T) {
	tests := []struct {
		name     string
		contents string
		want     bool
	}{
		{
			name:     "missing file",
			contents: "",
			want:     false,
		},
		{
			name:     "E2E pair",
			contents: "E2E_USERNAME=alice@example.com\nE2E_PASSWORD=hunter2\n",
			want:     true,
		},
		{
			name:     "TEST pair",
			contents: "TEST_USERNAME=bob\nTEST_PASSWORD=pw\n",
			want:     true,
		},
		{
			name:     "PRE_TEST pair",
			contents: "PRE_TEST_USERNAME=u\nPRE_TEST_PASSWORD=p\n",
			want:     true,
		},
		{
			name:     "username only",
			contents: "E2E_USERNAME=alice@example.com\n",
			want:     false,
		},
		{
			name:     "password only",
			contents: "E2E_PASSWORD=hunter2\n",
			want:     false,
		},
		{
			name:     "username with whitespace value",
			contents: "E2E_USERNAME=   \nE2E_PASSWORD=pw\n",
			want:     false,
		},
		{
			name:     "single-quoted values",
			contents: "E2E_USERNAME='alice@example.com'\nE2E_PASSWORD='hunter#2'\n",
			want:     true,
		},
		{
			name:     "unrecognised prefix only",
			contents: "FOO_USERNAME=u\nFOO_PASSWORD=p\n",
			want:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, ".env")
			if tt.contents != "" {
				if err := os.WriteFile(path, []byte(tt.contents), 0600); err != nil {
					t.Fatalf("write env file: %v", err)
				}
			}

			got, err := HasE2ECredentialPair(path)
			if err != nil {
				t.Fatalf("HasE2ECredentialPair: %v", err)
			}
			if got != tt.want {
				t.Errorf("HasE2ECredentialPair(%q) = %v, want %v", tt.contents, got, tt.want)
			}
		})
	}
}

func TestE2ECheck_Run(t *testing.T) {
	// We can't easily fake the Playwright cache without monkey-patching
	// os.UserCacheDir, so this test only validates the credential branch by
	// running against a temp project root with a controlled tests/.env.
	// Whatever the local Playwright install state is, it's the same across
	// branches so we assert FailAvailable presence/absence rather than the
	// exact message.
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tests"), 0755); err != nil {
		t.Fatal(err)
	}

	// Case 1: no env file, no creds → fail with FixAvailable.
	res := (&E2ECheck{}).Run(context.Background(), dir)
	if res.Status != preflight.StatusFail {
		t.Errorf("no env: status = %v, want fail", res.Status)
	}
	if !res.FixAvailable {
		t.Errorf("no env: FixAvailable = false, want true")
	}

	// Case 2: env file with creds — message must mention browsers if those
	// are the remaining failure, or pass if both are fine.
	if err := os.WriteFile(filepath.Join(dir, "tests", ".env"),
		[]byte("E2E_USERNAME=u\nE2E_PASSWORD=p\n"), 0600); err != nil {
		t.Fatal(err)
	}
	hasBrowsers, _ := PlaywrightBrowsersInstalled()
	res = (&E2ECheck{}).Run(context.Background(), dir)
	switch {
	case hasBrowsers && res.Status != preflight.StatusPass:
		t.Errorf("creds + browsers: status = %v, want pass (msg: %q)", res.Status, res.Message)
	case !hasBrowsers && res.Status != preflight.StatusFail:
		t.Errorf("creds, no browsers: status = %v, want fail", res.Status)
	}
}
