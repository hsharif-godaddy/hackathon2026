package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/dev-runner/internal/clean"
	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/tui"
)

// cleanRunFailedError marks an error returned by runCleanTUI as a real
// clean failure (the picker confirmed, clean actually ran, and reported
// a non-nil CleanErr). The caller distinguishes this from TUI-startup
// failures (no TTY, config load, Bubble Tea runtime error) so it knows
// whether to fall back to the legacy CLI prompt or exit non-zero
// directly — re-prompting the user to clean a tree that was just
// partially cleaned would be confusing at best.
type cleanRunFailedError struct{ err error }

func (e *cleanRunFailedError) Error() string { return e.err.Error() }
func (e *cleanRunFailedError) Unwrap() error { return e.err }

const configFileName = "dev-runner/dev-runner.yml"
const localConfigFileName = "dev-runner/dev-runner.local.yml"

const cleanUsage = "Usage: dev-runner clean [--all|--build|--runtime|--env|--node-modules] [--yes|-y]\n" +
	"  Group-flag aliases: --build|--build-artifacts, --runtime|--runtime-data, --env|--env-files\n" +
	"  No flags + interactive shell: opens the TUI picker.\n" +
	"  --yes alone (or non-interactive): legacy scope (build + runtime + env).\n"

const devUsage = "Usage: dev-runner [--clean | --clean-all]\n" +
	"  --clean      open the clean picker before preflight\n" +
	"  --clean-all  remove every group (build + runtime + env + node_modules) before preflight\n"

// cleanMode describes how the dev startup path should treat clean state.
type cleanMode int

const (
	cleanModeNone cleanMode = iota
	cleanModePicker
	cleanModeAll
)

func main() {
	projectRoot, err := findProjectRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if len(os.Args) > 1 && os.Args[1] == "clean" {
		args := os.Args[2:]

		// Interactive `dev-runner clean` (no flags) → launch the TUI's
		// clean picker so users get the same UI as the dev-time flows
		// (`c` on dashboard, `s` → "Clean + Restart"). Flags route to the
		// classic CLI path so scripts and CI keep working.
		if len(args) == 0 {
			err := runCleanTUI(projectRoot)
			if err == nil {
				return
			}
			// Distinguish "clean ran and failed" from "TUI couldn't
			// start". Re-prompting the user to clean again on top of
			// a partially-cleaned tree is the wrong behavior — and
			// would even mask the failure as exit 0 if they answered
			// "no" to the legacy [y/N] prompt.
			var cleanFailed *cleanRunFailedError
			if errors.As(err, &cleanFailed) {
				fmt.Fprintf(os.Stderr, "Error: %v\n", err)
				os.Exit(1)
			}
			// TUI startup failure (no TTY in CI / piped shell, or
			// config load error). The user can still get a clean via
			// the CLI prompt with the legacy default scope.
			fmt.Fprintf(os.Stderr, "Could not start the clean TUI (%v); falling back to CLI prompt.\n", err)
			if cliErr := clean.Run(projectRoot, clean.Default(), false); cliErr != nil {
				fmt.Fprintf(os.Stderr, "Error: %v\n", cliErr)
				os.Exit(1)
			}
			return
		}

		sel, skipConfirm, err := parseCleanFlags(args)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n%s", err, cleanUsage)
			os.Exit(1)
		}
		if err := clean.Run(projectRoot, sel, skipConfirm); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	mode, err := parseDevFlags(os.Args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n%s", err, devUsage)
		os.Exit(1)
	}

	configPath := filepath.Join(projectRoot, configFileName)
	if localPath := filepath.Join(projectRoot, localConfigFileName); fileExists(localPath) {
		configPath = localPath
	}
	cfg, err := config.Load(configPath, projectRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		fmt.Fprintf(os.Stderr, "\nExpected config file at: %s\n", configPath)
		fmt.Fprintf(os.Stderr, "See dev-runner/README.md for config format.\n")
		os.Exit(1)
	}

	// --clean-all runs through the TUI cleaning phase (rather than synchronously
	// before tea.NewProgram) so the output isn't wiped by the alt-screen.
	model := tui.NewModel(cfg, projectRoot, mode == cleanModePicker, mode == cleanModeAll, false)

	p := tea.NewProgram(model)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

// parseCleanFlags handles the `dev-runner clean` subcommand. Group flags are
// additive; with no group flags the legacy `pnpm run clean` scope (Default)
// is used so existing scripts and muscle memory keep working.
func parseCleanFlags(args []string) (clean.Selection, bool, error) {
	var sel clean.Selection
	var skipConfirm bool
	var anyGroup bool

	for _, a := range args {
		switch a {
		case "--all":
			sel = clean.All()
			anyGroup = true
		case "--build", "--build-artifacts":
			sel.BuildArtifacts = true
			anyGroup = true
		case "--runtime", "--runtime-data":
			sel.RuntimeData = true
			anyGroup = true
		case "--env", "--env-files":
			sel.EnvFiles = true
			anyGroup = true
		case "--node-modules":
			sel.NodeModules = true
			anyGroup = true
		case "--yes", "-y":
			skipConfirm = true
		default:
			return clean.Selection{}, false, fmt.Errorf("unknown flag %q", a)
		}
	}

	if !anyGroup {
		sel = clean.Default()
	}
	return sel, skipConfirm, nil
}

// parseDevFlags parses the dev-startup flags. --clean and --clean-all are
// mutually exclusive.
func parseDevFlags(args []string) (cleanMode, error) {
	mode := cleanModeNone
	for _, a := range args {
		switch a {
		case "--clean":
			if mode == cleanModeAll {
				return 0, fmt.Errorf("cannot combine --clean and --clean-all")
			}
			mode = cleanModePicker
		case "--clean-all":
			if mode == cleanModePicker {
				return 0, fmt.Errorf("cannot combine --clean and --clean-all")
			}
			mode = cleanModeAll
		default:
			return 0, fmt.Errorf("unknown flag %q", a)
		}
	}
	return mode, nil
}

// runCleanTUI loads the dev-runner config and launches the TUI in
// clean-only mode: the picker opens, on completion the program quits
// instead of advancing into preflight/hooks/processes.
//
// Returns the Bubble Tea runtime error (e.g. no TTY) OR the
// CleanErr() from the final model — so an on-screen `✗ Clean failed`
// also shows up as a non-zero exit code, matching the flag-driven
// clean.Run path.
func runCleanTUI(projectRoot string) error {
	configPath := filepath.Join(projectRoot, configFileName)
	if localPath := filepath.Join(projectRoot, localConfigFileName); fileExists(localPath) {
		configPath = localPath
	}
	cfg, err := config.Load(configPath, projectRoot)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	model := tui.NewModel(cfg, projectRoot, false, false, true)
	p := tea.NewProgram(model)
	final, err := p.Run()
	if err != nil {
		return err
	}
	if m, ok := final.(tui.Model); ok {
		if cleanErr := m.CleanErr(); cleanErr != nil {
			return &cleanRunFailedError{err: cleanErr}
		}
	}
	return nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func findProjectRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getting working directory: %w", err)
	}

	for {
		if _, err := os.Stat(filepath.Join(dir, configFileName)); err == nil {
			return dir, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	cwd, _ := os.Getwd()
	return cwd, fmt.Errorf(
		"could not find %s in any parent directory.\nCreate one at your project root. Current directory: %s",
		configFileName, cwd,
	)
}
