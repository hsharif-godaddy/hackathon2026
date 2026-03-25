package allocconfig

import (
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
)

// MigrateTaskConfig moves a task-specific config file from the shared Nomad alloc directory
// to the task-local directory and creates a symlink back. In unified Nomad jobs, each task
// (preview, publish) gets its own {taskName}-config.json in NOMAD_ALLOC_DIR. This must run
// before any code that reads NOMAD_ALLOC_DIR/config.json (e.g. Loader).
//
// The alloc-dir symlink is first-writer-wins: if another task already created it, the
// existing symlink is left in place. This differs from the original shell scripts which
// used ln -sf (last-writer-wins), but is safe because each task reads its own
// NOMAD_TASK_DIR/config.json — the alloc-dir symlink is only a convenience fallback.
//
// Uses copy+delete instead of rename because /alloc and /local are typically
// separate volume mounts (different filesystems) in Docker/Nomad.
//
// No-op when any of the required Nomad env vars are unset (normal in local dev)
// or the task config file is absent.
// Failures are logged but non-fatal to avoid crashing the supervisor.
func MigrateTaskConfig() {
	taskName := os.Getenv("NOMAD_TASK_NAME")
	allocDir := os.Getenv("NOMAD_ALLOC_DIR")
	taskDir := os.Getenv("NOMAD_TASK_DIR")

	if taskName == "" || allocDir == "" || taskDir == "" {
		slog.Debug("task_config.skip",
			"NOMAD_TASK_NAME", taskName,
			"NOMAD_ALLOC_DIR", allocDir,
			"NOMAD_TASK_DIR", taskDir)
		return
	}

	src := filepath.Join(allocDir, taskName+"-config.json")
	dst := filepath.Join(taskDir, "config.json")
	link := filepath.Join(allocDir, "config.json")

	data, err := os.ReadFile(src)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			slog.Debug("task_config.not_found", "source", src, "task_name", taskName)
		} else {
			slog.Warn("task_config.read_failed", "source", src, "error", err)
		}
		return
	}

	if err := os.WriteFile(dst, data, 0600); err != nil {
		slog.Warn("task_config.write_failed", "dest", dst, "error", err)
		return
	}

	if err := os.Remove(src); err != nil {
		slog.Warn("task_config.remove_source_failed", "source", src, "error", err)
	}

	// Best-effort symlink — if the other task already created it, that's fine.
	// Each task's own NOMAD_TASK_DIR/config.json is what matters.
	if err := os.Symlink(dst, link); err != nil {
		if !errors.Is(err, fs.ErrExist) {
			slog.Warn("task_config.symlink_failed", "target", dst, "link", link, "error", err)
			slog.Info("task_config.moved_without_symlink", "source", src, "dest", dst)
			return
		}
	}

	slog.Info("task_config.migrated", "source", src, "dest", dst, "symlink", link)
}
