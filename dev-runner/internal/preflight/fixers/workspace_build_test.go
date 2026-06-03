package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeWorkspace mirrors the helper in the checks package — set up a minimal
// monorepo structure so the fixer's call into checks.DevDistPackageNames has
// something to walk. Tests here only care that the fixer ends up exec-ing
// the right `pnpm` invocation.
func writeManifest(t *testing.T, root, rel, body string) {
	t.Helper()
	path := filepath.Join(root, rel, "package.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

const fixerAppManifest = `{
  "name": "website",
  "dependencies": { "@airo-ux/pattern-library": "workspace:^", "@airo/shared": "workspace:^" }
}`
const fixerAgentsManifest = `{"name": "@airo/agents"}`
const fixerLibManifest = `{
  "name": "%s",
  "main": "./dist/index.js",
  "scripts": { "build": "tsup" }
}`

func setUpFakeWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeManifest(t, root, "app", fixerAppManifest)
	writeManifest(t, root, "agents", fixerAgentsManifest)
	writeManifest(t, root, "packages/pattern-library", strings.ReplaceAll(fixerLibManifest, "%s", "@airo-ux/pattern-library"))
	writeManifest(t, root, "packages/shared", strings.ReplaceAll(fixerLibManifest, "%s", "@airo/shared"))
	// Pretend node_modules exists so EnsurePnpmInstall is a no-op.
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

func installFakePnpm(t *testing.T, recordPath, scriptBody string) {
	t.Helper()
	bin := t.TempDir()
	pnpmFake := filepath.Join(bin, "pnpm")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >>\"" + recordPath + "\"\n" + scriptBody
	if err := os.WriteFile(pnpmFake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// TestWorkspaceBuildFixer_RunsScopedTurbo asserts the fixer drives
// `pnpm exec turbo run build` with one --filter per closure package
// (sorted), rather than the unscoped `pnpm build` it used to run.
func TestWorkspaceBuildFixer_RunsScopedTurbo(t *testing.T) {
	root := setUpFakeWorkspace(t)
	record := filepath.Join(t.TempDir(), "record.txt")
	installFakePnpm(t, record, "exit 0\n")

	if err := (&WorkspaceBuildFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	got, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	line := strings.TrimSpace(string(got))
	want := "exec turbo run build --filter=@airo-ux/pattern-library --filter=@airo/shared"
	if line != want {
		t.Fatalf("recorded pnpm args = %q, want %q", line, want)
	}
}

// TestWorkspaceBuildFixer_RunsPnpmInstallWhenMissing asserts that when
// node_modules is absent (preflight runs before the install hook), the
// fixer runs `pnpm install` first so turbo is resolvable.
func TestWorkspaceBuildFixer_RunsPnpmInstallWhenMissing(t *testing.T) {
	// Same workspace structure but WITHOUT node_modules.
	root := t.TempDir()
	writeManifest(t, root, "app", fixerAppManifest)
	writeManifest(t, root, "agents", fixerAgentsManifest)
	writeManifest(t, root, "packages/shared", strings.ReplaceAll(fixerLibManifest, "%s", "@airo/shared"))

	record := filepath.Join(t.TempDir(), "record.txt")
	installFakePnpm(t, record, "exit 0\n")

	if err := (&WorkspaceBuildFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	got, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(got)), "\n")
	if len(lines) < 2 || lines[0] != "install" {
		t.Fatalf("expected `pnpm install` first; got: %v", lines)
	}
	if !strings.HasPrefix(lines[1], "exec turbo run build") {
		t.Fatalf("expected `pnpm exec turbo run build ...` second; got: %q", lines[1])
	}
}

// TestWorkspaceBuildFixer_NoOpWhenNoPackages covers a stripped-down
// scaffold where neither app/ nor agents/ declare workspace deps — the
// fixer should exit cleanly without exec-ing anything.
func TestWorkspaceBuildFixer_NoOpWhenNoPackages(t *testing.T) {
	root := t.TempDir()
	writeManifest(t, root, "app", `{"name": "website"}`)
	writeManifest(t, root, "agents", `{"name": "@airo/agents"}`)
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}

	record := filepath.Join(t.TempDir(), "record.txt")
	// pnpm should never run; if it does, fail loudly.
	installFakePnpm(t, record, "echo unexpected pnpm invocation >&2\nexit 1\n")

	if err := (&WorkspaceBuildFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix: %v", err)
	}
	if data, err := os.ReadFile(record); err == nil && len(data) > 0 {
		t.Fatalf("expected no pnpm invocation; got: %s", data)
	}
}

// TestWorkspaceBuildFixer_SurfacesTurboOutput pins the error-output-
// embedding branch: a failing turbo build should embed its stderr in
// the returned error so the user sees what went wrong.
func TestWorkspaceBuildFixer_SurfacesTurboOutput(t *testing.T) {
	root := setUpFakeWorkspace(t)
	record := filepath.Join(t.TempDir(), "record.txt")
	const sentinel = "FAKE_TURBO_BUILD_FAILURE for test"
	installFakePnpm(t, record, "echo '"+sentinel+"' >&2\nexit 1\n")

	err := (&WorkspaceBuildFixer{}).Fix(context.Background(), root)
	if err == nil {
		t.Fatal("expected error from failing turbo build")
	}
	if !strings.Contains(err.Error(), sentinel) {
		t.Fatalf("error should embed turbo output; got: %v", err)
	}
}
