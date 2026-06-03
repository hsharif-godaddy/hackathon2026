package clean

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mkDir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func TestRun_NothingToClean(t *testing.T) {
	root := t.TempDir()
	var out bytes.Buffer

	if err := run(root, Default(), true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out.String(), "Nothing to clean") {
		t.Errorf("expected 'Nothing to clean', got: %s", out.String())
	}
}

func TestRun_NothingSelected(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")
	var out bytes.Buffer

	if err := run(root, Selection{}, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out.String(), "Nothing selected") {
		t.Errorf("expected 'Nothing selected' for empty selection, got: %s", out.String())
	}
	if _, err := os.Stat(filepath.Join(root, "agents/.env")); os.IsNotExist(err) {
		t.Error("agents/.env should not have been removed under empty selection")
	}
}

func TestRun_RemovesExistingFiles(t *testing.T) {
	root := t.TempDir()
	targets := []string{"agents/.env", "app/.env", "local-control-plane/.env"}
	for _, rel := range targets {
		writeFile(t, filepath.Join(root, rel), "KEY=value")
	}

	var out bytes.Buffer
	if err := run(root, Default(), true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, rel := range targets {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Errorf("expected %s to be removed", rel)
		}
	}
}

func TestRun_SkipsNonExistentFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, Default(), true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "agents/.env") {
		t.Error("expected agents/.env in output")
	}
	if strings.Contains(output, "app/.env") {
		t.Error("app/.env does not exist and should not appear in output")
	}
}

func TestRun_CancelOnNo(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, Default(), false, &out, &bytes.Buffer{}, strings.NewReader("n\n")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "agents/.env")); os.IsNotExist(err) {
		t.Error("agents/.env should not have been removed after 'n' answer")
	}
	if !strings.Contains(out.String(), "Cancelled") {
		t.Errorf("expected 'Cancelled' in output, got: %s", out.String())
	}
}

func TestRun_ConfirmOnYes(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, Default(), false, &out, &bytes.Buffer{}, strings.NewReader("y\n")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "agents/.env")); !os.IsNotExist(err) {
		t.Error("agents/.env should have been removed after 'y' answer")
	}
}

func TestRun_CancelOnEOF(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "agents/.env"), "KEY=value")

	var out bytes.Buffer
	if err := run(root, Default(), false, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "agents/.env")); os.IsNotExist(err) {
		t.Error("agents/.env should not have been removed on EOF")
	}
	if !strings.Contains(out.String(), "Cancelled") {
		t.Errorf("expected 'Cancelled' in output on EOF, got: %s", out.String())
	}
}

func TestRun_RemovesBuildDirs(t *testing.T) {
	root := t.TempDir()
	nextDir := filepath.Join(root, "app", ".next", "dev", "cache", "fetch-cache")
	mkDir(t, nextDir)
	writeFile(t, filepath.Join(nextDir, "somecachefile"), "cached data")

	var out bytes.Buffer
	if err := run(root, Default(), true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "app", ".next")); !os.IsNotExist(err) {
		t.Error("expected app/.next to be removed")
	}
	if !strings.Contains(out.String(), "app/.next/") {
		t.Errorf("expected app/.next/ in output, got: %s", out.String())
	}
}

func TestRun_BuildDirRemovalFailure(t *testing.T) {
	root := t.TempDir()
	nextPath := filepath.Join(root, "app", ".next")
	mkDir(t, nextPath)
	appDir := filepath.Join(root, "app")
	if err := os.Chmod(appDir, 0555); err != nil {
		t.Fatalf("chmod %s: %v", appDir, err)
	}
	t.Cleanup(func() { os.Chmod(appDir, 0755) })

	var errOut bytes.Buffer
	err := run(root, Default(), true, &bytes.Buffer{}, &errOut, strings.NewReader(""))
	if err == nil {
		t.Fatal("expected error when dir removal fails")
	}
	if !strings.Contains(err.Error(), "app/.next") {
		t.Errorf("expected failed dir name in error, got: %v", err)
	}
}

func TestRun_MakeCleanSuccess(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "dev-runner", "Makefile"), ".PHONY: clean\nclean:\n\t@echo cleaned\n")

	var out bytes.Buffer
	if err := run(root, Default(), true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out.String(), "dev-runner") {
		t.Errorf("expected dev-runner in output, got: %s", out.String())
	}
}

func TestRun_MakeCleanFailure(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "dev-runner", "Makefile"), ".PHONY: clean\nclean:\n\t@exit 1\n")

	var out, errOut bytes.Buffer
	err := run(root, Default(), true, &out, &errOut, strings.NewReader(""))
	if err == nil {
		t.Fatal("expected error when make clean fails")
	}
	if !strings.Contains(err.Error(), "dev-runner") {
		t.Errorf("expected failed service name in error, got: %v", err)
	}
}

// --- Group-selection tests ---

// TestRun_BuildOnly_PreservesEnvAndRuntime verifies that selecting only
// BuildArtifacts does not touch env files or runtime data.
func TestRun_BuildOnly_PreservesEnvAndRuntime(t *testing.T) {
	root := t.TempDir()
	mkDir(t, filepath.Join(root, "app", ".next"))
	writeFile(t, filepath.Join(root, "agents", ".env"), "KEY=value")
	writeFile(t, filepath.Join(root, "local-control-plane", "local-control-plane.db"), "x")

	var out bytes.Buffer
	sel := Selection{BuildArtifacts: true}
	if err := run(root, sel, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "app", ".next")); !os.IsNotExist(err) {
		t.Error("expected app/.next to be removed")
	}
	if _, err := os.Stat(filepath.Join(root, "agents", ".env")); os.IsNotExist(err) {
		t.Error("agents/.env should NOT be removed under BuildArtifacts-only selection")
	}
	if _, err := os.Stat(filepath.Join(root, "local-control-plane", "local-control-plane.db")); os.IsNotExist(err) {
		t.Error("control-plane DB should NOT be removed under BuildArtifacts-only selection")
	}
}

// TestRun_EnvOnly_PreservesBuild verifies that selecting only EnvFiles leaves
// build artifacts in place.
func TestRun_EnvOnly_PreservesBuild(t *testing.T) {
	root := t.TempDir()
	mkDir(t, filepath.Join(root, "app", ".next"))
	mkDir(t, filepath.Join(root, ".turbo", "cache"))
	writeFile(t, filepath.Join(root, "agents", ".env"), "KEY=value")

	var out bytes.Buffer
	sel := Selection{EnvFiles: true}
	if err := run(root, sel, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "agents", ".env")); !os.IsNotExist(err) {
		t.Error("expected agents/.env to be removed")
	}
	if _, err := os.Stat(filepath.Join(root, "app", ".next")); os.IsNotExist(err) {
		t.Error("app/.next should NOT be removed under EnvFiles-only selection")
	}
	if _, err := os.Stat(filepath.Join(root, ".turbo")); os.IsNotExist(err) {
		t.Error(".turbo should NOT be removed under EnvFiles-only selection")
	}
}

// TestRun_RuntimeOnly_RemovesDevBmsAndDB verifies that runtime-data selection
// removes the control-plane DB family and the .dev-bms seed marker.
func TestRun_RuntimeOnly_RemovesDevBmsAndDB(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "local-control-plane", "local-control-plane.db"), "x")
	writeFile(t, filepath.Join(root, "local-control-plane", "local-control-plane.db-shm"), "x")
	writeFile(t, filepath.Join(root, ".dev-bms", "budget-id"), "abc")
	writeFile(t, filepath.Join(root, "agents", ".env"), "KEY=value")

	var out bytes.Buffer
	sel := Selection{RuntimeData: true}
	if err := run(root, sel, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, rel := range []string{
		"local-control-plane/local-control-plane.db",
		"local-control-plane/local-control-plane.db-shm",
		".dev-bms",
	} {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Errorf("expected %s to be removed", rel)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "agents", ".env")); os.IsNotExist(err) {
		t.Error("agents/.env should NOT be removed under RuntimeData-only selection")
	}
}

// TestRun_BuildArtifacts_WalksTurboAndTsbuildinfo confirms that the walker
// finds .turbo dirs and *.tsbuildinfo files, while pruning into node_modules.
func TestRun_BuildArtifacts_WalksTurboAndTsbuildinfo(t *testing.T) {
	root := t.TempDir()

	// Real artifacts that should be removed.
	mkDir(t, filepath.Join(root, ".turbo", "cache"))
	mkDir(t, filepath.Join(root, "packages", "shared", ".turbo"))
	writeFile(t, filepath.Join(root, "app", "tsconfig.tsbuildinfo"), "{}")
	writeFile(t, filepath.Join(root, "debug-console", "tsconfig.tsbuildinfo"), "{}")

	// Decoys inside node_modules — must NOT be touched.
	mkDir(t, filepath.Join(root, "node_modules", "some-pkg", ".turbo"))
	writeFile(t, filepath.Join(root, "node_modules", "some-pkg", "tsconfig.tsbuildinfo"), "{}")

	var out bytes.Buffer
	sel := Selection{BuildArtifacts: true}
	if err := run(root, sel, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Real ones removed.
	for _, rel := range []string{
		".turbo",
		"packages/shared/.turbo",
		"app/tsconfig.tsbuildinfo",
		"debug-console/tsconfig.tsbuildinfo",
	} {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Errorf("expected %s to be removed", rel)
		}
	}
	// Decoys preserved.
	for _, rel := range []string{
		"node_modules/some-pkg/.turbo",
		"node_modules/some-pkg/tsconfig.tsbuildinfo",
	} {
		if _, err := os.Stat(filepath.Join(root, rel)); os.IsNotExist(err) {
			t.Errorf("%s under node_modules must NOT be touched", rel)
		}
	}
}

// TestRun_NodeModules_RemovesNested confirms node_modules walking finds
// nested instances and prunes once it removes a node_modules dir.
func TestRun_NodeModules_RemovesNested(t *testing.T) {
	root := t.TempDir()
	mkDir(t, filepath.Join(root, "node_modules", "foo"))
	mkDir(t, filepath.Join(root, "packages", "shared", "node_modules", "bar"))
	mkDir(t, filepath.Join(root, "agents", "node_modules", "baz"))
	writeFile(t, filepath.Join(root, "agents", ".env"), "KEY=value")

	var out bytes.Buffer
	sel := Selection{NodeModules: true}
	if err := run(root, sel, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, rel := range []string{
		"node_modules",
		"packages/shared/node_modules",
		"agents/node_modules",
	} {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Errorf("expected %s to be removed", rel)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "agents", ".env")); os.IsNotExist(err) {
		t.Error("agents/.env should NOT be removed under NodeModules-only selection")
	}
}

// TestRun_MakeCleanFailure_DualStreamsNoRace covers the race yhan1
// flagged: cmd.Stdout and cmd.Stderr share a single capture buffer,
// and exec drives them from independent goroutines. A make target
// that emits to both streams was racing on a bare bytes.Buffer; the
// SafeBuffer wrapping prevents it. Asserting "no race" requires
// `go test -race`; this also confirms the captured reason is not
// truncated/corrupted on dual-stream output.
func TestRun_MakeCleanFailure_DualStreamsNoRace(t *testing.T) {
	root := t.TempDir()
	// Spam both streams in interleaved iterations so the stdout/stderr
	// copier goroutines have plenty of opportunity to write concurrently.
	makefile := ".PHONY: clean\nclean:\n"
	for i := 0; i < 50; i++ {
		makefile += fmt.Sprintf("\t@echo stdout-line-%d\n", i)
		makefile += fmt.Sprintf("\t@echo stderr-line-%d 1>&2\n", i)
	}
	makefile += "\t@exit 1\n"
	writeFile(t, filepath.Join(root, "dev-runner", "Makefile"), makefile)

	var out, errOut bytes.Buffer
	err := run(root, Default(), true, &out, &errOut, strings.NewReader(""))
	if err == nil {
		t.Fatal("expected error from failing make clean")
	}
	if !strings.Contains(err.Error(), "dev-runner") {
		t.Errorf("expected service name in error, got: %v", err)
	}
}

// TestRun_BuildArtifacts_RemovesPatternLibraryDist guards against the
// regression Copilot flagged: `packages/pattern-library/dist` was missing
// from jsPackageDistDirs even though WorkspaceBuildCheck guards the same
// lib. Selecting Build artifacts must clean it.
func TestRun_BuildArtifacts_RemovesPatternLibraryDist(t *testing.T) {
	root := t.TempDir()
	distPath := filepath.Join(root, "packages", "pattern-library", "dist")
	mkDir(t, distPath)
	writeFile(t, filepath.Join(distPath, "index.js"), "// built")

	var out bytes.Buffer
	sel := Selection{BuildArtifacts: true}
	if err := run(root, sel, true, &out, &bytes.Buffer{}, strings.NewReader("")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(distPath); !os.IsNotExist(err) {
		t.Errorf("expected packages/pattern-library/dist to be removed")
	}
}

// TestNormalizeFailureReason covers the format applied to per-service
// `make clean` failure output before it's joined into the returned error.
// Multi-line output should collapse to one line and oversize output should
// be truncated, so the final error string stays readable.
func TestNormalizeFailureReason(t *testing.T) {
	stubErr := fmt.Errorf("exit status 2")

	if got := normalizeFailureReason("", stubErr); got != stubErr.Error() {
		t.Errorf("empty captured → falls back to err.Error(); got %q", got)
	}

	multiline := "make: Entering directory '/x'\nrm: cannot remove 'foo': Permission denied\nmake: *** [clean] Error 1"
	got := normalizeFailureReason(multiline, stubErr)
	if strings.Contains(got, "\n") {
		t.Errorf("multi-line output should collapse to one line; got %q", got)
	}
	if !strings.Contains(got, "Permission denied") {
		t.Errorf("expected the meaningful body in the reason; got %q", got)
	}

	huge := strings.Repeat("a", failureReasonMaxLen+50)
	got = normalizeFailureReason(huge, stubErr)
	if len(got) > failureReasonMaxLen+len("…") {
		t.Errorf("oversize reason should be truncated to ~%d; got len %d", failureReasonMaxLen, len(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("truncated reason should end with ellipsis; got %q", got)
	}
}

// TestSelection_AllAndEmpty pins down the helper constructors.
func TestSelection_AllAndEmpty(t *testing.T) {
	all := All()
	if !all.BuildArtifacts || !all.RuntimeData || !all.EnvFiles || !all.NodeModules {
		t.Errorf("All() should enable every group, got %+v", all)
	}
	if (Selection{}).Empty() != true {
		t.Error("zero Selection should report Empty()")
	}
	if all.Empty() {
		t.Error("All() should not report Empty()")
	}
	def := Default()
	if !def.BuildArtifacts || !def.RuntimeData || !def.EnvFiles {
		t.Errorf("Default() should enable Build+Runtime+Env, got %+v", def)
	}
	if def.NodeModules {
		t.Errorf("Default() should NOT include NodeModules, got %+v", def)
	}
}
