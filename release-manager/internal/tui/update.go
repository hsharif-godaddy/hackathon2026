package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/release-manager/internal/gh"
	"github.com/airo-ai-builder/release-manager/internal/lock"
	"github.com/airo-ai-builder/release-manager/internal/logger"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/slack"
)

const cleanupTimeout = 2 * time.Minute

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

func (m Model) startExitCleanup(sendSlack bool, createRelease bool) (Model, tea.Cmd) {
	cmd := m.exitCleanupCmd(sendSlack, createRelease)
	message := m.cleanupStatus(sendSlack, createRelease)
	if message == "" {
		return m, cmd
	}

	m.form = nil
	m.phase = phaseCleanup
	m.statusMessage = message
	return m, tea.Batch(m.spinner.Tick, cmd)
}

func (m Model) cleanupStatus(sendSlack bool, createRelease bool) string {
	var actions []string
	if createRelease && !m.noRelease && m.config != nil && m.config.Release.Enabled && m.config.Release.Repo != "" {
		actions = append(actions, "creating GitHub release")
	}
	if sendSlack && m.slack != nil && m.pipeline != nil && len(m.pipeline.Stages()) > 0 {
		actions = append(actions, "updating Slack")
	}
	if m.lockHeld && m.config != nil && m.config.Lock.SSMParameter != "" {
		actions = append(actions, "releasing deploy lock")
	}
	if len(actions) == 0 {
		return ""
	}
	return "Finalizing: " + strings.Join(actions, ", ") + "..."
}

// exitCleanupCmd runs final Slack update, optional GitHub release creation,
// and lock release in a background goroutine, then sends exitCleanupDoneMsg
// to trigger tea.Quit. This avoids blocking the Bubble Tea event loop
// during cleanup I/O.
func (m Model) exitCleanupCmd(sendSlack bool, createRelease bool) tea.Cmd {
	n := m.slack
	p := m.pipeline
	lockCfg := m.config.Lock
	lockHeld := m.lockHeld
	releaseCfg := m.config.Release

	wantRelease := createRelease && !m.noRelease && releaseCfg.Enabled && releaseCfg.Repo != ""

	var slackText string
	if ((sendSlack && n != nil) || wantRelease) && len(p.Stages()) > 0 {
		slackText = m.slackMessage(true)
	}

	if slackText == "" && !wantRelease && (!lockHeld || lockCfg.SSMParameter == "") {
		return tea.Quit
	}

	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), cleanupTimeout)
		defer cancel()

		if wantRelease && slackText == "" {
			logger.Log("release.skip: no message content available for release body")
		}
		if wantRelease && slackText != "" {
			tag, err := p.GenerateReleaseTag(ctx)
			if err != nil {
				logger.Log("release.error: generating tag: %s", err)
			} else {
				releaseText := slackText
				if i := strings.Index(releaseText, "\n"); i >= 0 {
					releaseText = strings.TrimLeft(releaseText[i+1:], "\n")
				}
				releaseText = slackEmojiToUnicode(releaseText)
				releaseText = strings.ReplaceAll(releaseText, blankLine, "")
				if n != nil {
					if permalink := n.Permalink(); permalink != "" {
						releaseText += fmt.Sprintf("\n\n---\n[Slack thread](%s)", permalink)
					}
				}
				releaseURL, err := p.CreateRelease(ctx, tag, tag, releaseText)
				if err != nil {
					logger.Log("release.error: creating release: %s", err)
				} else {
					slackText += fmt.Sprintf("\n\n:label: [%s](%s)", tag, releaseURL)
				}
			}
		}

		if slackText != "" && n != nil {
			n.Update(ctx, slackText)
		}
		if lockHeld && lockCfg.SSMParameter != "" {
			lock.Release(ctx, lockCfg.SSMParameter, lockCfg.AWSProfile)
		}
		if err := ctx.Err(); err != nil {
			logger.Log("cleanup.warning: final cleanup may not have completed: %s", err)
			return exitCleanupDoneMsg{warning: "Final cleanup may not have completed; check logs."}
		}
		return exitCleanupDoneMsg{}
	}
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.BackgroundColorMsg:
		m.hasDarkBG = msg.IsDark()
		m.theme = themeForBackground(m.hasDarkBG)
		m.spinner.Style = lipgloss.NewStyle().Foreground(m.theme.Running)
		return m, nil

	case spinner.TickMsg:
		if m.phase == phaseComplete || m.phase == phaseCleanupDone || m.phase == phaseAborted {
			return m, nil
		}
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyPressMsg:
		if msg.String() == "ctrl+c" || msg.String() == "q" {
			if m.phase == phaseCleanup || m.phase == phaseCleanupDone {
				logger.Log("cleanup: ignored %s while final cleanup is in progress", msg.String())
				return m, nil
			}
			if m.form != nil && msg.String() == "q" {
				break
			}
			m.cancel()
			m.phase = phaseAborted
			m.statusMessage = "Aborted by user"
			logger.Log("USER: aborted via %s", msg.String())
			return m.startExitCleanup(true, false)
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
		m.phase = phaseCleanupDone
		m.cleanupWarning = msg.warning
		if msg.warning != "" {
			m.statusMessage = msg.warning
		} else {
			m.statusMessage = "Final cleanup complete."
		}
		return m, tea.Tick(500*time.Millisecond, func(_ time.Time) tea.Msg {
			return cleanupQuitMsg{}
		})

	case cleanupQuitMsg:
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
			return m.startExitCleanup(false, false)
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
			return m.startExitCleanup(false, false)
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
			return m.startExitCleanup(true, false)
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
			if failCmd := m.buildNextFailureForm(); failCmd != nil {
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
		logger.Log("failure-prompt: user chose %q for stage %q", m.fv.choice, m.failedStageName())
		switch m.fv.choice {
		case "retry":
			retryIdx := m.failedStageIdx
			m.pipeline.RetryStage(retryIdx)
			m.phase = phaseRunning
			return m, tea.Batch(tickCmd(), m.runStageCmd(retryIdx))
		case "continue":
			m.pipeline.SkipStage(m.failedStageIdx)
			sr := m.pipeline.Stages()[m.failedStageIdx]
			if failCmd := m.buildNextFailureForm(); failCmd != nil {
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
			return m.startExitCleanup(true, false)
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
		m, cleanupCmd := m.startExitCleanup(true, true)
		return m, tea.Batch(
			printAbove(m.theme.SuccessMessageStyle.Render(fmt.Sprintf("Release complete! (%s)", m.elapsed()))),
			cleanupCmd,
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
	if strings.HasPrefix(m.preflight[msg.idx].Name, "access to ") && !msg.passed {
		m.preflight[msg.idx].Hint = "request JOMAX AD group for the org, then ask a repo admin for write access"
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
			printAbove(m.theme.FailedMessageStyle.Render(m.statusMessage)),
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
		m, cleanupCmd := m.startExitCleanup(false, false)
		return m, tea.Batch(
			printAbove(m.theme.FailedMessageStyle.Render(m.statusMessage)),
			cleanupCmd,
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
			m.deferFailure(msg.idx)
			return m, tea.Batch(printAbove(m.stageString(sr)), m.slackUpdateCmd(false))
		}
		m.failedStageIdx = msg.idx
		failCmd := m.buildFailureForm()
		return m, tea.Batch(printAbove(m.stageString(sr)), m.slackUpdateCmd(false), failCmd)
	}

	printCmd := printAbove(m.stageString(sr))
	if m.form != nil {
		return m, tea.Batch(printCmd, m.slackUpdateCmd(false))
	}
	if failCmd := m.buildNextFailureForm(); failCmd != nil {
		return m, tea.Batch(printCmd, m.slackUpdateCmd(false), failCmd)
	}
	return m, tea.Batch(printCmd, m.slackUpdateCmd(false), m.checkGroupCompletion())
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
			m, cleanupCmd := m.startExitCleanup(true, true)
			return m, tea.Batch(
				printAbove(m.theme.SuccessMessageStyle.Render(fmt.Sprintf("Release complete! (%s)", m.elapsed()))),
				cleanupCmd,
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
				Title(sr.Stage.Name + " — check all items, then submit (unchecked = fail)").
				Options(options...).
				Height(len(sr.Stage.Items) + 1).
				Value(&m.fv.checked),
		),
	).WithWidth(m.width)
	return m.form.Init()
}

func (m *Model) buildFailureForm() tea.Cmd {
	m.phase = phaseFailurePrompt
	m.fv.choice = ""
	failedStageName := m.failedStageName()

	options := []huh.Option[string]{
		huh.NewOption(fmt.Sprintf("Retry — re-trigger %s with same inputs", failedStageName), "retry"),
		huh.NewOption(fmt.Sprintf("Continue — skip %s and proceed", failedStageName), "continue"),
	}
	if m.currentEnvIdx > 0 {
		options = append(options, huh.NewOption("Rollback — revert to previous production state", "rollback"))
	}
	options = append(options, huh.NewOption("Abort — stop the pipeline", "abort"))

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(m.failurePromptTitle()).
				Options(options...).
				Value(&m.fv.choice),
		),
	)
	return m.form.Init()
}

func (m Model) failedStageName() string {
	if sr, ok := m.failedStage(); ok {
		return sr.Stage.Name
	}
	return "stage"
}

func (m Model) failurePromptTitle() string {
	sr, ok := m.failedStage()
	if !ok {
		return "Stage failed. What would you like to do?"
	}

	title := fmt.Sprintf("%s failed: %s", strings.ToUpper(sr.Env), sr.Stage.Name)
	if sr.Error != "" {
		return fmt.Sprintf("%s\n%s", title, sr.Error)
	}
	return title
}

func (m Model) failedStage() (*pipeline.StageRun, bool) {
	if m.pipeline == nil {
		return nil, false
	}
	stages := m.pipeline.Stages()
	if m.failedStageIdx < 0 || m.failedStageIdx >= len(stages) {
		return nil, false
	}
	return stages[m.failedStageIdx], true
}

func (m *Model) deferFailure(idx int) {
	if m.phase == phaseFailurePrompt && idx == m.failedStageIdx {
		logger.Log("defer-failure.skipped: already prompting for idx=%d", idx)
		return
	}
	for _, existing := range m.deferredFailures {
		if existing == idx {
			return
		}
	}
	m.deferredFailures = append(m.deferredFailures, idx)
}

func (m *Model) buildNextFailureForm() tea.Cmd {
	stages := m.pipeline.Stages()
	for len(m.deferredFailures) > 0 {
		idx := m.deferredFailures[0]
		m.deferredFailures = m.deferredFailures[1:]
		if idx < 0 || idx >= len(stages) {
			logger.Log("deferred-failure.discarded: idx=%d state=invalid", idx)
			continue
		}
		switch stages[idx].State {
		case pipeline.StateFailed:
			m.failedStageIdx = idx
			return m.buildFailureForm()
		case pipeline.StatePending, pipeline.StateRunning, pipeline.StateParsingOutputs:
			m.deferredFailures = append([]int{idx}, m.deferredFailures...)
			return nil
		default:
			logger.Log("deferred-failure.discarded: idx=%d state=%s", idx, stages[idx].State)
		}
	}
	return nil
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
				return preflightResultMsg{idx: idx, passed: false, err: err.Error()}
			}
			return preflightResultMsg{idx: idx, passed: true}
		})
	}
	return tea.Batch(cmds...)
}

func (m Model) handleReleaseNotes(msg releaseNotesMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		logger.Log("release-notes: FAILED — %s (continuing without notes)", msg.err)
		m.releaseNotesErr = msg.err.Error()
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

	envHeader := fmt.Sprintf("\n%s", m.theme.SectionStyle.Render(strings.ToUpper(envName)+" Deployment"))
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
			_ = m.pipeline.RunStage(m.ctx, idx)
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
		printAbove("\n"+m.theme.SectionStyle.Render("ROLLBACK")),
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
		m, cleanupCmd := m.startExitCleanup(true, false)
		return m, tea.Batch(
			printAbove(m.theme.FailedMessageStyle.Render(m.statusMessage)),
			cleanupCmd,
		)
	}
	m.phase = phaseComplete
	m.statusMessage = "Rollback complete!"
	logger.Log("rollback: completed successfully")
	m, cleanupCmd := m.startExitCleanup(true, false)
	return m, tea.Batch(
		printAbove(m.theme.SuccessMessageStyle.Render(fmt.Sprintf("Rollback complete! (%s)", m.elapsed()))),
		cleanupCmd,
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
