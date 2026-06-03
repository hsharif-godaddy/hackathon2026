package checks

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// fakeWorkspace lays down a minimal monorepo structure: app/agents service
// manifests + a packages/ directory the caller fills in. Returns the project
// root (a t.TempDir).
type fakeWorkspace struct {
	root string
	t    *testing.T
}

func newFakeWorkspace(t *testing.T) *fakeWorkspace {
	t.Helper()
	root := t.TempDir()
	return &fakeWorkspace{root: root, t: t}
}

func (w *fakeWorkspace) writePkg(rel, jsonBody string) {
	w.t.Helper()
	path := filepath.Join(w.root, rel, "package.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		w.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(jsonBody), 0o644); err != nil {
		w.t.Fatal(err)
	}
}

func (w *fakeWorkspace) populateDist(rel string) {
	w.t.Helper()
	dist := filepath.Join(w.root, rel, "dist")
	if err := os.MkdirAll(dist, 0o755); err != nil {
		w.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "index.js"), []byte("// built"), 0o644); err != nil {
		w.t.Fatal(err)
	}
}

// service / lib manifest snippets used across tests.
const (
	appManifest = `{
  "name": "website",
  "dependencies": {
    "@airo-ux/pattern-library": "workspace:^",
    "@airo/shared": "workspace:^"
  }
}`
	agentsManifest = `{
  "name": "@airo/agents",
  "dependencies": {
    "@airo/ai-lib": "workspace:^"
  }
}`
	libManifest = `{
  "name": "%s",
  "main": "./dist/index.js",
  "scripts": { "build": "tsup" }
}`
	transitiveLibManifest = `{
  "name": "%s",
  "main": "./dist/index.js",
  "scripts": { "build": "tsup" },
  "dependencies": { "%s": "workspace:^" }
}`
	noBuildLibManifest = `{
  "name": "%s",
  "main": "./eslint.config.js"
}`
	sourceLibManifest = `{
  "name": "%s",
  "main": "./src/index.ts",
  "scripts": { "build": "echo nothing" }
}`
)

func TestWorkspaceBuildCheck_AllBuilt(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", appManifest)
	w.writePkg("agents", agentsManifest)
	w.writePkg("packages/pattern-library", fmtLib("@airo-ux/pattern-library"))
	w.writePkg("packages/shared", fmtLib("@airo/shared"))
	w.writePkg("packages/ai-lib", fmtLib("@airo/ai-lib"))
	for _, rel := range []string{"packages/pattern-library", "packages/shared", "packages/ai-lib"} {
		w.populateDist(rel)
	}

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusPass {
		t.Errorf("expected pass; got %v: %s", res.Status, res.Message)
	}
}

func TestWorkspaceBuildCheck_AllMissing(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", appManifest)
	w.writePkg("agents", agentsManifest)
	w.writePkg("packages/pattern-library", fmtLib("@airo-ux/pattern-library"))
	w.writePkg("packages/shared", fmtLib("@airo/shared"))
	w.writePkg("packages/ai-lib", fmtLib("@airo/ai-lib"))

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusFail {
		t.Errorf("expected fail; got %v: %s", res.Status, res.Message)
	}
	if !res.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
	for _, name := range []string{"@airo-ux/pattern-library", "@airo/shared", "@airo/ai-lib"} {
		if !strings.Contains(res.Message, name) {
			t.Errorf("expected %q in message; got: %s", name, res.Message)
		}
	}
}

// TestWorkspaceBuildCheck_PartialMissing pins the per-lib failure messaging.
func TestWorkspaceBuildCheck_PartialMissing(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", appManifest)
	w.writePkg("agents", agentsManifest)
	w.writePkg("packages/pattern-library", fmtLib("@airo-ux/pattern-library"))
	w.writePkg("packages/shared", fmtLib("@airo/shared"))
	w.writePkg("packages/ai-lib", fmtLib("@airo/ai-lib"))
	w.populateDist("packages/shared")
	w.populateDist("packages/ai-lib")
	// pattern-library left unbuilt.

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusFail {
		t.Errorf("expected fail; got %v", res.Status)
	}
	if !strings.Contains(res.Message, "@airo-ux/pattern-library") {
		t.Errorf("expected pattern-library called out; got: %s", res.Message)
	}
	if strings.Contains(res.Message, "@airo/shared") {
		t.Errorf("@airo/shared was built; should not be in message: %s", res.Message)
	}
}

// TestWorkspaceBuildCheck_EmptyDistFails covers a half-built state where
// the dist directory exists but is empty (e.g. interrupted tsup, or
// `build:clean` ran but `build:js` didn't).
func TestWorkspaceBuildCheck_EmptyDistFails(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", appManifest)
	w.writePkg("agents", agentsManifest)
	w.writePkg("packages/shared", fmtLib("@airo/shared"))
	w.writePkg("packages/pattern-library", fmtLib("@airo-ux/pattern-library"))
	w.writePkg("packages/ai-lib", fmtLib("@airo/ai-lib"))
	if err := os.MkdirAll(filepath.Join(w.root, "packages/shared/dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	w.populateDist("packages/pattern-library")
	w.populateDist("packages/ai-lib")

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusFail {
		t.Errorf("empty dist should fail; got %v", res.Status)
	}
	if !strings.Contains(res.Message, "@airo/shared") {
		t.Errorf("expected @airo/shared called out; got: %s", res.Message)
	}
}

// TestWorkspaceBuildCheck_TransitiveDepInClosure asserts that a lib's
// workspace-dep is also tracked: app depends on pattern-library which
// depends on shared, so shared must be built even if app doesn't list
// it directly.
func TestWorkspaceBuildCheck_TransitiveDepInClosure(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", `{
  "name": "website",
  "dependencies": { "@airo-ux/pattern-library": "workspace:^" }
}`)
	w.writePkg("agents", `{"name": "@airo/agents"}`)
	w.writePkg("packages/pattern-library", fmtTransitiveLib("@airo-ux/pattern-library", "@airo/shared"))
	w.writePkg("packages/shared", fmtLib("@airo/shared"))
	// Both unbuilt.

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusFail {
		t.Errorf("expected fail; got %v", res.Status)
	}
	if !strings.Contains(res.Message, "@airo/shared") {
		t.Errorf("transitive dep @airo/shared should be in closure; got: %s", res.Message)
	}
}

// TestWorkspaceBuildCheck_PackageOutsideClosureIgnored asserts that a
// package not depended on by app/agents (e.g. design-extractor) doesn't
// trigger a build, even if its dist/ is missing.
func TestWorkspaceBuildCheck_PackageOutsideClosureIgnored(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", `{
  "name": "website",
  "dependencies": { "@airo/shared": "workspace:^" }
}`)
	w.writePkg("agents", `{"name": "@airo/agents"}`)
	w.writePkg("packages/shared", fmtLib("@airo/shared"))
	w.writePkg("packages/design-extractor", fmtLib("@airo/design-extractor"))
	w.populateDist("packages/shared")
	// design-extractor unbuilt — should NOT trigger failure since neither
	// service depends on it.

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusPass {
		t.Errorf("expected pass (out-of-closure pkg ignored); got %v: %s", res.Status, res.Message)
	}
}

// TestWorkspaceBuildCheck_PackageWithoutBuildScriptIgnored covers
// config-only packages like eslint-config-airo: no build script means no
// dist/, so they don't belong in the check even if app depends on them.
func TestWorkspaceBuildCheck_PackageWithoutBuildScriptIgnored(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", `{
  "name": "website",
  "devDependencies": { "@airo/eslint-config": "workspace:^" }
}`)
	w.writePkg("agents", `{"name": "@airo/agents"}`)
	w.writePkg("packages/eslint-config-airo", fmtNoBuildLib("@airo/eslint-config"))

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusPass {
		t.Errorf("expected pass (no-build-script pkg ignored); got %v: %s", res.Status, res.Message)
	}
}

// TestWorkspaceBuildCheck_SourceConsumedPackageIgnored covers packages
// whose entry points don't reference dist/ (consumed from source). They
// have a build script but the check shouldn't demand a dist/ for them.
func TestWorkspaceBuildCheck_SourceConsumedPackageIgnored(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", `{
  "name": "website",
  "dependencies": { "@airo/source-only": "workspace:^" }
}`)
	w.writePkg("agents", `{"name": "@airo/agents"}`)
	w.writePkg("packages/source-only", fmtSourceLib("@airo/source-only"))

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), w.root)
	if res.Status != preflight.StatusPass {
		t.Errorf("expected pass (source-consumed pkg ignored); got %v: %s", res.Status, res.Message)
	}
}

// TestDevDistPackageNames pins what the fixer will build — sorted closure.
func TestDevDistPackageNames(t *testing.T) {
	w := newFakeWorkspace(t)
	w.writePkg("app", appManifest)
	w.writePkg("agents", agentsManifest)
	w.writePkg("packages/pattern-library", fmtLib("@airo-ux/pattern-library"))
	w.writePkg("packages/shared", fmtLib("@airo/shared"))
	w.writePkg("packages/ai-lib", fmtLib("@airo/ai-lib"))
	w.writePkg("packages/design-extractor", fmtLib("@airo/design-extractor")) // out of closure

	got, err := DevDistPackageNames(w.root)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"@airo-ux/pattern-library", "@airo/ai-lib", "@airo/shared"}
	if len(got) != len(want) {
		t.Fatalf("DevDistPackageNames = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("DevDistPackageNames[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestWorkspaceBuildCheck_NoPackagesDirNoOp asserts the check degrades
// gracefully when the standard monorepo layout is absent (e.g. running in
// a stripped-down test scaffold).
func TestWorkspaceBuildCheck_NoPackagesDirNoOp(t *testing.T) {
	root := t.TempDir() // no packages/, app/, or agents/

	res := (&WorkspaceBuildCheck{}).Run(context.Background(), root)
	if res.Status != preflight.StatusPass {
		t.Errorf("expected pass on empty tree; got %v: %s", res.Status, res.Message)
	}
}

// helpers — keep test bodies readable.

func fmtLib(name string) string {
	return strings.ReplaceAll(libManifest, "%s", name)
}

func fmtTransitiveLib(name, dep string) string {
	out := strings.Replace(transitiveLibManifest, "%s", name, 1)
	out = strings.Replace(out, "%s", dep, 1)
	return out
}

func fmtNoBuildLib(name string) string {
	return strings.ReplaceAll(noBuildLibManifest, "%s", name)
}

func fmtSourceLib(name string) string {
	return strings.ReplaceAll(sourceLibManifest, "%s", name)
}
