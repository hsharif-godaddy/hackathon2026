package allocconfig_test

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
)

func TestMigrateTaskConfig_NoopWhenEnvMissing(t *testing.T) {
	t.Run("NOMAD_TASK_NAME unset", func(t *testing.T) {
		t.Setenv("NOMAD_TASK_NAME", "")
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		t.Setenv("NOMAD_TASK_DIR", "/local")

		allocconfig.MigrateTaskConfig()
	})

	t.Run("NOMAD_ALLOC_DIR unset", func(t *testing.T) {
		t.Setenv("NOMAD_TASK_NAME", "preview")
		t.Setenv("NOMAD_ALLOC_DIR", "")
		t.Setenv("NOMAD_TASK_DIR", "/local")

		allocconfig.MigrateTaskConfig()
	})

	t.Run("NOMAD_TASK_DIR unset", func(t *testing.T) {
		t.Setenv("NOMAD_TASK_NAME", "preview")
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		t.Setenv("NOMAD_TASK_DIR", "")

		allocconfig.MigrateTaskConfig()
	})
}

func TestMigrateTaskConfig_NoopWhenSourceMissing(t *testing.T) {
	allocDir := t.TempDir()
	taskDir := t.TempDir()

	t.Setenv("NOMAD_TASK_NAME", "preview")
	t.Setenv("NOMAD_ALLOC_DIR", allocDir)
	t.Setenv("NOMAD_TASK_DIR", taskDir)

	allocconfig.MigrateTaskConfig()

	if _, err := os.Stat(filepath.Join(taskDir, "config.json")); !errors.Is(err, fs.ErrNotExist) {
		t.Error("config.json should not exist in task dir")
	}
	if _, err := os.Stat(filepath.Join(allocDir, "config.json")); !errors.Is(err, fs.ErrNotExist) {
		t.Error("config.json should not exist in alloc dir")
	}
}

func TestMigrateTaskConfig_Preview(t *testing.T) {
	allocDir := t.TempDir()
	taskDir := t.TempDir()

	t.Setenv("NOMAD_TASK_NAME", "preview")
	t.Setenv("NOMAD_ALLOC_DIR", allocDir)
	t.Setenv("NOMAD_TASK_DIR", taskDir)

	srcPath := filepath.Join(allocDir, "preview-config.json")
	if err := os.WriteFile(srcPath, []byte(`{"DATABASE":{}}`), 0600); err != nil {
		t.Fatalf("failed to write source config: %v", err)
	}

	allocconfig.MigrateTaskConfig()

	if _, err := os.Stat(srcPath); !errors.Is(err, fs.ErrNotExist) {
		t.Error("source config should have been moved")
	}

	dst := filepath.Join(taskDir, "config.json")
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("failed to read dest config: %v", err)
	}
	if string(data) != `{"DATABASE":{}}` {
		t.Errorf("dest content = %q, want %q", string(data), `{"DATABASE":{}}`)
	}

	link := filepath.Join(allocDir, "config.json")
	target, err := os.Readlink(link)
	if err != nil {
		t.Fatalf("failed to read symlink: %v", err)
	}
	if target != dst {
		t.Errorf("symlink target = %q, want %q", target, dst)
	}
}

func TestMigrateTaskConfig_Publish(t *testing.T) {
	allocDir := t.TempDir()
	taskDir := t.TempDir()

	t.Setenv("NOMAD_TASK_NAME", "publish")
	t.Setenv("NOMAD_ALLOC_DIR", allocDir)
	t.Setenv("NOMAD_TASK_DIR", taskDir)

	srcPath := filepath.Join(allocDir, "publish-config.json")
	if err := os.WriteFile(srcPath, []byte(`{"JWT_REDIRECT_URL":{}}`), 0600); err != nil {
		t.Fatalf("failed to write source config: %v", err)
	}

	allocconfig.MigrateTaskConfig()

	if _, err := os.Stat(srcPath); !errors.Is(err, fs.ErrNotExist) {
		t.Error("source config should have been moved")
	}

	dst := filepath.Join(taskDir, "config.json")
	if _, err := os.Stat(dst); err != nil {
		t.Fatalf("dest config should exist: %v", err)
	}

	link := filepath.Join(allocDir, "config.json")
	target, err := os.Readlink(link)
	if err != nil {
		t.Fatalf("failed to read symlink: %v", err)
	}
	if target != dst {
		t.Errorf("symlink target = %q, want %q", target, dst)
	}
}

func TestMigrateTaskConfig_SymlinkAlreadyExists(t *testing.T) {
	allocDir := t.TempDir()
	taskDir := t.TempDir()

	t.Setenv("NOMAD_TASK_NAME", "publish")
	t.Setenv("NOMAD_ALLOC_DIR", allocDir)
	t.Setenv("NOMAD_TASK_DIR", taskDir)

	// Pre-create symlink (as if preview task already ran)
	link := filepath.Join(allocDir, "config.json")
	if err := os.Symlink("/some/other/config.json", link); err != nil {
		t.Fatalf("failed to create pre-existing symlink: %v", err)
	}

	srcPath := filepath.Join(allocDir, "publish-config.json")
	if err := os.WriteFile(srcPath, []byte(`{}`), 0600); err != nil {
		t.Fatalf("failed to write source config: %v", err)
	}

	allocconfig.MigrateTaskConfig()

	dst := filepath.Join(taskDir, "config.json")
	if _, err := os.Stat(dst); err != nil {
		t.Fatalf("dest config should exist: %v", err)
	}

	// Pre-existing symlink should remain (first-writer-wins)
	target, err := os.Readlink(link)
	if err != nil {
		t.Fatalf("symlink should still exist: %v", err)
	}
	if target != "/some/other/config.json" {
		t.Errorf("symlink should not have been replaced, got target %q", target)
	}
}

func TestMigrateTaskConfig_WriteFails(t *testing.T) {
	allocDir := t.TempDir()

	t.Setenv("NOMAD_TASK_NAME", "preview")
	t.Setenv("NOMAD_ALLOC_DIR", allocDir)
	t.Setenv("NOMAD_TASK_DIR", filepath.Join(allocDir, "missing-task-dir"))

	srcPath := filepath.Join(allocDir, "preview-config.json")
	if err := os.WriteFile(srcPath, []byte(`{}`), 0600); err != nil {
		t.Fatalf("failed to write source config: %v", err)
	}

	allocconfig.MigrateTaskConfig()

	if _, err := os.Stat(srcPath); err != nil {
		t.Error("source config should still exist after failed write")
	}
}

func TestMigrateTaskConfig_ReadFailsNonErrNotExist(t *testing.T) {
	allocDir := t.TempDir()
	taskDir := t.TempDir()

	t.Setenv("NOMAD_TASK_NAME", "preview")
	t.Setenv("NOMAD_ALLOC_DIR", allocDir)
	t.Setenv("NOMAD_TASK_DIR", taskDir)

	// Symlink loop: os.ReadFile follows symlinks and returns ELOOP (not ErrNotExist)
	srcPath := filepath.Join(allocDir, "preview-config.json")
	if err := os.Symlink(srcPath, srcPath); err != nil {
		t.Fatalf("failed to create symlink loop: %v", err)
	}

	allocconfig.MigrateTaskConfig()

	if _, err := os.Stat(filepath.Join(taskDir, "config.json")); !errors.Is(err, fs.ErrNotExist) {
		t.Error("config.json should not exist in task dir")
	}
}
