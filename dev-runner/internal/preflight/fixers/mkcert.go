package fixers

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
)

// MkcertFixer installs mkcert using the platform's package manager.
// Supported: macOS (Homebrew), Linux (apt).
// Unsupported platforms get a manual install link.
type MkcertFixer struct{}

func (f *MkcertFixer) Fix(ctx context.Context, projectRoot string) error {
	switch runtime.GOOS {
	case "darwin":
		return f.fixDarwin(ctx, projectRoot)
	case "linux":
		return f.fixLinux(ctx, projectRoot)
	default:
		return fmt.Errorf("automatic mkcert install not supported on %s — install manually: https://github.com/FiloSottile/mkcert#installation", runtime.GOOS)
	}
}

func (f *MkcertFixer) fixDarwin(ctx context.Context, projectRoot string) error {
	if _, err := exec.LookPath("brew"); err != nil {
		return fmt.Errorf("Homebrew not found in PATH — install mkcert manually: https://github.com/FiloSottile/mkcert#installation")
	}

	if _, err := RunCommand(ctx, projectRoot, "brew", "install", "mkcert"); err != nil {
		return fmt.Errorf("brew install mkcert: %w", err)
	}

	return nil
}

func (f *MkcertFixer) fixLinux(ctx context.Context, projectRoot string) error {
	if _, err := exec.LookPath("apt-get"); err == nil {
		if _, err := RunCommand(ctx, projectRoot, "sudo", "apt-get", "update"); err != nil {
			return fmt.Errorf("apt-get update: %w", err)
		}
		if _, err := RunCommand(ctx, projectRoot, "sudo", "apt-get", "install", "-y", "mkcert"); err != nil {
			return fmt.Errorf("apt-get install mkcert: %w", err)
		}
		return nil
	}

	// No supported package manager found
	return fmt.Errorf("no supported package manager found (apt) — install mkcert manually: https://github.com/FiloSottile/mkcert#installation")
}
