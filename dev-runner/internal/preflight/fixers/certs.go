package fixers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// CertsFixer installs local TLS certificates using mkcert.
// mkcert -install uses sudo internally, so this fixer needs terminal access.
type CertsFixer struct{}

func (f *CertsFixer) NeedsTerminal() bool { return true }

func (f *CertsFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := exec.LookPath("mkcert"); err != nil {
		return fmt.Errorf("mkcert not found in PATH: %w", err)
	}

	certsDir := filepath.Join(projectRoot, "app", "certificates")
	if err := os.MkdirAll(certsDir, 0755); err != nil {
		return fmt.Errorf("create certificates dir: %w", err)
	}

	if err := RunCommandPassthrough(ctx, projectRoot, "mkcert", "-install"); err != nil {
		return fmt.Errorf("mkcert -install: %w", err)
	}

	certFile := filepath.Join(certsDir, "localhost.pem")
	keyFile := filepath.Join(certsDir, "localhost-key.pem")
	if _, err := RunCommand(ctx, projectRoot, "mkcert",
		"-cert-file", certFile,
		"-key-file", keyFile,
		"localhost", "local.gasket.dev-godaddy.com", "127.0.0.1", "::1",
	); err != nil {
		return fmt.Errorf("mkcert generate certs: %w", err)
	}

	return nil
}
