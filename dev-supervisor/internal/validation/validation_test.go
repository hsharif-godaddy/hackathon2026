package validation_test

import (
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
