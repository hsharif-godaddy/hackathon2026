package checks

import (
	"context"
	"os"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// DirenvCheck verifies that direnv is installed, hooked into the user's shell,
// and that the project's .envrc has been allowed. direnv loads .envrc on
// directory entry, which activates the correct Node.js version and enables
// corepack. Without it, dev-runner and every shell spawned under it will pick
// up the wrong toolchain versions and produce confusing failures downstream.
// This is a hard blocker — the check returns StatusFail with no auto-fixer so
// preflight cannot be skipped until the user sets direnv up correctly.
type DirenvCheck struct{}

func (c *DirenvCheck) Name() string     { return "direnv" }
func (c *DirenvCheck) Category() string { return preflight.CategoryTools }

const (
	hookInstructions = "add the direnv hook to your shell profile (https://direnv.net/docs/hook.html):\n" +
		"  zsh:  echo 'eval \"$(direnv hook zsh)\"' >> ~/.zshrc\n" +
		"  bash: echo 'eval \"$(direnv hook bash)\"' >> ~/.bashrc"
	reloadInstructions = "then open a new terminal (or `source` your rc file) and re-run `pnpm run dev`"
)

func (c *DirenvCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	if _, err := exec.LookPath("direnv"); err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "direnv not installed; required for auto-loading Node.js/pnpm versions",
			InstallHint: "1. install direnv:  brew install direnv\n" +
				"2. " + hookInstructions + "\n" +
				"3. open a new terminal, cd into this project, run:  direnv allow\n" +
				"4. re-run `pnpm run dev`",
		}
	}

	// Always consult `direnv status` for the project's .envrc first. DIRENV_DIR
	// alone isn't trustworthy: it can be stale from a prior successful load in
	// the same shell even after .envrc was edited and needs re-allowing (direnv
	// only clears DIRENV_DIR on the next cd/prompt hook, not on file change).
	allowState := direnvAllowState(ctx, projectRoot)

	if allowState == allowStateNotAllowed {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  ".envrc is blocked; direnv will not load this project until it is allowed",
			InstallHint: "run:  direnv allow\n" +
				reloadInstructions,
		}
	}

	// .envrc is allowed (or allow-state is unknown, which is benign when the
	// shell already has direnv loaded). Trust DIRENV_DIR as the signal that
	// the hook has actually sourced it in this shell.
	if os.Getenv("DIRENV_DIR") != "" {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "installed and active",
		}
	}

	// Not active. Distinguish "allowed but hook missing" from the unknown case.
	if allowState == allowStateAllowed {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "direnv hook not active in this shell; .envrc is allowed but won't auto-load",
			InstallHint: hookInstructions + "\n" +
				reloadInstructions,
		}
	}
	return preflight.CheckResult{
		Status:   preflight.StatusFail,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "direnv not active in this shell",
		InstallHint: hookInstructions + "\n" +
			"then:  cd into this project and run `direnv allow`\n" +
			reloadInstructions,
	}
}

type direnvAllowResult int

const (
	allowStateUnknown direnvAllowResult = iota
	allowStateAllowed
	allowStateNotAllowed
)

// direnvAllowState runs `direnv status` in projectRoot and reads the "Found RC
// allowed" line to determine whether the current .envrc is allowed. Returns
// allowStateUnknown if the command fails or the output format is unrecognized
// (e.g., unsupported direnv version, no .envrc in cwd).
func direnvAllowState(ctx context.Context, projectRoot string) direnvAllowResult {
	cmd := exec.CommandContext(ctx, "direnv", "status")
	cmd.Dir = projectRoot
	out, err := cmd.CombinedOutput()
	if err != nil {
		return allowStateUnknown
	}
	for line := range strings.SplitSeq(string(out), "\n") {
		line = strings.TrimSpace(line)
		const prefix = "Found RC allowed "
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		// direnv has emitted two formats over time: integer enum
		// (0=allowed, 1=not allowed, 2=denied) and boolean (true/false).
		switch strings.TrimSpace(strings.TrimPrefix(line, prefix)) {
		case "0", "true":
			return allowStateAllowed
		case "1", "2", "false":
			return allowStateNotAllowed
		default:
			return allowStateUnknown
		}
	}
	return allowStateUnknown
}
