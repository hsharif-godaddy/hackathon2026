package tui

import (
	"fmt"
	"image/color"
	"sort"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/release-manager/internal/pipeline"
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
		sb.WriteString("  " + lipgloss.NewStyle().Foreground(colorRunning).Render("◉") + " Acquiring deploy lock...\n")

	case phaseSnapshot:
		sb.WriteString("  " + lipgloss.NewStyle().Foreground(colorRunning).Render("◉") + " Fetching rollback snapshot...\n")

	case phaseSnapshotConfirm:
		m.renderSnapshot(&sb)
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseReleaseNotes:
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		} else {
			sb.WriteString("\n  " + lipgloss.NewStyle().Foreground(colorRunning).Render("◉") + " Fetching release notes...\n")
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

	case phaseAborted:
		sb.WriteString(failedMessageStyle.Render(m.statusMessage) + "\n")
	}

	sb.WriteString(helpStyle.Render("ctrl+c to quit") + "\n")
	return tea.NewView(sb.String())
}

// renderPreflight shows running preflight checks (used only during phasePreflight).
func (m Model) renderPreflight(sb *strings.Builder) {
	sb.WriteString(sectionStyle.Render("Preflight Checks") + "\n")
	for _, check := range m.preflight {
		if !check.Done {
			sb.WriteString(fmt.Sprintf("  %s %s\n",
				lipgloss.NewStyle().Foreground(colorRunning).Render("◉"),
				check.Name,
			))
		} else if check.Passed {
			sb.WriteString(fmt.Sprintf("  %s %s\n",
				preflightPassStyle.Render("✓"),
				check.Name,
			))
		} else if !check.Required {
			sb.WriteString(fmt.Sprintf("  %s %s (disabled)\n",
				preflightWarnStyle.Render("⚠"),
				check.Name,
			))
			if check.Error != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", preflightWarnStyle.Render(check.Error)))
			}
			if check.Hint != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", mutedStyle.Render(check.Hint)))
			}
		} else {
			sb.WriteString(fmt.Sprintf("  %s %s\n",
				preflightFailStyle.Render("✗"),
				check.Name,
			))
			if check.Error != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", preflightFailStyle.Render(check.Error)))
			}
			if check.Hint != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", mutedStyle.Render(check.Hint)))
			}
		}
	}
}

func (m Model) headerString() string {
	header := titleStyle.Render("Release Manager")
	if m.dryRun {
		header += " " + dryRunBadge.Render("DRY RUN")
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

	sb.WriteString("\n" + sectionStyle.Render("Rollback Snapshot (current production state)") + "\n")
	sb.WriteString(fmt.Sprintf("  %s %s\n", snapshotLabelStyle.Render("App artifact ID:"), snapshotValueStyle.Render(snap.ArtifactID)))
	sb.WriteString(fmt.Sprintf("  %s %s\n", snapshotLabelStyle.Render("Agent image tag:"), snapshotValueStyle.Render(snap.AgentImageTag)))
	sb.WriteString(fmt.Sprintf("  %s %s\n", snapshotLabelStyle.Render("Preview image tag:"), snapshotValueStyle.Render(snap.PreviewImageTag)))
	sb.WriteString(fmt.Sprintf("  %s %s\n", snapshotLabelStyle.Render("Publish image tag:"), snapshotValueStyle.Render(snap.PublishImageTag)))

	if snap.AppSourceURL != "" {
		sb.WriteString(fmt.Sprintf("\n  %s %s\n", snapshotLabelStyle.Render("App source:"), snapshotURLStyle.Render(snap.AppSourceURL)))
	}
	if snap.ImagesSourceURL != "" {
		sb.WriteString(fmt.Sprintf("  %s %s\n", snapshotLabelStyle.Render("Images source:"), snapshotURLStyle.Render(snap.ImagesSourceURL)))
	}
}

// snapshotString renders snapshot details for tea.Println.
func (m Model) snapshotString() string {
	var sb strings.Builder
	m.renderSnapshot(&sb)
	return strings.TrimRight(sb.String(), "\n")
}

func (m Model) renderReleaseNotes(sb *strings.Builder) {
	if len(m.releaseNotes) == 0 {
		sb.WriteString("\n" + sectionStyle.Render("Release Notes") + "\n")
		sb.WriteString("  " + mutedStyle.Render("No PRs found between last production deploy and "+m.branch) + "\n")
		return
	}

	sb.WriteString("\n" + sectionStyle.Render(fmt.Sprintf("Release Notes (%d PRs)", len(m.releaseNotes))) + "\n")
	for _, n := range m.releaseNotes {
		author := ""
		if n.Author != "" {
			author = " " + mutedStyle.Render("@"+n.Author)
		}
		sb.WriteString(fmt.Sprintf("  %s #%d %s%s\n",
			lipgloss.NewStyle().Foreground(colorSuccess).Render("•"),
			n.Number,
			n.Title,
			author,
		))
	}

	if m.releaseNotesURL != "" {
		sb.WriteString(fmt.Sprintf("\n  %s %s\n", snapshotLabelStyle.Render("Full diff:"), stageURLStyle.Render(m.releaseNotesURL)))
	}
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

func (m Model) renderStage(sb *strings.Builder, sr *pipeline.StageRun) {
	symbol := sr.State.Symbol()
	name := stageNameStyle.Render(sr.Stage.Name)

	sb.WriteString(fmt.Sprintf("  %s %s",
		lipgloss.NewStyle().Foreground(stateColor(sr.State)).Render(symbol),
		name,
	))

	if dur := sr.Duration(); dur > 0 {
		sb.WriteString(" " + stageDurationStyle.Render(formatDuration(dur)))
	}

	if sr.State == pipeline.StateRunning && sr.StatusText != "" {
		sb.WriteString(" " + mutedStyle.Render(sr.StatusText))
	}

	if m.dryRun && sr.State == pipeline.StateSuccess {
		sb.WriteString(" " + dryRunBadge.Render("DRY RUN"))
	}

	sb.WriteString("\n")

	if sr.RunURL != "" && !strings.HasPrefix(sr.RunURL, "[DRY RUN]") {
		sb.WriteString(fmt.Sprintf("    %s\n", stageURLStyle.Render(sr.RunURL)))
	}

	if sr.DryRunCmd != "" {
		sb.WriteString(fmt.Sprintf("    %s\n", mutedStyle.Render(sr.DryRunCmd)))
	}

	if sr.Error != "" {
		sb.WriteString(fmt.Sprintf("    %s\n", stageErrorStyle.Render(sr.Error)))
	}

	if len(sr.Outputs) > 0 {
		keys := make([]string, 0, len(sr.Outputs))
		for k := range sr.Outputs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			sb.WriteString(fmt.Sprintf("    %s\n", outputStyle.Render(fmt.Sprintf("%s = %s", k, sr.Outputs[k]))))
		}
	}

	for _, mr := range sr.MatrixRuns {
		mrSymbol := pipeline.StateSuccess.Symbol()
		mrColor := stateColor(pipeline.StateSuccess)
		if mr.State == pipeline.StateFailed {
			mrSymbol = pipeline.StateFailed.Symbol()
			mrColor = stateColor(pipeline.StateFailed)
		} else if mr.State == pipeline.StateRunning {
			mrSymbol = pipeline.StateRunning.Symbol()
			mrColor = stateColor(pipeline.StateRunning)
		} else if mr.State == pipeline.StatePending {
			mrSymbol = pipeline.StatePending.Symbol()
			mrColor = stateColor(pipeline.StatePending)
		}

		mrLabel := formatMatrixInputs(mr.Inputs)
		if mr.State == pipeline.StateRunning && mr.StatusText != "" {
			mrLabel += " " + mutedStyle.Render(mr.StatusText)
		}
		sb.WriteString(fmt.Sprintf("    %s %s\n",
			lipgloss.NewStyle().Foreground(mrColor).Render(mrSymbol),
			mrLabel,
		))
		if mr.RunURL != "" && !strings.HasPrefix(mr.RunURL, "[DRY RUN]") {
			sb.WriteString(fmt.Sprintf("      %s\n", stageURLStyle.Render(mr.RunURL)))
		}
		if mr.DryRunCmd != "" {
			sb.WriteString(fmt.Sprintf("      %s\n", mutedStyle.Render(mr.DryRunCmd)))
		}
		if mr.Error != "" {
			sb.WriteString(fmt.Sprintf("      %s\n", stageErrorStyle.Render(mr.Error)))
		}
	}
}

func (m Model) renderRollbackSummary(sb *strings.Builder) {
	snap := m.pipeline.Snapshot
	sb.WriteString("\n" + sectionStyle.Render("Rollback") + "\n")
	sb.WriteString("  Will revert to:\n")
	sb.WriteString(fmt.Sprintf("    Artifact ID:     %s\n", snapshotValueStyle.Render(snap.ArtifactID)))
	sb.WriteString(fmt.Sprintf("    Agent image:     %s\n", snapshotValueStyle.Render(snap.AgentImageTag)))
	sb.WriteString(fmt.Sprintf("    Preview image:   %s\n", snapshotValueStyle.Render(snap.PreviewImageTag)))
	sb.WriteString(fmt.Sprintf("    Publish image:   %s\n", snapshotValueStyle.Render(snap.PublishImageTag)))
}

func stateColor(state pipeline.StageState) color.Color {
	switch state {
	case pipeline.StateSuccess:
		return colorSuccess
	case pipeline.StateRunning:
		return colorRunning
	case pipeline.StateFailed:
		return colorFailed
	case pipeline.StateSkipped:
		return colorSkipped
	case pipeline.StateParsingOutputs:
		return colorParsing
	default:
		return colorPending
	}
}

func formatDuration(d time.Duration) string {
	secs := d.Seconds()
	if secs < 60 {
		return fmt.Sprintf("(%.0fs)", secs)
	}
	return fmt.Sprintf("(%dm%02ds)", int(secs)/60, int(secs)%60)
}

func (m Model) elapsed() string {
	if m.startTime.IsZero() {
		return "0s"
	}
	d := time.Since(m.startTime).Truncate(time.Second)
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	return fmt.Sprintf("%dm%02ds", int(d.Minutes()), int(d.Seconds())%60)
}

// slackMessage builds a full Slack mrkdwn status message from current pipeline state.
func (m Model) slackMessage(finished bool) string {
	var sb strings.Builder

	header := ":rocket: *" + m.operator + "* is deploying `" + m.branch + "`"
	if m.dryRun {
		header += " (DRY RUN)"
	}
	sb.WriteString(header + "\n")

	if len(m.releaseNotes) > 0 || m.releaseNotesURL != "" {
		if len(m.releaseNotes) > 0 {
			sb.WriteString(fmt.Sprintf("\n*Release Notes* (%d PRs)", len(m.releaseNotes)))
			if m.releaseNotesURL != "" {
				sb.WriteString(fmt.Sprintf(" — <%s|Full diff>", m.releaseNotesURL))
			}
			sb.WriteString("\n")
			for _, n := range m.releaseNotes {
				line := fmt.Sprintf("  • #%d %s", n.Number, n.Title)
				if n.Author != "" {
					line += " — @" + n.Author
				}
				sb.WriteString(line + "\n")
			}
		} else if m.releaseNotesURL != "" {
			sb.WriteString(fmt.Sprintf("\n<%s|Full diff>\n", m.releaseNotesURL))
		}
	}

	stages := m.pipeline.Stages()
	values := m.pipeline.Values()
	currentEnv := ""
	for _, sr := range stages {
		if sr.Env == "rollback" {
			continue
		}
		if sr.Env != currentEnv {
			currentEnv = sr.Env
			sb.WriteString(fmt.Sprintf("\n*%s*\n", strings.ToUpper(currentEnv)))
			m.renderSlackDeployValues(&sb, currentEnv, values)
		}
		m.renderSlackStage(&sb, sr)
	}

	rollbackStages := false
	for _, sr := range stages {
		if sr.Env == "rollback" {
			if !rollbackStages {
				sb.WriteString("\n*ROLLBACK*\n")
				m.renderSlackSnapshotValues(&sb)
				rollbackStages = true
			}
			m.renderSlackStage(&sb, sr)
		}
	}

	if finished && m.phase == phaseAborted {
		sb.WriteString(fmt.Sprintf("\n:no_entry: *%s* (%s)", m.statusMessage, m.elapsed()))
	} else if finished {
		sb.WriteString(fmt.Sprintf("\n:checkered_flag: *Complete* (%s)", m.elapsed()))
	} else {
		sb.WriteString("\n:spinner_: _In progress..._")
	}

	return sb.String()
}

func (m Model) renderSlackStage(sb *strings.Builder, sr *pipeline.StageRun) {
	emoji := slackEmoji(sr.State)
	line := fmt.Sprintf("  %s %s", emoji, sr.Stage.Name)

	if dur := sr.Duration(); dur > 0 && sr.State != pipeline.StateRunning {
		line += " " + formatDuration(dur)
	}

	if sr.RunURL != "" && !strings.HasPrefix(sr.RunURL, "[DRY RUN]") {
		line += fmt.Sprintf(" — <%s|View Run>", sr.RunURL)
	}

	if sr.Error != "" {
		line += " — " + sr.Error
	}

	sb.WriteString(line + "\n")

	for _, mr := range sr.MatrixRuns {
		mrLine := fmt.Sprintf("    %s %s", slackEmoji(mr.State), formatMatrixInputs(mr.Inputs))
		if mr.RunURL != "" && !strings.HasPrefix(mr.RunURL, "[DRY RUN]") {
			mrLine += fmt.Sprintf(" — <%s|View Run>", mr.RunURL)
		}
		if mr.Error != "" {
			mrLine += " — " + mr.Error
		}
		sb.WriteString(mrLine + "\n")
	}
}

// renderSlackDeployValues shows artifact/image values for environments after
// the first (which produces intermediate outputs). Finds values by key suffix
// so renaming environments or stages in the YAML doesn't break rendering.
func (m Model) renderSlackDeployValues(sb *strings.Builder, env string, values map[string]string) {
	if len(m.envOrder) > 0 && env == m.envOrder[0] {
		return
	}
	var artifact, agent, preview, publish string
	for k, v := range values {
		switch {
		case strings.HasSuffix(k, ".artifact_id"):
			artifact = v
		case strings.HasSuffix(k, ".agent_image_tag"):
			agent = v
		case strings.HasSuffix(k, ".preview_image_tag"):
			preview = v
		case strings.HasSuffix(k, ".publish_image_tag"):
			publish = v
		}
	}
	if artifact != "" {
		sb.WriteString("  artifact: `" + artifact + "`\n")
	}
	if agent != "" || preview != "" || publish != "" {
		sb.WriteString("  agent: `" + agent + "` preview: `" + preview + "` publish: `" + publish + "`\n")
	}
}

func (m Model) renderSlackSnapshotValues(sb *strings.Builder) {
	snap := m.pipeline.Snapshot
	if snap.ArtifactID != "" {
		sb.WriteString("  artifact: `" + snap.ArtifactID + "`\n")
	}
	if snap.AgentImageTag != "" || snap.PreviewImageTag != "" || snap.PublishImageTag != "" {
		sb.WriteString("  agent: `" + snap.AgentImageTag + "` preview: `" + snap.PreviewImageTag + "` publish: `" + snap.PublishImageTag + "`\n")
	}
}

func slackEmoji(state pipeline.StageState) string {
	switch state {
	case pipeline.StateRunning, pipeline.StateParsingOutputs:
		return ":large_blue_circle:"
	case pipeline.StateSuccess:
		return ":white_check_mark:"
	case pipeline.StateFailed:
		return ":x:"
	case pipeline.StateSkipped:
		return ":fast_forward:"
	default:
		return ":white_circle:"
	}
}

func formatMatrixInputs(inputs map[string]string) string {
	keys := make([]string, 0, len(inputs))
	for k := range inputs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", k, inputs[k]))
	}
	return strings.Join(parts, " ")
}
