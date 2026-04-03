package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/lock"
	"github.com/airo-ai-builder/release-manager/internal/logger"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/slack"
)

func printAbove(text string) tea.Cmd {
	trimmed := strings.TrimRight(text, "\n")
	if trimmed == "" {
		return nil
	}
	return tea.Println(trimmed)
}

func (m Model) slackUpdateCmd(finished bool) tea.Cmd {
	if m.slack == nil || len(m.pipeline.Stages()) == 0 {
		return nil
	}
	text := m.slackMessage(finished)
	n := m.slack
	ctx := m.ctx
	if finished {
		ctx = context.Background()
	}
	return func() tea.Msg {
		n.Update(ctx, text)
		return nil
	}
}

// exitCleanupCmd runs final Slack update and lock release in a background
// goroutine, then sends exitCleanupDoneMsg to trigger tea.Quit. This avoids
// blocking the Bubble Tea event loop during cleanup I/O.
func (m Model) exitCleanupCmd(sendSlack bool) tea.Cmd {
	n := m.slack
	lockCfg := m.config.Lock
	lockHeld := m.lockHeld

	var slackText string
	if sendSlack && n != nil && len(m.pipeline.Stages()) > 0 {
		slackText = m.slackMessage(true)
	}

	if slackText == "" && (!lockHeld || lockCfg.SSMParameter == "") {
		return tea.Quit
	}

	return func() tea.Msg {
		if slackText != "" {
			n.Update(context.Background(), slackText)
		}
		if lockHeld && lockCfg.SSMParameter != "" {
			lock.Release(context.Background(), lockCfg.SSMParameter, lockCfg.AWSProfile)
		}
		return exitCleanupDoneMsg{}
	}
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyPressMsg:
		if msg.String() == "ctrl+c" || msg.String() == "q" {
			if m.form != nil && msg.String() == "q" {
				break
			}
			m.cancel()
			m.phase = phaseAborted
			m.statusMessage = "Aborted by user"
			logger.Log("USER: aborted via %s", msg.String())
			return m, m.exitCleanupCmd(true)
		}

	case slackCredentialsMsg:
		return m.handleSlackCredentials(msg)

	case preflightResultMsg:
		return m.handlePreflightResult(msg)

	case preflightDoneMsg:
		return m.handlePreflightDone()

	case lockAcquireMsg:
		return m.handleLockAcquire(msg)

	case exitCleanupDoneMsg:
		return m, tea.Quit

	case snapshotResultMsg:
		return m.handleSnapshotResult(msg)

	case releaseNotesMsg:
		return m.handleReleaseNotes(msg)

	case stageCompleteMsg:
		return m.handleStageComplete(msg)

	case groupCompleteMsg:
		return m.handleGroupComplete(msg)

	case rollbackGroupDoneMsg:
		return m.handleRollbackGroupDone(msg)

	case rollbackDoneMsg:
		return m.handleRollbackDone(msg)

	case tickMsg:
		if m.phase == phaseRunning || m.phase == phaseRollbackRunning || m.phase == phaseChecklist || m.phase == phaseFailurePrompt {
			if m.slack != nil && time.Since(m.lastSlackUpdate) >= 10*time.Second {
				m.lastSlackUpdate = time.Now()
				return m, tea.Batch(tickCmd(), m.slackUpdateCmd(false))
			}
			return m, tickCmd()
		}
		return m, nil
	}

	// Delegate all other messages to the embedded Huh form.
	if m.form != nil {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}

		if m.form.State == huh.StateCompleted {
			return m.handleFormDone()
		}

		return m, cmd
	}

	return m, nil
}

// handleFormDone reads form values and transitions to the next phase.
func (m Model) handleFormDone() (tea.Model, tea.Cmd) {
	switch m.phase {
	case phaseSlackWarning:
		if !m.fv.confirm {
			m.phase = phaseAborted
			m.statusMessage = "Aborted: user chose not to continue without Slack"
			m.form = nil
			logger.Log("preflight: user declined to continue without Slack — aborting")
			return m, tea.Quit
		}
		m.form = nil
		logger.Log("preflight: user accepted continuing without Slack")
		return m.startLockAcquire()

	case phaseSnapshotConfirm:
		if !m.fv.confirm {
			m.phase = phaseAborted
			m.statusMessage = "Aborted: rollback values not confirmed"
			m.form = nil
			logger.Log("snapshot: user declined rollback values — aborting")
			return m, m.exitCleanupCmd(false)
		}
		m.form = nil
		logger.Log("snapshot: user confirmed rollback values")
		m.phase = phaseReleaseNotes
		return m, tea.Batch(printAbove(m.snapshotString()), fetchReleaseNotes(m.pipeline, m.ctx))

	case phaseReleaseNotes:
		if !m.fv.confirm {
			m.phase = phaseAborted
			m.statusMessage = "Aborted: deployment declined"
			m.form = nil
			logger.Log("release-notes: user declined deployment — aborting")
			return m, m.exitCleanupCmd(false)
		}
		m.form = nil
		m.phase = phaseRunning
		m.currentEnvIdx = 0
		m.startTime = time.Now()
		logger.Log("release-notes: user confirmed deployment")
		cmd := m.setupEnvironment()
		return m, tea.Batch(cmd, m.slackUpdateCmd(false))

	case phaseGate:
		if !m.fv.confirm {
			m.phase = phaseAborted
			m.statusMessage = "Aborted: production deploy declined"
			m.form = nil
			logger.Log("gate: user declined deploy to %s — aborting", m.envOrder[m.currentEnvIdx+1])
			return m, m.exitCleanupCmd(true)
		}
		m.form = nil
		m.currentEnvIdx++
		m.phase = phaseRunning
		logger.Log("gate: user approved deploy to %s", m.envOrder[m.currentEnvIdx])
		cmd := m.setupEnvironment()
		return m, tea.Batch(cmd, m.slackUpdateCmd(false))

	case phaseChecklist:
		m.form = nil
		sr := m.pipeline.Stages()[m.checklistStageIdx]
		allChecked := len(m.fv.checked) == len(sr.Stage.Items)
		if allChecked {
			logger.Log("checklist: %s — all %d items checked, passed", sr.Stage.Name, len(sr.Stage.Items))
			m.pipeline.CompleteChecklist(m.checklistStageIdx)
			printCmd := printAbove(m.stageString(m.pipeline.Stages()[m.checklistStageIdx]))
			if len(m.deferredFailures) > 0 {
				m.failedStageIdx = m.deferredFailures[0]
				m.deferredFailures = m.deferredFailures[1:]
				failCmd := m.buildFailureForm()
				return m, tea.Batch(printCmd, m.slackUpdateCmd(false), failCmd)
			}
			m.phase = phaseRunning
			return m, tea.Batch(printCmd, m.slackUpdateCmd(false), m.checkGroupCompletion())
		}
		unchecked := len(sr.Stage.Items) - len(m.fv.checked)
		logger.Log("checklist: %s — %d of %d items unchecked, failed", sr.Stage.Name, unchecked, len(sr.Stage.Items))
		m.pipeline.FailChecklist(m.checklistStageIdx, fmt.Sprintf("%d of %d items unchecked", unchecked, len(sr.Stage.Items)))
		m.failedStageIdx = m.checklistStageIdx
		printCmd := printAbove(m.stageString(m.pipeline.Stages()[m.checklistStageIdx]))
		failCmd := m.buildFailureForm()
		return m, tea.Batch(printCmd, m.slackUpdateCmd(false), failCmd)

	case phaseFailurePrompt:
		m.form = nil
		failedName := m.pipeline.Stages()[m.failedStageIdx].Stage.Name
		logger.Log("failure-prompt: user chose %q for stage %q", m.fv.choice, failedName)
		switch m.fv.choice {
		case "retry":
			retryIdx := m.failedStageIdx
			m.pipeline.RetryStage(retryIdx)
			if len(m.deferredFailures) > 0 {
				m.failedStageIdx = m.deferredFailures[0]
				m.deferredFailures = m.deferredFailures[1:]
				failCmd := m.buildFailureForm()
				return m, tea.Batch(tickCmd(), m.runStageCmd(retryIdx), failCmd)
			}
			m.phase = phaseRunning
			return m, tea.Batch(tickCmd(), m.runStageCmd(retryIdx))
		case "continue":
			m.pipeline.SkipStage(m.failedStageIdx)
			sr := m.pipeline.Stages()[m.failedStageIdx]
			if len(m.deferredFailures) > 0 {
				m.failedStageIdx = m.deferredFailures[0]
				m.deferredFailures = m.deferredFailures[1:]
				failCmd := m.buildFailureForm()
				return m, tea.Batch(printAbove(m.stageString(sr)), failCmd)
			}
			m.phase = phaseRunning
			return m, tea.Batch(printAbove(m.stageString(sr)), m.checkGroupCompletion())
		case "rollback":
			m.rollbackReturnPhase = phaseFailurePrompt
			m.phase = phaseRollbackConfirm
			cmd := m.buildRollbackConfirmForm()
			return m, cmd
		case "abort":
			m.phase = phaseAborted
			m.statusMessage = "Aborted by user"
			return m, m.exitCleanupCmd(true)
		}

	case phaseComplete:
		m.form = nil
		logger.Log("complete: user chose %q", m.fv.choice)
		if m.fv.choice == "rollback" {
			m.rollbackReturnPhase = phaseComplete
			m.phase = phaseRollbackConfirm
			cmd := m.buildRollbackConfirmForm()
			return m, cmd
		}
		return m, tea.Batch(
			printAbove(successMessageStyle.Render(fmt.Sprintf("Release complete! (%s)", m.elapsed()))),
			m.exitCleanupCmd(true),
		)

	case phaseRollbackConfirm:
		if !m.fv.confirm {
			m.form = nil
			logger.Log("rollback: user declined rollback")
			if m.rollbackReturnPhase == phaseFailurePrompt {
				cmd := m.buildFailureForm()
				return m, cmd
			}
			m.phase = phaseComplete
			cmd := m.buildCompleteForm()
			return m, cmd
		}
		m.form = nil
		m.phase = phaseRollbackRunning
		logger.Log("rollback: user confirmed — starting rollback")
		m.pipeline.BuildRollbackStages()
		cmd := m.runRollback()
		return m, tea.Batch(cmd, m.slackUpdateCmd(false))
	}

	m.form = nil
	return m, nil
}

// Phase-specific message handlers

func (m Model) handleSlackCredentials(msg slackCredentialsMsg) (tea.Model, tea.Cmd) {
	m.preflight[msg.idx].Done = true
	if msg.err != nil {
		m.preflight[msg.idx].Passed = false
		m.preflight[msg.idx].Error = msg.err.Error()
		if m.config.Slack.AWSProfile != "" {
			m.preflight[msg.idx].Hint = fmt.Sprintf("run: aws sso login --profile %s", m.config.Slack.AWSProfile)
		}
		logger.Log("preflight: WARN Slack notifications — %s (notifications disabled)", msg.err)
		if m.config.Slack.AWSProfile != "" {
			logger.Log("slack: hint — run: aws sso login --profile %s", m.config.Slack.AWSProfile)
		}
	} else {
		m.preflight[msg.idx].Passed = true
		m.slack = slack.New(msg.token, msg.channelID)
		logger.Log("preflight: PASS Slack notifications")
	}

	return m, m.preflightDoneIfReady()
}

func (m Model) handlePreflightResult(msg preflightResultMsg) (tea.Model, tea.Cmd) {
	m.preflight[msg.idx].Done = true
	m.preflight[msg.idx].Passed = msg.passed
	m.preflight[msg.idx].Error = msg.err

	if m.preflight[msg.idx].Name == "aws CLI authenticated" && !msg.passed && m.config.Lock.AWSProfile != "" {
		m.preflight[msg.idx].Hint = fmt.Sprintf("run: aws sso login --profile %s", m.config.Lock.AWSProfile)
	}

	if msg.passed {
		if msg.err != "" {
			logger.Log("preflight: WARN %s — %s", m.preflight[msg.idx].Name, msg.err)
		} else {
			logger.Log("preflight: PASS %s", m.preflight[msg.idx].Name)
		}
	} else {
		logger.Log("preflight: FAIL %s — %s", m.preflight[msg.idx].Name, msg.err)
	}

	return m, m.preflightDoneIfReady()
}

func (m Model) preflightDoneIfReady() tea.Cmd {
	for _, check := range m.preflight {
		if !check.Done {
			return nil
		}
	}
	return func() tea.Msg { return preflightDoneMsg{} }
}

func (m Model) handlePreflightDone() (tea.Model, tea.Cmd) {
	printCmd := printAbove(m.preflightString())

	for _, check := range m.preflight {
		if !check.Passed && check.Required {
			m.phase = phaseAborted
			m.statusMessage = "Preflight checks failed"
			logger.Log("preflight: FAILED — aborting")
			return m, tea.Sequence(printCmd, tea.Quit)
		}
	}

	hasOptionalFailures := false
	for _, check := range m.preflight {
		if !check.Passed && !check.Required {
			hasOptionalFailures = true
			break
		}
	}

	if hasOptionalFailures {
		logger.Log("preflight: optional checks failed — prompting user")
		m.phase = phaseSlackWarning
		m.fv.confirm = true
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewConfirm().
					Title("Continue without Slack notifications?").
					Affirmative("Yes, continue").
					Negative("No, abort").
					Value(&m.fv.confirm),
			),
		)
		return m, tea.Batch(printCmd, m.form.Init())
	}

	logger.Log("preflight: all checks passed")
	m, cmd := m.startLockAcquire()
	return m, tea.Batch(printCmd, cmd)
}

func (m Model) startLockAcquire() (Model, tea.Cmd) {
	if m.config.Lock.SSMParameter == "" {
		m.phase = phaseSnapshot
		return m, fetchSnapshot(m.pipeline, m.ctx)
	}
	m.phase = phaseLockAcquire
	return m, acquireLockCmd(m.ctx, m.config.Lock, m.operator, m.branch)
}

func (m Model) handleLockAcquire(msg lockAcquireMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.phase = phaseAborted
		m.statusMessage = fmt.Sprintf("Failed to acquire deploy lock: %s", msg.err)
		logger.Log("lock: FAILED — %s", msg.err)
		return m, tea.Sequence(
			printAbove(failedMessageStyle.Render(m.statusMessage)),
			tea.Quit,
		)
	}
	m.lockHeld = true
	logger.Log("lock: acquired by %s", m.operator)
	m.phase = phaseSnapshot
	return m, fetchSnapshot(m.pipeline, m.ctx)
}

func (m Model) handleSnapshotResult(msg snapshotResultMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.phase = phaseAborted
		m.statusMessage = fmt.Sprintf("Failed to fetch rollback snapshot: %s", msg.err)
		logger.Log("snapshot: FAILED — %s", msg.err)
		return m, tea.Batch(
			printAbove(failedMessageStyle.Render(m.statusMessage)),
			m.exitCleanupCmd(false),
		)
	}

	m.pipeline.Snapshot = msg.snapshot
	snap := msg.snapshot
	logger.Log("snapshot: artifact_id=%s agent=%s preview=%s publish=%s", snap.ArtifactID, snap.AgentImageTag, snap.PreviewImageTag, snap.PublishImageTag)
	logger.Log("snapshot: app_source=%s images_source=%s", snap.AppSourceURL, snap.ImagesSourceURL)

	if m.autoApprove {
		logger.Log("snapshot: auto-approved")
		m.phase = phaseReleaseNotes
		return m, tea.Batch(printAbove(m.snapshotString()), fetchReleaseNotes(m.pipeline, m.ctx))
	}

	m.phase = phaseSnapshotConfirm
	m.fv.confirm = true
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("Are these rollback values correct?").
				Affirmative("Yes").
				Negative("No, abort").
				Value(&m.fv.confirm),
		),
	)
	return m, m.form.Init()
}

func (m Model) handleStageComplete(msg stageCompleteMsg) (tea.Model, tea.Cmd) {
	if m.phase == phaseAborted {
		return m, nil
	}

	stages := m.pipeline.Stages()
	sr := stages[msg.idx]

	if sr.Env == "rollback" {
		if m.phase == phaseRollbackRunning {
			return m, tea.Batch(printAbove(m.stageString(sr)), m.checkRollbackCompletion())
		}
		return m, nil
	}

	if sr.Stage.Type == "checklist" && sr.State != pipeline.StateSuccess {
		if m.autoApprove {
			m.pipeline.CompleteChecklist(msg.idx)
			m.phase = phaseRunning
			return m, tea.Batch(
				printAbove(m.stageString(stages[msg.idx])),
				m.slackUpdateCmd(false),
				m.checkGroupCompletion(),
			)
		}
		cmd := m.buildChecklistForm(msg.idx, sr)
		return m, cmd
	}

	if msg.err != nil {
		if m.form != nil {
			m.deferredFailures = append(m.deferredFailures, msg.idx)
			return m, tea.Batch(printAbove(m.stageString(sr)), m.slackUpdateCmd(false))
		}
		m.failedStageIdx = msg.idx
		failCmd := m.buildFailureForm()
		return m, tea.Batch(printAbove(m.stageString(sr)), m.slackUpdateCmd(false), failCmd)
	}

	return m, tea.Batch(printAbove(m.stageString(sr)), m.slackUpdateCmd(false), m.checkGroupCompletion())
}

func (m Model) handleGroupComplete(msg groupCompleteMsg) (tea.Model, tea.Cmd) {
	if m.phase == phaseAborted {
		return m, nil
	}
	// Guard against duplicate groupCompleteMsg from parallel stages in the same
	// group that both call checkGroupCompletion before either is processed.
	if msg.group != m.currentGroupIdx {
		return m, nil
	}

	m.currentGroupIdx++

	if m.currentGroupIdx >= len(m.envGroups) {
		return m.advanceEnvironment()
	}

	return m, m.runGroup()
}

func (m Model) advanceEnvironment() (tea.Model, tea.Cmd) {
	nextEnvIdx := m.currentEnvIdx + 1
	if nextEnvIdx >= len(m.envOrder) {
		m.phase = phaseComplete
		logger.Log("pipeline: all environments complete")
		if m.autoApprove {
			return m, tea.Batch(
				printAbove(successMessageStyle.Render(fmt.Sprintf("Release complete! (%s)", m.elapsed()))),
				m.exitCleanupCmd(true),
			)
		}
		cmd := m.buildCompleteForm()
		return m, tea.Batch(cmd, m.slackUpdateCmd(true))
	}

	if m.autoApprove {
		m.currentEnvIdx++
		logger.Log("gate: auto-approved deploy to %s", m.envOrder[m.currentEnvIdx])
		m.phase = phaseRunning
		cmd := m.setupEnvironment()
		return m, tea.Batch(cmd, m.slackUpdateCmd(false))
	}

	m.phase = phaseGate
	m.fv.confirm = true
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title(fmt.Sprintf("Deploy to %s?", m.envOrder[nextEnvIdx])).
				Affirmative("Yes, deploy").
				Negative("No, abort").
				Value(&m.fv.confirm),
		),
	)
	return m, m.form.Init()
}

// Form builders

func (m *Model) buildChecklistForm(idx int, sr *pipeline.StageRun) tea.Cmd {
	m.checklistStageIdx = idx
	m.phase = phaseChecklist

	options := make([]huh.Option[int], len(sr.Stage.Items))
	for i, item := range sr.Stage.Items {
		options[i] = huh.NewOption(item, i)
	}

	m.fv.checked = nil
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[int]().
				Title(sr.Stage.Name+" — check all items, then submit (unchecked = fail)").
				Options(options...).
				Height(len(sr.Stage.Items)+1).
				Value(&m.fv.checked),
		),
	).WithWidth(m.width)
	return m.form.Init()
}

func (m *Model) buildFailureForm() tea.Cmd {
	m.phase = phaseFailurePrompt
	m.fv.choice = ""

	options := []huh.Option[string]{
		huh.NewOption("Retry — re-trigger with same inputs", "retry"),
		huh.NewOption("Continue — skip and proceed", "continue"),
	}
	if m.currentEnvIdx > 0 {
		options = append(options, huh.NewOption("Rollback — revert to previous production state", "rollback"))
	}
	options = append(options, huh.NewOption("Abort — stop the pipeline", "abort"))

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("What would you like to do?").
				Options(options...).
				Value(&m.fv.choice),
		),
	)
	return m.form.Init()
}

func (m *Model) buildCompleteForm() tea.Cmd {
	m.fv.choice = ""
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(fmt.Sprintf("Release complete! (%s) What would you like to do?", m.elapsed())).
				Options(
					huh.NewOption("Done — exit", "done"),
					huh.NewOption("Rollback — revert to previous production state", "rollback"),
				).
				Value(&m.fv.choice),
		),
	)
	return m.form.Init()
}

func (m *Model) buildRollbackConfirmForm() tea.Cmd {
	m.fv.confirm = true
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("Proceed with rollback?").
				Affirmative("Yes, rollback").
				Negative("No, go back").
				Value(&m.fv.confirm),
		),
	)
	return m.form.Init()
}

// Commands

func checkGHInstalled(runner gh.Runner, ctx context.Context) tea.Cmd {
	return func() tea.Msg {
		if _, err := runner.Version(ctx); err != nil {
			return preflightResultMsg{idx: 0, passed: false, err: "gh CLI not found. Install: https://cli.github.com/"}
		}
		return preflightResultMsg{idx: 0, passed: true}
	}
}

func checkGHVersion(runner gh.Runner, ctx context.Context) tea.Cmd {
	return func() tea.Msg {
		version, err := runner.Version(ctx)
		if err != nil {
			return preflightResultMsg{idx: 1, passed: false, err: err.Error()}
		}
		if !isVersionSufficient(version, 2, 87, 0) {
			return preflightResultMsg{idx: 1, passed: false, err: fmt.Sprintf("gh %s < 2.87.0. Run: gh upgrade", version)}
		}
		return preflightResultMsg{idx: 1, passed: true}
	}
}

func checkGHAuth(runner gh.Runner, ctx context.Context) tea.Cmd {
	return func() tea.Msg {
		if err := runner.AuthStatus(ctx); err != nil {
			return preflightResultMsg{idx: 2, passed: false, err: "Not authenticated. Run: gh auth login"}
		}
		return preflightResultMsg{idx: 2, passed: true}
	}
}

func checkRepoAccess(runner gh.Runner, ctx context.Context, repos []string) tea.Cmd {
	var cmds []tea.Cmd
	for i, repo := range repos {
		idx := 3 + i
		r := repo
		cmds = append(cmds, func() tea.Msg {
			if err := runner.CheckRepoAccess(ctx, r); err != nil {
				return preflightResultMsg{idx: idx, passed: false, err: fmt.Sprintf("No access. Verify: gh api repos/%s --jq .id", r)}
			}
			return preflightResultMsg{idx: idx, passed: true}
		})
	}
	return tea.Batch(cmds...)
}

func (m Model) handleReleaseNotes(msg releaseNotesMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		logger.Log("release-notes: FAILED — %s (continuing without notes)", msg.err)
	} else {
		m.releaseNotes = msg.notes
		m.releaseNotesURL = msg.htmlURL
		logger.Log("release-notes: found %d PRs", len(msg.notes))
		for _, n := range msg.notes {
			logger.Log("release-notes: #%d %s (@%s)", n.Number, n.Title, n.Author)
		}
	}

	if m.autoApprove {
		logger.Log("release-notes: auto-approved")
		m.phase = phaseRunning
		m.currentEnvIdx = 0
		m.startTime = time.Now()
		cmd := m.setupEnvironment()
		return m, tea.Batch(printAbove(m.releaseNotesString()), cmd)
	}

	m.fv.confirm = true
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("Deploy these changes?").
				Affirmative("Yes, deploy").
				Negative("No, abort").
				Value(&m.fv.confirm),
		),
	)
	return m, tea.Batch(printAbove(m.releaseNotesString()), m.form.Init())
}

func fetchReleaseNotes(p *pipeline.Pipeline, ctx context.Context) tea.Cmd {
	return func() tea.Msg {
		notes, htmlURL, err := p.FetchReleaseNotes(ctx)
		return releaseNotesMsg{notes: notes, htmlURL: htmlURL, err: err}
	}
}

func fetchSnapshot(p *pipeline.Pipeline, ctx context.Context) tea.Cmd {
	return func() tea.Msg {
		err := p.FetchRollbackSnapshot(ctx)
		return snapshotResultMsg{snapshot: p.Snapshot, err: err}
	}
}

// setupEnvironment builds stages for the current environment.
// Pointer receiver so envGroups / currentGroupIdx persist.
func (m *Model) setupEnvironment() tea.Cmd {
	if m.currentEnvIdx >= len(m.envOrder) {
		return nil
	}

	envName := m.envOrder[m.currentEnvIdx]
	logger.Log("environment: starting %s deployment", strings.ToUpper(envName))
	if err := m.pipeline.BuildStages(envName); err != nil {
		return func() tea.Msg {
			return stageCompleteMsg{err: err}
		}
	}

	m.envGroups = m.pipeline.StageGroups(envName)
	m.currentGroupIdx = 0

	envHeader := fmt.Sprintf("\n%s", sectionStyle.Render(strings.ToUpper(envName)+" Deployment"))
	return tea.Batch(printAbove(envHeader), m.runGroup())
}

func (m Model) runGroup() tea.Cmd {
	if m.currentGroupIdx >= len(m.envGroups) {
		return func() tea.Msg {
			return groupCompleteMsg{env: m.envOrder[m.currentEnvIdx], group: m.currentGroupIdx}
		}
	}

	group := m.envGroups[m.currentGroupIdx]
	var cmds []tea.Cmd

	for _, idx := range group {
		cmds = append(cmds, m.runStageCmd(idx))
	}

	return tea.Batch(append(cmds, tickCmd())...)
}

func (m Model) runStageCmd(idx int) tea.Cmd {
	return func() tea.Msg {
		stages := m.pipeline.Stages()
		sr := stages[idx]

		if sr.Stage.Type == "checklist" {
			m.pipeline.RunStage(m.ctx, idx)
			return stageCompleteMsg{idx: idx}
		}

		return stageCompleteMsg{idx: idx, err: m.pipeline.RunStage(m.ctx, idx)}
	}
}

func (m Model) checkGroupCompletion() tea.Cmd {
	if m.currentGroupIdx >= len(m.envGroups) {
		return func() tea.Msg {
			return groupCompleteMsg{env: m.envOrder[m.currentEnvIdx], group: m.currentGroupIdx}
		}
	}

	group := m.envGroups[m.currentGroupIdx]
	stages := m.pipeline.Stages()

	for _, idx := range group {
		sr := stages[idx]
		if sr.State != pipeline.StateSuccess && sr.State != pipeline.StateSkipped {
			return nil
		}
	}

	return func() tea.Msg {
		return groupCompleteMsg{env: m.envOrder[m.currentEnvIdx], group: m.currentGroupIdx}
	}
}

// Pointer receiver so rollbackIdxs / rollbackGroups persist.
func (m *Model) runRollback() tea.Cmd {
	if len(m.config.Pipeline.Rollback.Steps) == 0 {
		return func() tea.Msg {
			return rollbackDoneMsg{hasErrors: false}
		}
	}

	stages := m.pipeline.Stages()
	m.rollbackIdxs = nil
	for i, sr := range stages {
		if sr.Env == "rollback" {
			m.rollbackIdxs = append(m.rollbackIdxs, i)
		}
	}

	m.rollbackGroups = m.pipeline.StageGroups("rollback")
	m.rollbackGroupIdx = 0

	return tea.Batch(
		printAbove("\n"+sectionStyle.Render("ROLLBACK")),
		m.runRollbackGroup(),
	)
}

func (m Model) runRollbackGroup() tea.Cmd {
	if m.rollbackGroupIdx >= len(m.rollbackGroups) {
		return func() tea.Msg {
			return rollbackDoneMsg{hasErrors: false}
		}
	}

	group := m.rollbackGroups[m.rollbackGroupIdx]
	var cmds []tea.Cmd
	for _, idx := range group {
		cmds = append(cmds, m.runStageCmd(idx))
	}
	return tea.Batch(append(cmds, tickCmd())...)
}

func (m Model) checkRollbackCompletion() tea.Cmd {
	if m.rollbackGroupIdx >= len(m.rollbackGroups) {
		return nil
	}

	group := m.rollbackGroups[m.rollbackGroupIdx]
	stages := m.pipeline.Stages()

	for _, idx := range group {
		switch stages[idx].State {
		case pipeline.StateSuccess, pipeline.StateSkipped, pipeline.StateFailed:
			continue
		default:
			return nil
		}
	}

	for _, idx := range group {
		if stages[idx].State == pipeline.StateFailed {
			return func() tea.Msg {
				return rollbackDoneMsg{hasErrors: true}
			}
		}
	}

	return func() tea.Msg {
		return rollbackGroupDoneMsg{group: m.rollbackGroupIdx}
	}
}

func (m Model) handleRollbackGroupDone(msg rollbackGroupDoneMsg) (tea.Model, tea.Cmd) {
	if msg.group != m.rollbackGroupIdx {
		return m, nil
	}

	m.rollbackGroupIdx++
	if m.rollbackGroupIdx >= len(m.rollbackGroups) {
		return m, func() tea.Msg {
			return rollbackDoneMsg{hasErrors: false}
		}
	}
	return m, m.runRollbackGroup()
}

func (m Model) handleRollbackDone(msg rollbackDoneMsg) (tea.Model, tea.Cmd) {
	if msg.hasErrors {
		m.phase = phaseAborted
		m.statusMessage = "Rollback had failures — check output above"
		logger.Log("rollback: FAILED — rollback had errors")
		return m, tea.Batch(
			printAbove(failedMessageStyle.Render(m.statusMessage)),
			m.exitCleanupCmd(true),
		)
	}
	m.phase = phaseComplete
	m.statusMessage = "Rollback complete!"
	logger.Log("rollback: completed successfully")
	return m, tea.Batch(
		printAbove(successMessageStyle.Render(fmt.Sprintf("Rollback complete! (%s)", m.elapsed()))),
		m.exitCleanupCmd(true),
	)
}

func isVersionSufficient(versionStr string, major, minor, patch int) bool {
	var ma, mi, pa int
	if _, err := fmt.Sscanf(extractVersion(versionStr), "%d.%d.%d", &ma, &mi, &pa); err != nil {
		return false
	}
	if ma != major {
		return ma > major
	}
	if mi != minor {
		return mi > minor
	}
	return pa >= patch
}

func extractVersion(s string) string {
	for i, c := range s {
		if c >= '0' && c <= '9' {
			for j := i; j < len(s); j++ {
				if s[j] != '.' && (s[j] < '0' || s[j] > '9') {
					return s[i:j]
				}
			}
			return s[i:]
		}
	}
	return s
}
