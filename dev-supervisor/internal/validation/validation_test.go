package validation_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

// --- Dangerous command tests ---

func TestValidateCommandRequest_DangerousCommands(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		cmd     string
		wantErr bool
	}{
		// Every pattern in isDangerousCommand (direct match)
		{name: "rm -rf /", cmd: "rm -rf /", wantErr: true},
		{name: "dd if=", cmd: "dd if=/dev/zero of=/dev/sda", wantErr: true},
		{name: "mkfs", cmd: "mkfs.ext4 /dev/sda1", wantErr: true},
		{name: "fdisk", cmd: "fdisk /dev/sda", wantErr: true},
		{name: "init 0 (halt)", cmd: "init 0", wantErr: true},
		{name: "init 6 (reboot)", cmd: "init 6", wantErr: true},
		{name: "kill -9 1 (kill init)", cmd: "kill -9 1", wantErr: true},
		{name: "killall -9", cmd: "killall -9", wantErr: true},
		{name: "fork bomb", cmd: ":(){ :|:& };:", wantErr: true},
		{name: "chmod -r 777 /", cmd: "chmod -r 777 /", wantErr: true},
		{name: "chown -r", cmd: "chown -r root:root /", wantErr: true},
		{name: "rm -rf --no-preserve-root", cmd: "rm -rf --no-preserve-root /", wantErr: true},

		// Case insensitivity (command is lowered before matching)
		{name: "chmod uppercase -R", cmd: "chmod -R 777 /", wantErr: true},
		{name: "chown uppercase -R", cmd: "chown -R root:root /app", wantErr: true},
		{name: "DD IF= uppercase", cmd: "DD IF=/dev/zero OF=/dev/sda", wantErr: true},
		{name: "MKFS uppercase", cmd: "MKFS.ext4 /dev/sda1", wantErr: true},
		{name: "RM -RF / uppercase", cmd: "RM -RF /", wantErr: true},

		// Embedded in longer commands (substring match)
		{name: "rm -rf / in pipeline", cmd: "echo foo && rm -rf /", wantErr: true},
		{name: "dd in subshell", cmd: "bash -c 'dd if=/dev/zero of=/dev/sda'", wantErr: true},
		{name: "killall in chain", cmd: "sleep 1; killall -9", wantErr: true},

		// Whitespace handling (trimmed before matching)
		{name: "leading whitespace", cmd: "  rm -rf /", wantErr: true},
		{name: "trailing whitespace", cmd: "rm -rf /  ", wantErr: true},

		// Word boundary: digit-ending patterns should not match longer numbers
		{name: "kill -9 1 at end of string", cmd: "kill -9 1", wantErr: true},
		{name: "kill -9 1 with space after", cmd: "kill -9 1 && echo done", wantErr: true},
		{name: "kill -9 1 not matching pid 12345", cmd: "kill -9 12345", wantErr: false},
		{name: "kill -9 1 not matching pid 100", cmd: "kill -9 100", wantErr: false},
		{name: "killall -9 not matching -99", cmd: "killall -99", wantErr: false},
		{name: "killall -9 with args", cmd: "killall -9 node", wantErr: true},
		{name: "init 0 not matching 05", cmd: "init 05", wantErr: false},
		{name: "init 6 not matching 64", cmd: "init 64", wantErr: false},

		// Safe commands that should NOT be blocked
		{name: "safe: ls", cmd: "ls -la", wantErr: false},
		{name: "safe: echo", cmd: "echo hello", wantErr: false},
		{name: "safe: npm start", cmd: "npm start", wantErr: false},
		{name: "safe: git log", cmd: "git log --oneline -10", wantErr: false},
		{name: "safe: grep pipe head", cmd: "grep -r pattern | head -20", wantErr: false},
		{name: "safe: rm file (not root)", cmd: "rm -rf ./build", wantErr: false},
		{name: "safe: chmod on file", cmd: "chmod 644 file.txt", wantErr: false},
		{name: "safe: chown on file", cmd: "chown node:node file.txt", wantErr: false},
		{name: "safe: init in path", cmd: "cat /app/init.js", wantErr: false},
		{name: "safe: empty command", cmd: "", wantErr: true}, // empty is rejected by ValidateCommandRequest
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validation.ValidateCommandRequest(validation.CommandRequest{
				Command: tt.cmd,
			})
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateCommandRequest(Command=%q) error = %v, wantErr %v", tt.cmd, err, tt.wantErr)
			}
		})
	}
}

// --- Working directory tests for CommandRequest (accepts relative paths) ---

func TestValidateCommandRequest_WorkingDir(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		dir     string
		wantErr bool
	}{
		// Relative paths (sent by agents TerminalTool)
		{name: "relative simple", dir: "src", wantErr: false},
		{name: "relative nested", dir: "src/pages/docs", wantErr: false},
		{name: "relative with dot prefix", dir: "./src", wantErr: false},
		{name: "single dot", dir: ".", wantErr: false},

		// Absolute paths (still accepted)
		{name: "absolute path", dir: "/tmp", wantErr: false},
		{name: "absolute nested", dir: "/app/src/pages", wantErr: false},

		// Rejected paths
		{name: "parent traversal", dir: "../invalid", wantErr: true},
		{name: "nested traversal", dir: "src/../etc", wantErr: true},
		{name: "absolute traversal", dir: "/app/../etc", wantErr: true},
		{name: "double dot in middle", dir: "src/../../etc/passwd", wantErr: true},
		{name: "null byte", dir: "src\x00evil", wantErr: true},
		{name: "null byte in absolute", dir: "/app\x00/evil", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validation.ValidateCommandRequest(validation.CommandRequest{
				Command:    "echo test",
				WorkingDir: tt.dir,
			})
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateCommandRequest(WorkingDir=%q) error = %v, wantErr %v", tt.dir, err, tt.wantErr)
			}
		})
	}
}

// --- Working directory tests for ProcessStartRequest (requires absolute paths) ---

func TestValidateProcessStartRequest_WorkingDir(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		dir     string
		wantErr bool
	}{
		// Valid absolute paths
		{name: "absolute root", dir: "/", wantErr: false},
		{name: "absolute app dir", dir: "/app", wantErr: false},
		{name: "absolute nested", dir: "/app/src/pages", wantErr: false},
		{name: "empty (optional)", dir: "", wantErr: false},

		// Rejected: relative paths (process start requires absolute)
		{name: "relative simple", dir: "src", wantErr: true},
		{name: "relative nested", dir: "src/pages", wantErr: true},
		{name: "relative dot prefix", dir: "./src", wantErr: true},
		{name: "single dot", dir: ".", wantErr: true},

		// Rejected: traversal
		{name: "absolute traversal", dir: "/app/../etc", wantErr: true},
		{name: "parent traversal", dir: "../etc", wantErr: true},

		// Rejected: null bytes
		{name: "null byte", dir: "/app\x00evil", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validation.ValidateProcessStartRequest(validation.ProcessStartRequest{
				Command:    "npm start",
				WorkingDir: tt.dir,
			})
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateProcessStartRequest(WorkingDir=%q) error = %v, wantErr %v", tt.dir, err, tt.wantErr)
			}
		})
	}
}

// --- File path validation tests ---

func TestValidateFilePath(t *testing.T) {
	t.Parallel()

	baseDir := "/app"

	tests := []struct {
		name     string
		path     string
		wantPath string
		wantErr  bool
	}{
		// Valid paths
		{name: "absolute within base", path: "/app/src/index.ts", wantPath: "/app/src/index.ts", wantErr: false},
		{name: "absolute base dir itself", path: "/app", wantPath: "/app", wantErr: false},
		{name: "relative path", path: "src/index.ts", wantPath: "/app/src/index.ts", wantErr: false},
		{name: "relative nested", path: "src/pages/home.tsx", wantPath: "/app/src/pages/home.tsx", wantErr: false},
		{name: "file in root of base", path: "package.json", wantPath: "/app/package.json", wantErr: false},
		{name: "double dots in filename", path: "foo..txt", wantPath: "/app/foo..txt", wantErr: false},
		{
			name:     "double dots in dir name",
			path:     "dir..name/file.txt",
			wantPath: "/app/dir..name/file.txt",
			wantErr:  false,
		},

		// Rejected: empty
		{name: "empty string", path: "", wantErr: true},
		{name: "whitespace only", path: "   ", wantErr: true},

		// Rejected: null bytes
		{name: "null byte", path: "src\x00evil", wantErr: true},
		{name: "null byte in absolute", path: "/app/src\x00evil", wantErr: true},

		// Rejected: traversal
		{name: "parent traversal", path: "../etc/passwd", wantErr: true},
		{name: "nested traversal", path: "src/../../etc/passwd", wantErr: true},
		{name: "double dot only", path: "..", wantErr: true},
		{name: "traversal in absolute", path: "/app/../etc/passwd", wantErr: true},

		// Rejected: outside base dir
		{name: "absolute outside base", path: "/etc/passwd", wantErr: true},
		{name: "absolute sibling", path: "/application/foo", wantErr: true},
		{name: "root path", path: "/", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			resolved, err := validation.ValidateFilePath(tt.path, baseDir)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateFilePath(%q, %q) error = %v, wantErr %v", tt.path, baseDir, err, tt.wantErr)
			}
			if !tt.wantErr && resolved != tt.wantPath {
				t.Errorf("ValidateFilePath(%q, %q) = %q, want %q", tt.path, baseDir, resolved, tt.wantPath)
			}
		})
	}
}

func TestValidateFilePath_SymlinkEscape(t *testing.T) {
	t.Parallel()

	baseDir := t.TempDir()

	// Create a symlink inside baseDir pointing outside
	symlinkPath := filepath.Join(baseDir, "escape")
	if err := os.Symlink("/tmp", symlinkPath); err != nil {
		t.Skipf("cannot create symlinks: %v", err)
	}

	t.Run("direct child of symlink", func(t *testing.T) {
		t.Parallel()
		_, err := validation.ValidateFilePath("escape/secret", baseDir)
		if err == nil {
			t.Error("expected error for symlink escaping base directory, got nil")
		}
	})

	t.Run("deep descendant of symlink", func(t *testing.T) {
		t.Parallel()
		// escape -> /tmp, newdir doesn't exist - tests ancestor walk
		_, err := validation.ValidateFilePath("escape/newdir/deep/file.txt", baseDir)
		if err == nil {
			t.Error("expected error for deep symlink escape, got nil")
		}
	})
}

func TestValidateFilePath_DoubleDotInFilename(t *testing.T) {
	t.Parallel()

	baseDir := t.TempDir()

	// "foo..txt" should be allowed (not a traversal component)
	resolved, err := validation.ValidateFilePath("foo..txt", baseDir)
	if err != nil {
		t.Errorf("expected no error for foo..txt, got %v", err)
	}
	if filepath.Base(resolved) != "foo..txt" {
		t.Errorf("expected filename foo..txt, got %s", filepath.Base(resolved))
	}
}

// --- Dangerous command tests for ProcessStartRequest ---

func TestValidateProcessStartRequest_DangerousCommands(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		cmd     string
		wantErr bool
	}{
		{name: "rm -rf /", cmd: "rm -rf /", wantErr: true},
		{name: "fork bomb", cmd: ":(){ :|:& };:", wantErr: true},
		{name: "dd", cmd: "dd if=/dev/zero of=/dev/sda", wantErr: true},
		{name: "safe: npm start", cmd: "npm start", wantErr: false},
		{name: "safe: node server.js", cmd: "node server.js", wantErr: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validation.ValidateProcessStartRequest(validation.ProcessStartRequest{
				Command: tt.cmd,
			})
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateProcessStartRequest(Command=%q) error = %v, wantErr %v", tt.cmd, err, tt.wantErr)
			}
		})
	}
}
