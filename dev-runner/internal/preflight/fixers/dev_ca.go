package fixers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// DevCAFixer sets up the local development Certificate Authority using mkcert.
// mkcert -install uses sudo internally, so this fixer needs terminal access.
type DevCAFixer struct{}

func (f *DevCAFixer) NeedsTerminal() bool { return true }

func (f *DevCAFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := exec.LookPath("mkcert"); err != nil {
		return fmt.Errorf("mkcert not found in PATH — install it first: %w", err)
	}

	// Ensure mkcert CA is installed (may trigger sudo)
	if err := RunCommandPassthrough(ctx, projectRoot, "mkcert", "-install"); err != nil {
		return fmt.Errorf("mkcert -install: %w", err)
	}

	// Find mkcert's CA root directory
	caRoot, err := RunCommand(ctx, projectRoot, "mkcert", "-CAROOT")
	if err != nil {
		return fmt.Errorf("mkcert -CAROOT: %w", err)
	}
	caRoot = strings.TrimSpace(caRoot)

	devCADir := filepath.Join(projectRoot, ".dev-ca")
	if err := os.MkdirAll(devCADir, 0755); err != nil {
		return fmt.Errorf("creating .dev-ca/: %w", err)
	}

	// Copy CA cert (public — 0644 is fine)
	srcCert := filepath.Join(caRoot, "rootCA.pem")
	if err := copyFile(srcCert, filepath.Join(devCADir, "ca-cert.pem"), 0644); err != nil {
		return fmt.Errorf("copying CA cert: %w", err)
	}

	// Copy CA key (private — restrictive permissions)
	srcKey := filepath.Join(caRoot, "rootCA-key.pem")
	if err := copyFile(srcKey, filepath.Join(devCADir, "ca-key.pem"), 0600); err != nil {
		return fmt.Errorf("copying CA key: %w", err)
	}

	return nil
}

func copyFile(src, dst string, perm os.FileMode) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, perm)
}
