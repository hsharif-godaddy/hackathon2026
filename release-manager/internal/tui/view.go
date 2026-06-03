package tui

import (
	"fmt"
	"sort"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/release-manager/internal/pipeline"
	"github.com/airo-ai-builder/release-manager/internal/render"
)

func (m Model) View() tea.View {
	var sb strings.Builder

	switch m.phase {
	case phasePreflight:
		sb.WriteString(m.headerString() + "\n")
		m.renderPreflight(&sb)

	case phaseSlackWarning:
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseLockAcquire:
		sb.WriteString("  " + m.spinner.View() + " Acquiring deploy lock...\n")

	case phaseSnapshot:
		sb.WriteString("  " + m.spinner.View() + " Fetching rollback snapshot...\n")

	case phaseSnapshotConfirm:
		m.renderSnapshot(&sb)
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseReleaseNotes:
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		} else {
			sb.WriteString("\n  " + m.spinner.View() + " Fetching release notes...\n")
		}

	case phaseRunning:
		m.renderActiveStages(&sb)

	case phaseGate:
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseChecklist:
		m.renderActiveStages(&sb)
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseFailurePrompt:
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseRollbackConfirm:
		m.renderRollbackSummary(&sb)
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseRollbackRunning:
		m.renderActiveRollbackStages(&sb)

	case phaseComplete:
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseCreatingRelease:
		sb.WriteString("  " + m.theme.SuccessMessageStyle.Render(m.spinner.View()+" "+m.statusMessage) + "\n")

	case phaseCleanup:
		sb.WriteString("  " + m.theme.SuccessMessageStyle.Render(m.spinner.View()+" "+m.statusMessage) + "\n")

	case phaseCleanupDone:
		if m.cleanupWarning != "" {
			sb.WriteString("  " + m.theme.PreflightWarnStyle.Render("⚠ "+m.statusMessage) + "\n")
		} else {
			sb.WriteString("  " + m.theme.SuccessMessageStyle.Render("✓ "+m.statusMessage) + "\n")
		}

	case phaseAborted:
		sb.WriteString(m.theme.FailedMessageStyle.Render(m.statusMessage) + "\n")
	}

	switch m.phase {
	case phaseCleanup:
		sb.WriteString(m.theme.HelpStyle.Render("please wait; final cleanup is in progress") + "\n")
	case phaseCleanupDone:
		sb.WriteString(m.theme.HelpStyle.Render("done; exiting") + "\n")
	default:
		sb.WriteString(m.theme.HelpStyle.Render("ctrl+c to quit") + "\n")
	}
	return tea.NewView(sb.String())
}

// renderPreflight shows running preflight checks (used only during phasePreflight).
func (m Model) renderPreflight(sb *strings.Builder) {
	sb.WriteString(m.theme.SectionStyle.Render("Preflight Checks") + "\n")
	for _, check := range m.preflight {
		if !check.Done {
			fmt.Fprintf(sb, "  %s %s\n",
				m.spinner.View(),
				check.Name,
			)
		} else if check.Passed {
			fmt.Fprintf(sb, "  %s %s\n",
				m.theme.PreflightPassStyle.Render("✓"),
				check.Name,
			)
		} else if !check.Required {
			fmt.Fprintf(sb, "  %s %s (disabled)\n",
				m.theme.PreflightWarnStyle.Render("⚠"),
				check.Name,
			)
			if check.Error != "" {
				fmt.Fprintf(sb, "    %s\n", m.theme.PreflightWarnStyle.Render(check.Error))
			}
			if check.Hint != "" {
				fmt.Fprintf(sb, "    %s\n", m.theme.MutedStyle.Render(check.Hint))
			}
		} else {
			fmt.Fprintf(sb, "  %s %s\n",
				m.theme.PreflightFailStyle.Render("✗"),
				check.Name,
			)
			if check.Error != "" {
				fmt.Fprintf(sb, "    %s\n", m.theme.PreflightFailStyle.Render(check.Error))
			}
			if check.Hint != "" {
				fmt.Fprintf(sb, "    %s\n", m.theme.MutedStyle.Render(check.Hint))
			}
		}
	}
}

func (m Model) headerString() string {
	header := m.theme.TitleStyle.Render("Release Manager")
	if m.dryRun {
		header += " " + m.theme.DryRunBadge.Render("DRY RUN")
	}
	return header
}

// preflightString renders header + preflight results for tea.Println.
func (m Model) preflightString() string {
	var sb strings.Builder
	sb.WriteString(m.headerString() + "\n")
	m.renderPreflight(&sb)
	return strings.TrimRight(sb.String(), "\n")
}

// renderSnapshot shows full snapshot details (used during phaseSnapshotConfirm).
func (m Model) renderSnapshot(sb *strings.Builder) {
	snap := m.pipeline.Snapshot
	if snap.ArtifactID == "" && snap.AgentImageTag == "" {
		return
	}

	sb.WriteString("\n" + m.theme.SectionStyle.Render("Rollback Snapshot (current production state)") + "\n")
	sb.WriteString(fmt.Sprintf("  %s %s\n", m.theme.SnapshotLabelStyle.Render("App artifact ID:"), m.theme.SnapshotValueStyle.Render(snap.ArtifactID)))
	sb.WriteString(fmt.Sprintf("  %s %s\n", m.theme.SnapshotLabelStyle.Render("Agent image tag:"), m.theme.SnapshotValueStyle.Render(snap.AgentImageTag)))
	sb.WriteString(fmt.Sprintf("  %s %s\n", m.theme.SnapshotLabelStyle.Render("Preview image tag:"), m.theme.SnapshotValueStyle.Render(snap.PreviewImageTag)))
	sb.WriteString(fmt.Sprintf("  %s %s\n", m.theme.SnapshotLabelStyle.Render("Publish image tag:"), m.theme.SnapshotValueStyle.Render(snap.PublishImageTag)))

	if snap.AppSourceURL != "" {
		sb.WriteString(fmt.Sprintf("\n  %s %s\n", m.theme.SnapshotLabelStyle.Render("App source:"), m.theme.SnapshotURLStyle.Render(snap.AppSourceURL)))
	}
	if snap.ImagesSourceURL != "" {
		sb.WriteString(fmt.Sprintf("  %s %s\n", m.theme.SnapshotLabelStyle.Render("Images source:"), m.theme.SnapshotURLStyle.Render(snap.ImagesSourceURL)))
	}
	if m.pipeline.BaseCommitOverride != "" {
		sb.WriteString(fmt.Sprintf("\n  %s %s\n",
			m.theme.SnapshotLabelStyle.Render("Release notes base:"),
			m.theme.SnapshotValueStyle.Render(m.pipeline.BaseCommitOverride+" (overridden via --rollback-base-commit)")))
	}
}

// snapshotString renders snapshot details for tea.Println.
func (m Model) snapshotString() string {
	var sb strings.Builder
	m.renderSnapshot(&sb)
	return strings.TrimRight(sb.String(), "\n")
}

func (m Model) renderReleaseNotes(sb *strings.Builder) {
	if m.releaseNotesErr != "" {
		sb.WriteString("\n" + m.theme.SectionStyle.Render("Release Notes") + "\n")
		sb.WriteString(fmt.Sprintf("  %s %s\n",
			m.theme.PreflightWarnStyle.Render("⚠"),
			m.theme.MutedStyle.Render("Failed to fetch release notes: "+m.releaseNotesErr)))
		m.renderPinnedCommit(sb)
		return
	}
	if len(m.releaseNotes) == 0 {
		sb.WriteString("\n" + m.theme.SectionStyle.Render("Release Notes") + "\n")
		sb.WriteString("  " + m.theme.MutedStyle.Render("No PRs found between last production deploy and "+m.branch) + "\n")
		m.renderPinnedCommit(sb)
		return
	}

	sb.WriteString("\n" + m.theme.SectionStyle.Render(fmt.Sprintf("Release Notes (%d PRs)", len(m.releaseNotes))) + "\n")
	for _, n := range m.releaseNotes {
		author := ""
		if n.Author != "" {
			author = " " + m.theme.MutedStyle.Render("@"+n.Author)
		}
		sb.WriteString(fmt.Sprintf("  %s #%d %s%s\n",
			lipgloss.NewStyle().Foreground(m.theme.Success).Render("•"),
			n.Number,
			n.Title,
			author,
		))
	}

	if m.releaseNotesURL != "" {
		sb.WriteString(fmt.Sprintf("\n  %s %s\n", m.theme.SnapshotLabelStyle.Render("Full diff:"), m.theme.StageURLStyle.Render(m.releaseNotesURL)))
	}
	m.renderPinnedCommit(sb)
}

func (m Model) renderPinnedCommit(sb *strings.Builder) {
	commit := m.pipeline.Values()["commit"]
	if commit == "" || commit == m.branch {
		sb.WriteString(fmt.Sprintf("  %s %s\n",
			m.theme.PreflightWarnStyle.Render("⚠"),
			m.theme.MutedStyle.Render("Commit pinning failed — deploying branch tip")))
		return
	}
	short := commit
	if len(short) > 7 {
		short = short[:7]
	}
	sb.WriteString(fmt.Sprintf("  %s %s\n", m.theme.SnapshotLabelStyle.Render("Pinned to:"), m.theme.SnapshotValueStyle.Render(short+" ("+m.branch+")")))
}

func (m Model) releaseNotesString() string {
	var sb strings.Builder
	m.renderReleaseNotes(&sb)
	return strings.TrimRight(sb.String(), "\n")
}

// renderActiveStages shows only currently running/parsing stages.
func (m Model) renderActiveStages(sb *strings.Builder) {
	for _, sr := range m.pipeline.Stages() {
		if sr.Env == "rollback" {
			continue
		}
		if sr.State == pipeline.StateRunning || sr.State == pipeline.StateParsingOutputs {
			m.renderStage(sb, sr)
		}
	}
}

// renderActiveRollbackStages shows only currently running rollback stages.
func (m Model) renderActiveRollbackStages(sb *strings.Builder) {
	for _, sr := range m.pipeline.Stages() {
		if sr.Env != "rollback" {
			continue
		}
		if sr.State == pipeline.StateRunning || sr.State == pipeline.StateParsingOutputs {
			m.renderStage(sb, sr)
		}
	}
}

// stageString renders a completed stage for tea.Println.
func (m Model) stageString(sr *pipeline.StageRun) string {
	var sb strings.Builder
	m.renderStage(&sb, sr)
	return strings.TrimRight(sb.String(), "\n")
}

func (m Model) styledStateSymbol(state pipeline.StageState) string {
	if state == pipeline.StateRunning || state == pipeline.StateParsingOutputs {
		return m.spinner.View()
	}
	return lipgloss.NewStyle().Foreground(m.theme.StateColor(state)).Render(state.Symbol())
}

func (m Model) renderStage(sb *strings.Builder, sr *pipeline.StageRun) {
	styledSymbol := m.styledStateSymbol(sr.State)
	name := m.theme.StageNameStyle.Render(sr.Stage.Name)

	sb.WriteString(fmt.Sprintf("  %s %s",
		styledSymbol,
		name,
	))

	if dur := sr.Duration(); dur > 0 {
		sb.WriteString(" " + m.theme.StageDurationStyle.Render(render.FormatDuration(dur)))
	}

	if sr.State == pipeline.StateRunning && sr.StatusText != "" {
		sb.WriteString(" " + m.theme.MutedStyle.Render(sr.StatusText))
	}

	if m.dryRun && sr.State == pipeline.StateSuccess {
		sb.WriteString(" " + m.theme.DryRunBadge.Render("DRY RUN"))
	}

	sb.WriteString("\n")

	if sr.RunURL != "" && !strings.HasPrefix(sr.RunURL, "[DRY RUN]") {
		sb.WriteString(fmt.Sprintf("    %s\n", m.theme.StageURLStyle.Render(sr.RunURL)))
	}

	if sr.DryRunCmd != "" {
		sb.WriteString(fmt.Sprintf("    %s\n", m.theme.MutedStyle.Render(sr.DryRunCmd)))
	}

	if sr.Error != "" {
		sb.WriteString(fmt.Sprintf("    %s\n", m.theme.StageErrorStyle.Render(sr.Error)))
	}

	if len(sr.Outputs) > 0 {
		keys := make([]string, 0, len(sr.Outputs))
		for k := range sr.Outputs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			sb.WriteString(fmt.Sprintf("    %s\n", m.theme.OutputStyle.Render(fmt.Sprintf("%s = %s", k, sr.Outputs[k]))))
		}
	}

	for _, mr := range sr.MatrixRuns {
		mrStyledSymbol := m.styledStateSymbol(mr.State)
		mrLabel := render.FormatMatrixInputs(mr.Inputs)
		if mr.State == pipeline.StateRunning && mr.StatusText != "" {
			mrLabel += " " + m.theme.MutedStyle.Render(mr.StatusText)
		}
		sb.WriteString(fmt.Sprintf("    %s %s\n",
			mrStyledSymbol,
			mrLabel,
		))
		if mr.RunURL != "" && !strings.HasPrefix(mr.RunURL, "[DRY RUN]") {
			sb.WriteString(fmt.Sprintf("      %s\n", m.theme.StageURLStyle.Render(mr.RunURL)))
		}
		if mr.DryRunCmd != "" {
			sb.WriteString(fmt.Sprintf("      %s\n", m.theme.MutedStyle.Render(mr.DryRunCmd)))
		}
		if mr.Error != "" {
			sb.WriteString(fmt.Sprintf("      %s\n", m.theme.StageErrorStyle.Render(mr.Error)))
		}
	}
}

func (m Model) renderRollbackSummary(sb *strings.Builder) {
	snap := m.pipeline.Snapshot
	sb.WriteString("\n" + m.theme.SectionStyle.Render("Rollback") + "\n")
	sb.WriteString("  Will revert to:\n")
	sb.WriteString(fmt.Sprintf("    Artifact ID:     %s\n", m.theme.SnapshotValueStyle.Render(snap.ArtifactID)))
	sb.WriteString(fmt.Sprintf("    Agent image:     %s\n", m.theme.SnapshotValueStyle.Render(snap.AgentImageTag)))
	sb.WriteString(fmt.Sprintf("    Preview image:   %s\n", m.theme.SnapshotValueStyle.Render(snap.PreviewImageTag)))
	sb.WriteString(fmt.Sprintf("    Publish image:   %s\n", m.theme.SnapshotValueStyle.Render(snap.PublishImageTag)))
}

func (m Model) elapsed() string {
	return render.FormatElapsed(m.elapsedDur())
}

// elapsedDur returns the wall-clock duration since the run started (0 before
// it has). Feeds both the terminal "elapsed" string and the shared Slack
// renderer.
func (m Model) elapsedDur() time.Duration {
	if m.startTime.IsZero() {
		return 0
	}
	return time.Since(m.startTime)
}

// nbsp / nbspx2 / blankLine alias the canonical constants in internal/render
// so this package (and its existing tests) keep referring to them by the short
// names while the values live in one place (the shared Slack renderer).
const (
	nbsp      = render.Nbsp
	nbspx2    = render.Nbspx2
	blankLine = render.BlankLine
)

// slackMessage builds the Slack status message. The format lives in
// internal/render (shared with the headless runner); this is a thin adapter
// projecting the TUI Model into a render.State.
func (m Model) slackMessage(finished bool) string {
	return render.Message(render.State{
		Operator:        m.operator,
		Branch:          m.branch,
		Commit:          m.pipeline.Values()["commit"],
		DryRun:          m.dryRun,
		Finished:        finished,
		Aborted:         m.phase == phaseAborted,
		ReleaseNotes:    m.releaseNotes,
		ReleaseNotesURL: m.releaseNotesURL,
		Stages:          m.pipeline.Stages(),
		EnvOrder:        m.envOrder,
		Snapshot:        m.pipeline.Snapshot,
		StatusMessage:   m.statusMessage,
		ReleaseTag:      m.releaseTag,
		ReleaseURL:      m.releaseURL,
		Elapsed:         m.elapsedDur(),
	})
}

// renderSlackDeployValues is retained as a thin wrapper (existing tests call it
// directly) delegating to the shared implementation in internal/render.
func (m Model) renderSlackDeployValues(sb *strings.Builder, env string, stages []*pipeline.StageRun) {
	render.WriteDeployValues(sb, env, stages, m.envOrder)
}

// slackEmojiToUnicode is retained as a thin wrapper (used by update.go for the
// GitHub release body, and asserted by existing tests) delegating to the
// shared implementation in internal/render.
func slackEmojiToUnicode(text string) string {
	return render.EmojiToUnicode(text)
}
