package fixers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const hostsEntry = "127.0.0.1  local.gasket.dev-godaddy.com"

// HostsFixer appends the local dev hostname to /etc/hosts.
// Uses sudo, so this fixer needs terminal access.
type HostsFixer struct{}

func (f *HostsFixer) NeedsTerminal() bool { return true }

func (f *HostsFixer) Fix(ctx context.Context, _ string) error {
	cmd := exec.CommandContext(ctx, "sudo", "tee", "-a", "/etc/hosts")
	cmd.Env = os.Environ()
	cmd.Stdin = strings.NewReader(hostsEntry + "\n")
	cmd.Stdout = nil // discard tee's stdout echo

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("appending to /etc/hosts: %w", err)
	}
	return nil
}
