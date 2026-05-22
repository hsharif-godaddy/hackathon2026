package fixers

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/jfrog"
)

// ArtifactoryFixer authenticates with GoDaddy Artifactory and ensures the
// resulting ~/.npmrc auth entry is broad enough to cover every jfrog npm
// repo, not just the specific one pnpm login targeted.
//
// Two modes:
//   - If ~/.npmrc already has a token but scoped to a single repo path
//     (e.g. .../api/npm/node-virt/), rewrite the prefix in place to
//     .../api/npm/. Non-interactive, finishes instantly.
//   - Otherwise run `pnpm login` against jfrog.NpmLoginRegistry (node-virt;
//     the broad /api/npm/ URL does not complete web login), then rewrite the
//     new token to jfrog.NpmScopePrefix. Interactive -- needs terminal passthrough.
//
// NeedsTerminal stays true: we can't cheaply predict which path Fix will
// take without reading the file twice, and falsely suspending the TUI for
// the non-interactive path is harmless.
type ArtifactoryFixer struct{}

func (f *ArtifactoryFixer) NeedsTerminal() bool { return true }

func (f *ArtifactoryFixer) Fix(ctx context.Context, projectRoot string) error {
	rewrote, err := broadenNpmrcScope()
	if err != nil {
		return err
	}
	if rewrote {
		return nil
	}
	if err := RunCommandPassthrough(ctx, projectRoot, "pnpm", "login", "--registry", jfrog.NpmLoginRegistry, "--auth-type", "web"); err != nil {
		return err
	}
	_, err = broadenNpmrcScope()
	return err
}

// broadenNpmrcScope rewrites any jfrog npm auth entries in ~/.npmrc whose
// URL prefix is narrower than jfrog.NpmScopePrefix. Returns (true, nil) if
// the file was modified; (false, nil) if nothing to do or the file is
// absent.
func broadenNpmrcScope() (bool, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return false, err
	}
	path := filepath.Join(home, ".npmrc")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	out, changed := rewriteNarrowNpmEntries(string(data))
	if !changed {
		return false, nil
	}
	mode := os.FileMode(0o600)
	if info, statErr := os.Stat(path); statErr == nil {
		mode = info.Mode().Perm()
	}
	return true, os.WriteFile(path, []byte(out), mode)
}

func rewriteNarrowNpmEntries(content string) (string, bool) {
	lines := strings.Split(content, "\n")
	changed := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, ";") {
			continue
		}
		head, tail, ok := strings.Cut(trimmed, ":_authToken=")
		if !ok || tail == "" {
			continue
		}
		prefix := strings.TrimSpace(head)
		if !jfrog.IsNarrowNpmPrefix(prefix) {
			continue
		}
		lines[i] = jfrog.NpmScopePrefix + ":_authToken=" + tail
		changed = true
	}
	return strings.Join(lines, "\n"), changed
}
