package main

import (
	"fmt"
	"os"
	"path/filepath"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/dev-runner/internal/clean"
	"github.com/airo-ai-builder/dev-runner/internal/config"
	"github.com/airo-ai-builder/dev-runner/internal/tui"
)

const configFileName = "dev-runner/dev-runner.yml"
const localConfigFileName = "dev-runner/dev-runner.local.yml"

func main() {
	projectRoot, err := findProjectRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if len(os.Args) > 1 && os.Args[1] == "clean" {
		skipConfirm := false
		for _, arg := range os.Args[2:] {
			if arg == "--yes" || arg == "-y" {
				skipConfirm = true
			} else {
				fmt.Fprintf(os.Stderr, "Error: unknown flag %q\nUsage: dev-runner clean [--yes|-y]\n", arg)
				os.Exit(1)
			}
		}
		if err := clean.Run(projectRoot, skipConfirm); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
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

	model := tui.NewModel(cfg, projectRoot)

	p := tea.NewProgram(model)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
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
