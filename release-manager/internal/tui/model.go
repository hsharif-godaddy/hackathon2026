package tui

import (
	"context"
	"fmt"
	"os/exec"
	"os/user"
	"strings"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/lock"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/slack"
)

type phase int

const (
	phasePreflight phase = iota
	phaseSlackWarning
	phaseLockAcquire
	phaseSnapshot
	phaseSnapshotConfirm
	phaseReleaseNotes
	phaseRunning
	phaseGate
	phaseChecklist
	phaseFailurePrompt
	phaseComplete
	phaseCreatingRelease
	phaseCleanup
	phaseCleanupDone
	phaseRollbackConfirm
	phaseRollbackRunning
	phaseAborted
)

type preflightCheck struct {
	Name     string
	Passed   bool
	Error    string
	Hint     string
	Done     bool
	Required bool
}

// formValues is heap-allocated and shared across Bubble Tea model copies,
// so huh's Value() pointers stay valid through the update cycle.
type formValues struct {
	confirm bool
	choice  string
	checked []int
}

type Model struct {
	config      *config.Config
	runner      gh.Runner
	pipeline    *pipeline.Pipeline
	dryRun      bool
	autoApprove bool
	noSlack     bool
	noRelease   bool
	forceLock   bool
	branch      string
	ctx         context.Context
	cancel      context.CancelFunc
	lockHeld    bool

	phase     phase
	preflight []preflightCheck

	currentEnvIdx int
	envOrder      []string

	currentGroupIdx int
	envGroups       [][]int

	// Embedded Huh form — receives all input when non-nil.
	form *huh.Form

	// Shared pointer so huh Value() writes survive Bubble Tea model copies.
	fv *formValues

	// Slack notifier — nil if disabled or webhook fetch failed.
	slack *slack.Notifier

	releaseNotes    []pipeline.ReleaseNote
	releaseNotesURL string
	releaseNotesErr string
	authorMentions  map[string]string

	// Populated when the GitHub release is cut at the "Complete" moment.
	// Cleared when the operator confirms rollback so subsequent Slack updates
	// don't reference a release that's being torn down.
	releaseTag string
	releaseURL string

	checklistStageIdx   int
	failedStageIdx      int
	deferredFailures    []int
	rollbackIdxs        []int
	rollbackGroups      [][]int
	rollbackGroupIdx    int
	rollbackReturnPhase phase

	width  int
	height int

	hasDarkBG bool
	theme     Theme
	spinner   spinner.Model

	operator        string
	statusMessage   string
	cleanupWarning  string
	startTime       time.Time
	lastSlackUpdate time.Time
}

func NewModel(cfg *config.Config, runner gh.Runner, dryRun bool, branch string, autoApprove bool, noSlack bool, noRelease bool, forceLock bool, failStages []string, overrides pipeline.SnapshotOverrides, baseCommitOverride string) Model {
	ctx, cancel := context.WithCancel(context.Background())

	var operator string
	if u, err := user.Current(); err == nil {
		operator = u.Username
	}

	repos := cfg.Repos()
	preflight := []preflightCheck{
		{Name: "gh CLI installed", Required: true},
		{Name: "gh version >= 2.87.0", Required: true},
		{Name: "gh authenticated", Required: true},
	}
	for _, repo := range repos {
		preflight = append(preflight, preflightCheck{Name: fmt.Sprintf("access to %s", repo), Required: true})
	}
	if cfg.Lock.AWSProfile != "" {
		preflight = append(preflight, preflightCheck{Name: "aws CLI installed", Required: true})
		preflight = append(preflight, preflightCheck{Name: "aws CLI authenticated", Required: true})
	}
	preflight = append(preflight, preflightCheck{Name: "No active deploy/release workflows", Required: true})
	if cfg.Lock.SSMParameter != "" {
		preflight = append(preflight, preflightCheck{Name: "Deploy lock available", Required: !forceLock})
	}
	if !noSlack && cfg.Slack.SecretName != "" {
		preflight = append(preflight, preflightCheck{Name: "Slack notifications"})
	}

	theme := themeForBackground(true)
	s := spinner.New(
		spinner.WithSpinner(spinner.MiniDot),
		spinner.WithStyle(lipgloss.NewStyle().Foreground(theme.Running)),
	)

	p := pipeline.New(cfg, runner, dryRun, branch, failStages)
	p.Overrides = overrides
	p.BaseCommitOverride = baseCommitOverride

	return Model{
		config:         cfg,
		runner:         runner,
		pipeline:       p,
		dryRun:         dryRun,
		autoApprove:    autoApprove,
		noSlack:        noSlack,
		noRelease:      noRelease,
		forceLock:      forceLock,
		branch:         branch,
		ctx:            ctx,
		cancel:         cancel,
		phase:          phasePreflight,
		preflight:      preflight,
		envOrder:       cfg.EnvironmentOrder(),
		fv:             &formValues{},
		failedStageIdx: -1,
		operator:       operator,
		startTime:      time.Time{},
		hasDarkBG:      true,
		theme:          theme,
		spinner:        s,
		width:          80,
		height:         24,
	}
}

func (m Model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		func() tea.Msg { return tea.RequestBackgroundColor() },
		m.spinner.Tick,
		checkGHInstalled(m.runner, m.ctx),
		checkGHVersion(m.runner, m.ctx),
		checkGHAuth(m.runner, m.ctx),
		checkRepoAccess(m.runner, m.ctx, m.config.Repos()),
	}

	nextIdx := 3 + len(m.config.Repos())

	if m.config.Lock.AWSProfile != "" {
		cmds = append(cmds, checkAWSInstalled(m.ctx, nextIdx))
		nextIdx++
		cmds = append(cmds, checkAWSAuth(m.ctx, m.config.Lock.AWSProfile, nextIdx))
		nextIdx++
	}

	cmds = append(cmds, checkActiveRuns(m.runner, m.ctx, m.config.ActiveRunWorkflows(), nextIdx, m.forceLock))
	nextIdx++

	if m.config.Lock.SSMParameter != "" {
		cmds = append(cmds, checkDeployLock(m.ctx, m.config.Lock, nextIdx, m.forceLock))
		nextIdx++
	}

	if !m.noSlack && m.config.Slack.SecretName != "" {
		cmds = append(cmds, fetchSlackCredentials(m.ctx, m.config.Slack, nextIdx))
	}

	return tea.Batch(cmds...)
}

// Tea messages

type preflightResultMsg struct {
	idx    int
	passed bool
	err    string
}

type preflightDoneMsg struct{}

type snapshotResultMsg struct {
	snapshot pipeline.RollbackSnapshot
	err      error
}

type releaseNotesMsg struct {
	notes          []pipeline.ReleaseNote
	htmlURL        string
	authorMentions map[string]string
	err            error
}

type stageCompleteMsg struct {
	idx int
	err error
}

type groupCompleteMsg struct {
	env   string
	group int
}

type rollbackGroupDoneMsg struct {
	group int
}

type rollbackDoneMsg struct {
	hasErrors bool
}

type slackCredentialsMsg struct {
	idx       int
	token     string
	channelID string
	err       error
}

type lockAcquireMsg struct {
	err error
}

type exitCleanupDoneMsg struct {
	warning string
}

type releaseCreatedMsg struct {
	tag string
	url string
	err error
}

type cleanupQuitMsg struct{}

type tickMsg struct{}

func tickCmd() tea.Cmd {
	return tea.Tick(time.Second, func(_ time.Time) tea.Msg {
		return tickMsg{}
	})
}

func checkAWSInstalled(ctx context.Context, idx int) tea.Cmd {
	return func() tea.Msg {
		cmd := exec.CommandContext(ctx, "aws", "--version")
		if err := cmd.Run(); err != nil {
			return preflightResultMsg{idx: idx, passed: false, err: "aws CLI not found. Install: https://aws.amazon.com/cli/"}
		}
		return preflightResultMsg{idx: idx, passed: true}
	}
}

func checkAWSAuth(ctx context.Context, profile string, idx int) tea.Cmd {
	return func() tea.Msg {
		args := []string{"sts", "get-caller-identity"}
		if profile != "" {
			args = append(args, "--profile", profile)
		}
		cmd := exec.CommandContext(ctx, "aws", args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			errMsg := strings.TrimSpace(string(out))
			if errMsg == "" {
				errMsg = err.Error()
			}
			return preflightResultMsg{idx: idx, passed: false, err: errMsg}
		}
		return preflightResultMsg{idx: idx, passed: true}
	}
}

// activeRunStatuses are the gh run statuses that count as "still running" for
// collision detection. Beyond in_progress/queued, this includes waiting — the
// status of a GHA release paused at the approve-prod environment gate — plus
// requested/pending, so a release awaiting approval is still detected.
var activeRunStatuses = map[string]bool{
	"in_progress": true,
	"queued":      true,
	"waiting":     true,
	"requested":   true,
	"pending":     true,
}

func checkActiveRuns(runner gh.Runner, ctx context.Context, workflows []config.DeployWorkflow, idx int, forceLock bool) tea.Cmd {
	return func() tea.Msg {
		var conflicts []string
		for _, wf := range workflows {
			runs, err := runner.ListRuns(ctx, wf.Repo, wf.Workflow, "", 5)
			if err != nil {
				continue
			}
			for _, r := range runs {
				if !activeRunStatuses[r.Status] {
					continue
				}
				if wf.ActiveRunFilter != "" && !strings.Contains(r.Name, wf.ActiveRunFilter) {
					continue
				}
				conflicts = append(conflicts, fmt.Sprintf("%s (%s) — %s", wf.Workflow, r.Status, r.URL))
			}
		}
		if len(conflicts) > 0 {
			msg := fmt.Sprintf("active workflows:\n    %s", strings.Join(conflicts, "\n    "))
			// --force-lock is the break-glass override for the concurrency
			// guards: downgrade to a warning (mirrors checkDeployLock) so an
			// operator can proceed deliberately despite an in-flight release.
			if forceLock {
				return preflightResultMsg{idx: idx, passed: true, err: msg}
			}
			return preflightResultMsg{idx: idx, passed: false, err: msg}
		}
		return preflightResultMsg{idx: idx, passed: true}
	}
}

func checkDeployLock(ctx context.Context, cfg config.LockConfig, idx int, forceLock bool) tea.Cmd {
	return func() tea.Msg {
		info, err := lock.Check(ctx, cfg.SSMParameter, cfg.AWSProfile)
		if err != nil {
			return preflightResultMsg{idx: idx, passed: false, err: err.Error()}
		}
		if info != nil {
			age := time.Since(info.StartedAt).Truncate(time.Second)
			msg := fmt.Sprintf("%s is deploying %s (started %s ago)", info.Operator, info.Branch, age)
			if forceLock {
				return preflightResultMsg{idx: idx, passed: true, err: msg}
			}
			return preflightResultMsg{idx: idx, passed: false, err: msg}
		}
		return preflightResultMsg{idx: idx, passed: true}
	}
}

func acquireLockCmd(ctx context.Context, cfg config.LockConfig, operator, branch string) tea.Cmd {
	return func() tea.Msg {
		return lockAcquireMsg{err: lock.Acquire(ctx, cfg.SSMParameter, cfg.AWSProfile, operator, branch)}
	}
}

func fetchSlackCredentials(ctx context.Context, cfg config.SlackConfig, idx int) tea.Cmd {
	return func() tea.Msg {
		creds, err := slack.FetchCredentials(ctx, cfg.SecretName, cfg.AWSProfile)
		if err != nil {
			return slackCredentialsMsg{idx: idx, err: err}
		}
		return slackCredentialsMsg{idx: idx, token: creds.Token, channelID: creds.ChannelID}
	}
}
