package fixers

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/jfrog"
)

// GoProxyFixer configures the Go toolchain to fetch private gdcorp modules
// through GoDaddy's Artifactory Go virtual repo.
//
// It requires a JFrog identity token. The token is preferentially sourced
// from ~/.npmrc (refreshed by ArtifactoryFixer earlier in the fix queue);
// if unavailable, it falls back to a TUI form field.
//
// The token is persisted via `go env -w` so it survives across shells.
type GoProxyFixer struct {
	token string
}

func (f *GoProxyFixer) FormFields() []preflight.FormField {
	if npmrcToken() != "" {
		return nil
	}
	return []preflight.FormField{
		{
			Key:         "token",
			Label:       "JFrog Identity Token",
			Description: "Generate at: https://gdartifactory1.jfrog.io/ui/user_profile",
			Required:    true,
			Password:    true,
		},
	}
}

// npmrcToken returns the current Artifactory token from ~/.npmrc, or "".
func npmrcToken() string {
	token, _ := jfrog.TokenFromNpmrc()
	return token
}

func (f *GoProxyFixer) SetFormValues(values map[string]string) {
	f.token = strings.TrimSpace(values["token"])
}

// Fix always rewrites GOPROXY with the freshest token available. When the
// previous GOPROXY URL already pointed at Artifactory, rewriting is still
// necessary to replace an expired/revoked embedded JWT with a new one.
func (f *GoProxyFixer) Fix(ctx context.Context, _ string) error {
	if f.token == "" {
		// Call TokenFromNpmrc directly (not the discarding helper) so an
		// *unreadable* ~/.npmrc surfaces as an actionable error instead
		// of looping the user through pnpm login, which can't help when
		// the file itself is e.g. chmod 000. A *missing* file is fine --
		// the user just hasn't logged in yet, and the fallthrough below
		// will tell them so.
		token, err := jfrog.TokenFromNpmrc()
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("could not read ~/.npmrc: %w", err)
		}
		f.token = token
	}
	if f.token == "" {
		return fmt.Errorf("no Artifactory token available (run pnpm login first)")
	}

	proxyURL := fmt.Sprintf("https://:%s@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct", f.token)
	if err := setGoEnv(ctx, "GOPROXY", proxyURL); err != nil {
		return fmt.Errorf("failed to set GOPROXY: %w", err)
	}

	return f.setAuxVars(ctx)
}

func (f *GoProxyFixer) setAuxVars(ctx context.Context) error {
	if err := setGoEnv(ctx, "GONOPROXY", "none"); err != nil {
		return fmt.Errorf("failed to set GONOPROXY: %w", err)
	}
	if err := setGoEnv(ctx, "GONOSUMDB", "github.com/gdcorp-*"); err != nil {
		return fmt.Errorf("failed to set GONOSUMDB: %w", err)
	}

	// Best-effort read: if `go env GOPRIVATE` errors here, the three
	// setGoEnv calls above would have already failed and returned, so by
	// the time we reach this line `go` is known to be invokable. Treat
	// any error as "GOPRIVATE not set" -- the worst case is leaving a
	// pre-existing GOPRIVATE alone, which the proxy vars above override.
	currentPrivate, _ := exec.CommandContext(ctx, "go", "env", "GOPRIVATE").Output()
	if strings.Contains(string(currentPrivate), "gdcorp-") {
		if err := unsetGoEnv(ctx, "GOPRIVATE"); err != nil {
			return fmt.Errorf("failed to unset GOPRIVATE: %w", err)
		}
	}

	return nil
}

// setGoEnv persists key=value via `go env -w` AND mirrors it into this
// process's env. Mirroring is critical: if the user has GOPROXY exported
// from their shell rc, that env var takes precedence over the GOENV file
// for all `go env <KEY>` subprocess calls. Without updating our own env,
// the post-fix re-verify would keep seeing the stale value and loop.
// Mirrored vars are also inherited by any service dev-runner spawns.
func setGoEnv(ctx context.Context, key, value string) error {
	if err := exec.CommandContext(ctx, "go", "env", "-w", key+"="+value).Run(); err != nil {
		return err
	}
	return os.Setenv(key, value)
}

func unsetGoEnv(ctx context.Context, key string) error {
	if err := exec.CommandContext(ctx, "go", "env", "-u", key).Run(); err != nil {
		return err
	}
	return os.Unsetenv(key)
}
