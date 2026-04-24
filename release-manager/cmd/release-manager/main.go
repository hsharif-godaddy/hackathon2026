package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/logger"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/tui"
)

const configFileName = "release-manager/release-manager.yml"

func main() {
	var failStages stringSlice
	dryRun := flag.Bool("dry-run", false, "Run full pipeline without triggering any workflows (read-only)")
	flag.BoolVar(dryRun, "n", false, "Shorthand for --dry-run")
	autoApprove := flag.Bool("auto-approve", false, "Skip interactive confirmations (combine with --dry-run)")
	noSlack := flag.Bool("no-slack", false, "Disable Slack notifications")
	noRelease := flag.Bool("no-release", false, "Skip GitHub release creation on successful deploy")
	forceLock := flag.Bool("force-lock", false, "Break through an existing deploy lock")
	branch := flag.String("branch", "main", "Branch to build from (resolves {{branch}} templates)")
	rollbackArtifactID := flag.String("rollback-artifact-id", "", "Override the previous-good app artifact ID (skips GitHub lookup when set)")
	rollbackAgentTag := flag.String("rollback-agent-tag", "", "Override the previous-good agent image tag")
	rollbackPreviewTag := flag.String("rollback-preview-tag", "", "Override the previous-good preview image tag")
	rollbackPublishTag := flag.String("rollback-publish-tag", "", "Override the previous-good publish image tag")
	flag.Var(&failStages, "fail-stage", "Simulate failure for a stage ID in dry-run (repeatable)")
	flag.Parse()

	if len(failStages) > 0 && !*dryRun {
		fmt.Fprintln(os.Stderr, "Warning: --fail-stage has no effect without --dry-run")
	}

	overrides := pipeline.SnapshotOverrides{
		ArtifactID:      strings.TrimSpace(*rollbackArtifactID),
		AgentImageTag:   strings.TrimSpace(*rollbackAgentTag),
		PreviewImageTag: strings.TrimSpace(*rollbackPreviewTag),
		PublishImageTag: strings.TrimSpace(*rollbackPublishTag),
	}

	projectRoot, err := findProjectRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	configPath := filepath.Join(projectRoot, configFileName)
	if localPath := filepath.Join(projectRoot, "release-manager/release-manager.local.yml"); fileExists(localPath) {
		configPath = localPath
	}

	if err := logger.Init(filepath.Join(projectRoot, "release-manager/logs")); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not initialize logger: %v\n", err)
	}
	defer logger.Close()

	logger.Log("config: dry-run=%v, auto-approve=%v, force-lock=%v, branch=%s", *dryRun, *autoApprove, *forceLock, *branch)
	if len(failStages) > 0 {
		logger.Log("config: fail-stages=%s", strings.Join(failStages, ", "))
	}
	if overrides.ArtifactID != "" || overrides.AgentImageTag != "" || overrides.PreviewImageTag != "" || overrides.PublishImageTag != "" {
		logger.Log("config: rollback-overrides artifact_id=%q agent=%q preview=%q publish=%q", overrides.ArtifactID, overrides.AgentImageTag, overrides.PreviewImageTag, overrides.PublishImageTag)
	}
	logger.Log("config: loading %s", configPath)

	cfg, err := config.Load(configPath)
	if err != nil {
		logger.Log("config: load error: %v", err)
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		fmt.Fprintf(os.Stderr, "\nExpected config file at: %s\n", configPath)
		os.Exit(1)
	}

	var runner gh.Runner = &gh.LiveRunner{}
	if *dryRun {
		runner = &gh.DryRunner{Real: &gh.LiveRunner{}}
	}

	model := tui.NewModel(cfg, runner, *dryRun, *branch, *autoApprove, *noSlack, *noRelease, *forceLock, failStages, overrides)
	p := tea.NewProgram(model)
	if _, err := p.Run(); err != nil {
		logger.Log("program: error: %v", err)
		fmt.Fprintf(os.Stderr, "\nError: %v\n", err)
		os.Exit(1)
	}
}

type stringSlice []string

func (s *stringSlice) String() string { return strings.Join(*s, ", ") }
func (s *stringSlice) Set(v string) error {
	*s = append(*s, v)
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
		"could not find %s in any parent directory.\nCurrent directory: %s",
		configFileName, cwd,
	)
}
