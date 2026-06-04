package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/headless"
	"github.com/airo-ai-builder/release-manager/internal/logger"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/slack"
	"github.com/airo-ai-builder/release-manager/internal/tui"
)

const configFileName = "release-manager/release-manager.yml"

func main() {
	// `release-manager run --headless ...` drives a release with no TUI, for
	// GitHub Actions. Any other invocation (no subcommand, or a leading flag)
	// launches the interactive TUI exactly as before.
	if len(os.Args) > 1 && os.Args[1] == "run" {
		os.Exit(runHeadless(os.Args[2:]))
	}

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
	rollbackBaseCommit := flag.String("rollback-base-commit", "", "Override the base commit SHA used for release-notes comparison (bypasses ext-hash extraction from agent image tag)")
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
	baseCommit := strings.TrimSpace(*rollbackBaseCommit)

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
	if overrides.ArtifactID != "" || overrides.AgentImageTag != "" || overrides.PreviewImageTag != "" || overrides.PublishImageTag != "" || baseCommit != "" {
		logger.Log("config: rollback-overrides artifact_id=%q agent=%q preview=%q publish=%q base_commit=%q", overrides.ArtifactID, overrides.AgentImageTag, overrides.PreviewImageTag, overrides.PublishImageTag, baseCommit)
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

	model := tui.NewModel(cfg, runner, *dryRun, *branch, *autoApprove, *noSlack, *noRelease, *forceLock, failStages, overrides, baseCommit)
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

// runHeadless implements the `run` subcommand: a non-interactive release phase
// for GitHub Actions. Returns a process exit code.
func runHeadless(args []string) int {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	headlessFlag := fs.Bool("headless", false, "run without the TUI (required)")
	mode := fs.String("mode", "", "phase to run: test | prod | rollback | abort")
	branch := fs.String("branch", "main", "branch to release from")
	dryRun := fs.Bool("dry-run", false, "skip real workflow dispatches (read-only)")
	stateFile := fs.String("state-file", "", "phase state file: the test phase writes it, the prod/abort phases read it")
	reason := fs.String("reason", "", "abort: terminal status line to post (e.g. the supersede janitor's reason); empty ⇒ derive from approval history")
	slackTS := fs.String("slack-ts", "", "existing Slack message ts to update in place (optional; prod normally reads it from --state-file)")
	operator := fs.String("operator", "", "name shown in the Slack header (default: $GITHUB_ACTOR, else 'scheduler')")
	baseCommit := fs.String("base-commit", "", "override the release-notes base commit")
	rbArtifact := fs.String("rollback-artifact-id", "", "rollback: override the previous-good artifact ID")
	rbAgent := fs.String("rollback-agent-tag", "", "rollback: override the previous-good agent image tag")
	rbPreview := fs.String("rollback-preview-tag", "", "rollback: override the previous-good preview image tag")
	rbPublish := fs.String("rollback-publish-tag", "", "rollback: override the previous-good publish image tag")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	if !*headlessFlag {
		fmt.Fprintln(os.Stderr, "Error: `run` currently requires --headless")
		return 2
	}
	switch headless.Mode(*mode) {
	case headless.ModeTest, headless.ModeProd, headless.ModeRollback, headless.ModeAbort:
	default:
		fmt.Fprintf(os.Stderr, "Error: --mode must be test|prod|rollback|abort (got %q)\n", *mode)
		return 2
	}

	projectRoot, err := findProjectRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return 1
	}
	configPath := filepath.Join(projectRoot, configFileName)
	if localPath := filepath.Join(projectRoot, "release-manager/release-manager.local.yml"); fileExists(localPath) {
		configPath = localPath
	}
	if err := logger.Init(filepath.Join(projectRoot, "release-manager/logs")); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not initialize logger: %v\n", err)
	}
	defer logger.Close()

	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		return 1
	}

	op := *operator
	if op == "" {
		op = os.Getenv("GITHUB_ACTOR")
	}
	if op == "" {
		op = "scheduler"
	}

	// Route the pioneer-infra org through its dedicated token; every other repo
	// uses the runner's ambient GH_TOKEN.
	runner := &gh.LiveRunner{
		TokenForRepo: gh.RepoTokenRouter(map[string]string{
			"gdcorp-commerce": os.Getenv("PIONEER_INFRA_TOKEN"),
		}),
	}

	// Slack is best-effort and skipped in dry-run. Credentials come from env
	// (GitHub repo secrets), never AWS, on the runner.
	var notifier *slack.Notifier
	if !*dryRun {
		if creds, ok := slack.CredentialsFromEnv(); ok {
			notifier = slack.New(creds.Token, creds.ChannelID)
		} else {
			logger.Log("headless: SLACK_BOT_TOKEN/SLACK_CHANNEL_ID unset — Slack disabled")
		}
	}
	if *slackTS != "" {
		if notifier == nil {
			// A ts was supplied but Slack is disabled (missing/mismatched
			// SLACK_* secrets). Without this warning the symptom — a NEW thread
			// instead of an edit — is hard to trace back to the config.
			logger.Log("headless.warn: --slack-ts set but Slack is disabled (SLACK_BOT_TOKEN/SLACK_CHANNEL_ID unset); the existing message will NOT be updated")
		}
		notifier.SeedTS(*slackTS) // nil-safe
	}

	opts := headless.Options{
		Mode:       headless.Mode(*mode),
		Branch:     *branch,
		DryRun:     *dryRun,
		Operator:   op,
		StateFile:  *stateFile,
		Reason:     strings.TrimSpace(*reason),
		BaseCommit: strings.TrimSpace(*baseCommit),
		// abort is a best-effort finalizer (edit the Slack message after a gate
		// decline); a gh auth hiccup must not stop it from posting — it degrades
		// to "Release canceled" on its own when the approvals API is unreadable.
		SkipPreflight: headless.Mode(*mode) == headless.ModeAbort,
		Overrides: pipeline.SnapshotOverrides{
			ArtifactID:      strings.TrimSpace(*rbArtifact),
			AgentImageTag:   strings.TrimSpace(*rbAgent),
			PreviewImageTag: strings.TrimSpace(*rbPreview),
			PublishImageTag: strings.TrimSpace(*rbPublish),
		},
	}

	if err := headless.Run(context.Background(), cfg, runner, notifier, opts); err != nil {
		fmt.Fprintf(os.Stderr, "release %s phase failed: %v\n", *mode, err)
		return 1
	}
	return 0
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
