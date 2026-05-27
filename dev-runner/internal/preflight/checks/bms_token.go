package checks

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// getBMSTokenFunc is the token acquisition function. Tests override this to avoid shelling out.
var getBMSTokenFunc = getBMSTokenExec

func getBMSToken(ctx context.Context, projectRoot string) (string, error) {
	return getBMSTokenFunc(ctx, projectRoot)
}

// getBMSTokenExec generates an IAM S2S JWT by shelling out to the Node.js helper
// script which uses gd-auth-client. Requires an active AWS SSO session.
func getBMSTokenExec(ctx context.Context, projectRoot string) (string, error) {
	scriptPath := filepath.Join(projectRoot, "dev-runner", "scripts", "bms-get-token.js")
	cmd := exec.CommandContext(ctx, "node", scriptPath)
	cmd.Dir = projectRoot
	cmd.Env = os.Environ()
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
			return "", fmt.Errorf("token generation failed: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("token generation failed (is AWS SSO active?): %w", err)
	}
	token := strings.TrimSpace(string(out))
	if token == "" {
		return "", fmt.Errorf("empty token returned")
	}
	return token, nil
}
