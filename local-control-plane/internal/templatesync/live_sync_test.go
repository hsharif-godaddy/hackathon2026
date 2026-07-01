package templatesync

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

type recordedCall struct {
	name string
	args []string
}

func TestConfigFromEnvUsesExistingDefaults(t *testing.T) {
	t.Setenv("APP_TEMPLATE_DIR", "")
	t.Setenv("PROJECT_ROOT", "")
	t.Setenv("APPS_BASE_DIR", "")

	cfg := configFromEnv()
	if cfg.appsBaseDir != defaultAppsBaseDir {
		t.Fatalf("apps base default = %q, want %q", cfg.appsBaseDir, defaultAppsBaseDir)
	}
	if cfg.templateDir != filepath.Join(defaultProjectRoot, "app-templates", "v8") {
		t.Fatalf("template default = %q", cfg.templateDir)
	}

	t.Setenv("PROJECT_ROOT", "/repo")
	cfg = configFromEnv()
	if cfg.templateDir != filepath.Join("/repo", "app-templates", "v8") {
		t.Fatalf("template from PROJECT_ROOT = %q", cfg.templateDir)
	}

	t.Setenv("APP_TEMPLATE_DIR", "/template")
	t.Setenv("APPS_BASE_DIR", "/apps")
	cfg = configFromEnv()
	if cfg.templateDir != "/template" {
		t.Fatalf("template from APP_TEMPLATE_DIR = %q", cfg.templateDir)
	}
	if cfg.appsBaseDir != "/apps" {
		t.Fatalf("apps base from env = %q", cfg.appsBaseDir)
	}
}

func TestDiscoverPreviewRoots(t *testing.T) {
	appsBase := t.TempDir()
	mustMkdir(t, filepath.Join(appsBase, "app-b", "preview"))
	mustMkdir(t, filepath.Join(appsBase, "app-a", "preview"))
	mustMkdir(t, filepath.Join(appsBase, "publish-only", "publish"))
	mustWriteFile(t, filepath.Join(appsBase, "file"), "ignored")

	got, err := discoverPreviewRoots(appsBase)
	if err != nil {
		t.Fatalf("discover previews: %v", err)
	}

	want := []string{
		filepath.Join(appsBase, "app-a", "preview"),
		filepath.Join(appsBase, "app-b", "preview"),
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("preview roots = %#v, want %#v", got, want)
	}
}

func TestDiscoverPreviewRootsRejectsUnsafeBaseDir(t *testing.T) {
	if _, err := discoverPreviewRoots(""); err == nil {
		t.Fatalf("empty apps base should be rejected")
	}
	if _, err := discoverPreviewRoots(string(os.PathSeparator)); err == nil {
		t.Fatalf("root apps base should be rejected")
	}
	homeDir, err := os.UserHomeDir()
	if err == nil && homeDir != "" {
		if _, err := discoverPreviewRoots(homeDir); err == nil {
			t.Fatalf("home apps base should be rejected")
		}
	}
}

func TestDiscoverPreviewRootsRejectsSymlinkPreviewRoot(t *testing.T) {
	appsBase := t.TempDir()
	target := t.TempDir()
	mustMkdir(t, filepath.Join(appsBase, "app"))
	if err := os.Symlink(target, filepath.Join(appsBase, "app", "preview")); err != nil {
		t.Fatalf("symlink preview root: %v", err)
	}

	got, err := discoverPreviewRoots(appsBase)
	if err != nil {
		t.Fatalf("discover previews: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("symlink preview roots = %#v, want none", got)
	}
}

func TestSourceStampIgnoresGeneratedFolders(t *testing.T) {
	source := t.TempDir()
	generatedFile := filepath.Join(source, "node_modules", "pkg", "index.js")
	mustWriteFile(t, filepath.Join(source, "tracked.txt"), "tracked")
	mustWriteFile(t, generatedFile, "before")

	old := time.Now().Add(-time.Hour).Round(0)
	mustChtimes(t, filepath.Join(source, "tracked.txt"), old)
	mustChtimes(t, filepath.Join(source, "node_modules"), old)
	mustChtimes(t, source, old)

	before, err := sourceStamp(source, defaultExcludes)
	if err != nil {
		t.Fatalf("source stamp before: %v", err)
	}

	mustWriteFile(t, generatedFile, "after")
	after, err := sourceStamp(source, defaultExcludes)
	if err != nil {
		t.Fatalf("source stamp after: %v", err)
	}
	if !after.Equal(before) {
		t.Fatalf("generated folder changed stamp: before=%s after=%s", before, after)
	}
}

func TestSourceStampIgnoresGeneratedFolderRootCreation(t *testing.T) {
	source := t.TempDir()
	old := time.Now().Add(-time.Hour).Round(0)
	mustWriteFile(t, filepath.Join(source, "tracked.txt"), "tracked")
	mustChtimes(t, filepath.Join(source, "tracked.txt"), old)
	mustChtimes(t, source, old)

	before, err := sourceStamp(source, defaultExcludes)
	if err != nil {
		t.Fatalf("source stamp before: %v", err)
	}

	time.Sleep(10 * time.Millisecond)
	if err := os.Mkdir(filepath.Join(source, ".vite"), 0o755); err != nil {
		t.Fatalf("mkdir generated folder: %v", err)
	}

	after, err := sourceStamp(source, defaultExcludes)
	if err != nil {
		t.Fatalf("source stamp after: %v", err)
	}
	if !after.Equal(before) {
		t.Fatalf("generated root folder creation changed stamp: before=%s after=%s", before, after)
	}
}

func TestSourceStampChangesWhenRootLevelFileDeletedWithSibling(t *testing.T) {
	source := t.TempDir()
	old := time.Now().Add(-time.Hour).Round(0)
	deletedPath := filepath.Join(source, "deleted.txt")
	siblingPath := filepath.Join(source, "sibling.txt")
	mustWriteFile(t, deletedPath, "delete me")
	mustWriteFile(t, siblingPath, "keep me")
	mustChtimes(t, deletedPath, old)
	mustChtimes(t, siblingPath, old)
	mustChtimes(t, source, old)

	before, err := sourceStamp(source, defaultExcludes)
	if err != nil {
		t.Fatalf("source stamp before: %v", err)
	}

	time.Sleep(10 * time.Millisecond)
	if err := os.Remove(deletedPath); err != nil {
		t.Fatalf("remove root file: %v", err)
	}

	after, err := sourceStamp(source, defaultExcludes)
	if err != nil {
		t.Fatalf("source stamp after: %v", err)
	}
	if after.Equal(before) {
		t.Fatalf("root-level deletion did not change stamp: %s", after)
	}
	if _, err := os.Stat(siblingPath); err != nil {
		t.Fatalf("sibling should remain: %v", err)
	}
}

func TestSyncFoldersRunsRsyncForEachPreview(t *testing.T) {
	appsBase := t.TempDir()
	templateDir := t.TempDir()
	mustMkdir(t, filepath.Join(templateDir, "dev-tools"))
	mustMkdir(t, filepath.Join(appsBase, "app-a", "preview"))
	mustMkdir(t, filepath.Join(appsBase, "app-b", "preview"))

	var calls []recordedCall
	s := newSyncer(config{
		appsBaseDir: appsBase,
		templateDir: templateDir,
		folders:     []string{"dev-tools"},
		excludes:    defaultExcludes,
		run: func(_ context.Context, name string, args ...string) error {
			calls = append(calls, recordedCall{name: name, args: slices.Clone(args)})
			return nil
		},
	}, testLogger())

	if err := s.syncFolder(context.Background(), "dev-tools"); err != nil {
		t.Fatalf("sync folder: %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("calls = %d, want 2", len(calls))
	}
	for _, call := range calls {
		if call.name != "rsync" {
			t.Fatalf("command = %q, want rsync", call.name)
		}
		joined := strings.Join(call.args, " ")
		for _, want := range []string{"-a", "--delete", "--exclude node_modules", "--exclude dist", "--exclude .turbo", "--exclude .vite"} {
			if !strings.Contains(joined, want) {
				t.Fatalf("args %q missing %q", joined, want)
			}
		}
		if !strings.HasSuffix(call.args[len(call.args)-2], string(os.PathSeparator)) {
			t.Fatalf("source lacks trailing separator: %#v", call.args)
		}
		if !strings.HasSuffix(call.args[len(call.args)-1], string(os.PathSeparator)) {
			t.Fatalf("destination lacks trailing separator: %#v", call.args)
		}
	}
}

func TestSyncFolderRejectsSymlinkDestinationWithoutRsync(t *testing.T) {
	appsBase := t.TempDir()
	templateDir := t.TempDir()
	target := t.TempDir()
	mustMkdir(t, filepath.Join(templateDir, "dev-tools"))
	previewRoot := filepath.Join(appsBase, "app", "preview")
	mustMkdir(t, previewRoot)
	if err := os.Symlink(target, filepath.Join(previewRoot, "dev-tools")); err != nil {
		t.Fatalf("symlink destination: %v", err)
	}

	calls := 0
	s := newSyncer(config{
		appsBaseDir: appsBase,
		templateDir: templateDir,
		folders:     []string{"dev-tools"},
		excludes:    defaultExcludes,
		run: func(_ context.Context, _ string, _ ...string) error {
			calls++
			return nil
		},
	}, testLogger())

	if err := s.syncFolder(context.Background(), "dev-tools"); err == nil {
		t.Fatalf("sync folder should reject symlink destination")
	}
	if calls != 0 {
		t.Fatalf("rsync calls = %d, want 0", calls)
	}
}

func TestSyncFolderNormalizesGitStateForSyncedFolder(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}

	appsBase := t.TempDir()
	appBase := filepath.Join(appsBase, "app")
	previewRoot := filepath.Join(appBase, "preview")
	gitDir := filepath.Join(appBase, "git-repo", ".git")
	mustMkdir(t, filepath.Dir(gitDir))

	runGit(t, "", "init", "--initial-branch=main", "--separate-git-dir", gitDir, previewRoot)
	runGit(t, previewRoot, "config", "user.email", "ai@airo.dev")
	runGit(t, previewRoot, "config", "user.name", "Airo AI Builder")
	mustWriteFile(t, filepath.Join(previewRoot, "dev-tools", "mutated.txt"), "old")
	mustWriteFile(t, filepath.Join(previewRoot, "dev-tools", "deleted.txt"), "old")
	runGit(t, previewRoot, "add", "dev-tools")
	runGit(t, previewRoot, "commit", "-m", "initial")

	if err := os.Remove(filepath.Join(previewRoot, ".git")); err != nil {
		t.Fatalf("remove preview gitfile: %v", err)
	}
	mustMkdir(t, filepath.Join(previewRoot, ".git", "info"))

	templateDir := t.TempDir()
	mustMkdir(t, filepath.Join(templateDir, "dev-tools"))
	s := newSyncer(config{
		appsBaseDir: appsBase,
		templateDir: templateDir,
		folders:     []string{"dev-tools"},
		excludes:    defaultExcludes,
		run: func(_ context.Context, _ string, _ ...string) error {
			mustWriteFile(t, filepath.Join(previewRoot, "dev-tools", "mutated.txt"), "new")
			if err := os.Remove(filepath.Join(previewRoot, "dev-tools", "deleted.txt")); err != nil {
				t.Fatalf("delete tracked file: %v", err)
			}
			mustWriteFile(t, filepath.Join(previewRoot, "dev-tools", "new.txt"), "new")
			return nil
		},
	}, testLogger())

	if err := s.syncFolder(context.Background(), "dev-tools"); err != nil {
		t.Fatalf("sync folder: %v", err)
	}

	status := runGitOutput(t, "", "--git-dir", gitDir, "--work-tree", previewRoot, "status", "--short", "--untracked-files=all")
	if strings.TrimSpace(status) != "" {
		t.Fatalf("git status = %q, want clean", status)
	}

	exclude, err := os.ReadFile(filepath.Join(gitDir, "info", "exclude"))
	if err != nil {
		t.Fatalf("read exclude: %v", err)
	}
	if !strings.Contains(string(exclude), "/dev-tools/") {
		t.Fatalf("exclude missing synced folder: %q", exclude)
	}
}

func TestInitialSyncRunsBeforeFutureChanges(t *testing.T) {
	appsBase := t.TempDir()
	templateDir := t.TempDir()
	mustMkdir(t, filepath.Join(templateDir, "dev-tools"))
	mustMkdir(t, filepath.Join(templateDir, "source-mapper"))
	mustMkdir(t, filepath.Join(appsBase, "app", "preview"))

	var calls []recordedCall
	s := newSyncer(config{
		appsBaseDir: appsBase,
		templateDir: templateDir,
		folders:     defaultFolders,
		excludes:    defaultExcludes,
		run: func(_ context.Context, name string, args ...string) error {
			calls = append(calls, recordedCall{name: name, args: slices.Clone(args)})
			return nil
		},
	}, testLogger())

	if err := s.syncOnce(context.Background()); err != nil {
		t.Fatalf("initial sync: %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("initial sync calls = %d, want 2", len(calls))
	}
}

func TestFailedSyncRetriesNextCycle(t *testing.T) {
	appsBase := t.TempDir()
	templateDir := t.TempDir()
	mustMkdir(t, filepath.Join(templateDir, "dev-tools"))
	mustMkdir(t, filepath.Join(appsBase, "app", "preview"))

	calls := 0
	s := newSyncer(config{
		appsBaseDir: appsBase,
		templateDir: templateDir,
		folders:     []string{"dev-tools"},
		excludes:    defaultExcludes,
		run: func(_ context.Context, _ string, _ ...string) error {
			calls++
			if calls == 1 {
				return os.ErrPermission
			}
			return nil
		},
	}, testLogger())

	if err := s.syncOnce(context.Background()); err == nil {
		t.Fatalf("first sync should fail")
	}
	if _, ok := s.last["dev-tools"]; ok {
		t.Fatalf("failed sync advanced last-clean stamp")
	}
	if err := s.syncOnce(context.Background()); err != nil {
		t.Fatalf("retry sync: %v", err)
	}
	if calls != 2 {
		t.Fatalf("calls after retry = %d, want 2", calls)
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir parent %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mustChtimes(t *testing.T, path string, when time.Time) {
	t.Helper()
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatalf("chtimes %s: %v", path, err)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	_ = runGitOutput(t, dir, args...)
}

func runGitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return string(output)
}
