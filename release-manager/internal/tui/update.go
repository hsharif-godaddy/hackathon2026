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

func (m Model) startExitCleanup(sendSlack bool) (Model, tea.Cmd) {
	cmd := m.exitCleanupCmd(sendSlack)
	message := m.cleanupStatus(sendSlack)
	if message == "" {
		return m, cmd
	}

	m.form = nil
	m.phase = phaseCleanup
	m.statusMessage = message
	return m, tea.Batch(m.spinner.Tick, cmd)
}

func (m Model) cleanupStatus(sendSlack bool) string {
	var actions []string
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

// exitCleanupCmd runs final Slack update and lock release in a background
// goroutine, then sends exitCleanupDoneMsg to trigger tea.Quit. GitHub
// release creation now happens earlier (at phaseCreatingRelease, before the
// Done/Rollback prompt) so that closing the terminal at the prompt does not
// strand the release.
func (m Model) exitCleanupCmd(sendSlack bool) tea.Cmd {
	n := m.slack
	p := m.pipeline
	lockCfg := m.config.Lock
	lockHeld := m.lockHeld

	var slackText string
	if sendSlack && n != nil && p != nil && len(p.Stages()) > 0 {
		slackText = m.slackMessage(true)
	}

	if slackText == "" && (!lockHeld || lockCfg.SSMParameter == "") {
		return tea.Quit
	}

	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), cleanupTimeout)
		defer cancel()

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

// shouldCreateRelease mirrors the predicate that exitCleanupCmd previously
// used to gate inline release creation. Returns true if a GitHub release
// should be cut at the "Complete" moment.
func (m Model) shouldCreateRelease() bool {
	if m.noRelease || m.config == nil || !m.config.Release.Enabled || m.config.Release.Repo == "" {
		return false
	}
	if m.pipeline == nil || len(m.pipeline.Stages()) == 0 {
		return false
	}
	return true
}

// startReleaseCreation enters phaseCreatingRelease and dispatches the GH
// release creation in a background command. If release creation is disabled,
// it short-circuits with a no-op releaseCreatedMsg so the rest of the flow
// always funnels through handleReleaseCreated. Both paths use
// phaseCreatingRelease so handleReleaseCreated's phase guard rejects late
// messages that arrive after ctrl+c has flipped the phase.
func (m Model) startReleaseCreation() (Model, tea.Cmd) {
	m.phase = phaseCreatingRelease
	if !m.shouldCreateRelease() {
		m.statusMessage = "Finalizing..."
		return m, func() tea.Msg { return releaseCreatedMsg{} }
	}
	m.statusMessage = "Finalizing: creating GitHub release..."
	slackText := m.slackMessage(true)
	return m, tea.Batch(m.spinner.Tick, createReleaseAtCompleteCmd(m.pipeline, m.slack, m.ctx, slackText))
}

// createReleaseAtCompleteCmd generates a release tag and cuts the GitHub
// release using slackText (without the not-yet-existent release link) as the
// source for the release body.
func createReleaseAtCompleteCmd(p *pipeline.Pipeline, n *slack.Notifier, parent context.Context, slackText string) tea.Cmd {
	var permalink string
	if n != nil {
		permalink = n.Permalink()
	}
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(parent, cleanupTimeout)
		defer cancel()

		tag, err := p.GenerateReleaseTag(ctx)
		if err != nil {
			return releaseCreatedMsg{err: fmt.Errorf("generating tag: %w", err)}
		}

		body := buildReleaseBody(slackText, permalink)

		url, err := p.CreateRelease(ctx, tag, tag, body)
		if err != nil {
			return releaseCreatedMsg{err: fmt.Errorf("creating release: %w", err)}
		}

		return releaseCreatedMsg{tag: tag, url: url}
	}
}

// deleteReleaseCmd compensates for a release cut at "Complete" when the
// operator confirms rollback or aborts after creation succeeded. Uses
// context.WithoutCancel so a parent cancellation (ctrl+c during
// phaseRollbackRunning, for example) does NOT abort the in-flight gh release
// delete — the compensation must run to completion or hit the timeout. The
// cmd is fire-and-forget; errors are logged, never returned as a message.
func deleteReleaseCmd(p *pipeline.Pipeline, parent context.Context, tag string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), cleanupTimeout)
		defer cancel()
		if err := p.DeleteRelease(ctx, tag); err != nil {
			logger.Log("release.delete.error: tag=%s err=%s", tag, err)
		}
		return nil
	}
}

// buildReleaseBody transforms a Slack message string into a GitHub release
// body: strips the operator/header line, converts Slack emoji to unicode,
// removes blankLine zero-width characters, and appends a Slack thread link
// when permalink is non-empty.
func buildReleaseBody(slackText, permalink string) string {
	if i := strings.Index(slackText, "\n"); i >= 0 {
		slackText = strings.TrimLeft(slackText[i+1:], "\n")
	}
	slackText = slackEmojiToUnicode(slackText)
	slackText = strings.ReplaceAll(slackText, blankLine, "")
	if permalink != "" {
		slackText += fmt.Sprintf("\n\n---\n[Slack thread](%s)", permalink)
	}
	return slackText
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
			return m.startExitCleanup(true)
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
		// Don't overwrite a pre-existing cleanupWarning. The release-create
		// failure path (handleReleaseCreated) sets cleanupWarning before the
		// exit-cleanup goroutine even runs; if cleanup itself succeeded
		// (msg.warning == ""), unconditionally clobbering it would render the
		// success checkmark over a real warning.
		if msg.warning != "" {
			m.cleanupWarning = msg.warning
		}
		if m.cleanupWarning != "" {
			m.statusMessage = m.cleanupWarning
		} else {
			m.statusMessage = "Final cleanup complete."
		}
		return m, tea.Tick(500*time.Millisecond, func(_ time.Time) tea.Msg {
			return cleanupQuitMsg{}
		})

	case cleanupQuitMsg:
		return m, tea.Quit

	case releaseCreatedMsg:
		return m.handleReleaseCreated(msg)

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
			return m.startExitCleanup(false)
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
			return m.startExitCleanup(false)
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
			return m.startExitCleanup(true)
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
			return m.startExitCleanup(true)
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
		// Release was already cut at phaseCreatingRelease; only Slack and lock
		// remain.
		m, cleanupCmd := m.startExitCleanup(true)
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
		cmds := []tea.Cmd{m.runRollback(), m.slackUpdateCmd(false)}
		// If a release was cut at "Complete", remove it now (best-effort).
		// Clear releaseTag/URL immediately so subsequent Slack updates don't
		// reference a release we're tearing down.
		if m.releaseTag != "" {
			logger.Log("release.delete.scheduled: tag=%s (rollback confirmed)", m.releaseTag)
			cmds = append(cmds, deleteReleaseCmd(m.pipeline, m.ctx, m.releaseTag))
			m.releaseTag = ""
			m.releaseURL = ""
		}
		return m, tea.Batch(cmds...)
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
		m, cleanupCmd := m.startExitCleanup(false)
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

// handleReleaseCreated finalizes the "Complete" moment after the GitHub
// release attempt resolves (success, error, or skip). On success it stores
// the tag/URL on the model so slackMessage(true) can include the link in the
// Slack "Complete" update. On error it logs and continues without a link.
// Then it routes interactive vs autoApprove just like the old
// advanceEnvironment did.
func (m Model) handleReleaseCreated(msg releaseCreatedMsg) (tea.Model, tea.Cmd) {
	// Only act on this message if we're still in phaseCreatingRelease. If
	// ctrl+c hit during release creation, phase will already have transitioned
	// (phaseAborted → phaseCleanup) and we must not clobber that state by
	// re-entering phaseComplete + spawning a second cleanup or overwriting
	// the abort Slack message.
	if m.phase != phaseCreatingRelease {
		// gh release create may have already succeeded on GitHub before the
		// operator's ctrl+c canceled m.ctx — the goroutine returns the URL
		// even though we're now aborting. Compensate by deleting the orphaned
		// release so it doesn't sit on the repo as a "ghost" release that
		// nobody asked for. deleteReleaseCmd uses WithoutCancel so the
		// already-canceled m.ctx doesn't kill the compensating delete.
		if msg.tag != "" {
			logger.Log("release.delete.scheduled: tag=%s url=%s (orphaned by abort during creation)", msg.tag, msg.url)
			return m, deleteReleaseCmd(m.pipeline, m.ctx, msg.tag)
		}
		return m, nil
	}

	if msg.err != nil {
		logger.Log("release.error: %s (continuing without release link)", msg.err)
		m.cleanupWarning = "GitHub release creation failed; check logs."
	} else if msg.tag != "" {
		m.releaseTag = msg.tag
		m.releaseURL = msg.url
		logger.Log("release.created: tag=%s url=%s", msg.tag, msg.url)
	}

	m.phase = phaseComplete

	if m.autoApprove {
		m, cleanupCmd := m.startExitCleanup(true)
		return m, tea.Batch(
			printAbove(m.theme.SuccessMessageStyle.Render(fmt.Sprintf("Release complete! (%s)", m.elapsed()))),
			cleanupCmd,
		)
	}

	cmd := m.buildCompleteForm()
	return m, tea.Batch(cmd, m.slackUpdateCmd(true))
}

func (m Model) advanceEnvironment() (tea.Model, tea.Cmd) {
	nextEnvIdx := m.currentEnvIdx + 1
	if nextEnvIdx >= len(m.envOrder) {
		logger.Log("pipeline: all environments complete")
		// Cut the GitHub release now (before Done/Rollback prompt) so closing
		// the terminal at the prompt does not strand it. Outcome lands in
		// handleReleaseCreated, which routes interactive vs autoApprove.
		return m.startReleaseCreation()
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
		m, cleanupCmd := m.startExitCleanup(true)
		return m, tea.Batch(
			printAbove(m.theme.FailedMessageStyle.Render(m.statusMessage)),
			cleanupCmd,
		)
	}
	m.phase = phaseComplete
	m.statusMessage = "Rollback complete!"
	logger.Log("rollback: completed successfully")
	m, cleanupCmd := m.startExitCleanup(true)
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
