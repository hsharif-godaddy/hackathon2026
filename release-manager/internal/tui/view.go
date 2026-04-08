package tui

import (
	"fmt"
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
		sb.WriteString("  " + m.theme.RunningDotStyle.Render("◉") + " Acquiring deploy lock...\n")

	case phaseSnapshot:
		sb.WriteString("  " + m.theme.RunningDotStyle.Render("◉") + " Fetching rollback snapshot...\n")

	case phaseSnapshotConfirm:
		m.renderSnapshot(&sb)
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		}

	case phaseReleaseNotes:
		if m.form != nil {
			sb.WriteString("\n" + m.form.View())
		} else {
			sb.WriteString("\n  " + m.theme.RunningDotStyle.Render("◉") + " Fetching release notes...\n")
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
		sb.WriteString(m.theme.FailedMessageStyle.Render(m.statusMessage) + "\n")
	}

	sb.WriteString(m.theme.HelpStyle.Render("ctrl+c to quit") + "\n")
	return tea.NewView(sb.String())
}

// renderPreflight shows running preflight checks (used only during phasePreflight).
func (m Model) renderPreflight(sb *strings.Builder) {
	sb.WriteString(m.theme.SectionStyle.Render("Preflight Checks") + "\n")
	for _, check := range m.preflight {
		if !check.Done {
			sb.WriteString(fmt.Sprintf("  %s %s\n",
				m.theme.RunningDotStyle.Render("◉"),
				check.Name,
			))
		} else if check.Passed {
			sb.WriteString(fmt.Sprintf("  %s %s\n",
				m.theme.PreflightPassStyle.Render("✓"),
				check.Name,
			))
		} else if !check.Required {
			sb.WriteString(fmt.Sprintf("  %s %s (disabled)\n",
				m.theme.PreflightWarnStyle.Render("⚠"),
				check.Name,
			))
			if check.Error != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", m.theme.PreflightWarnStyle.Render(check.Error)))
			}
			if check.Hint != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", m.theme.MutedStyle.Render(check.Hint)))
			}
		} else {
			sb.WriteString(fmt.Sprintf("  %s %s\n",
				m.theme.PreflightFailStyle.Render("✗"),
				check.Name,
			))
			if check.Error != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", m.theme.PreflightFailStyle.Render(check.Error)))
			}
			if check.Hint != "" {
				sb.WriteString(fmt.Sprintf("    %s\n", m.theme.MutedStyle.Render(check.Hint)))
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
}

// snapshotString renders snapshot details for tea.Println.
func (m Model) snapshotString() string {
	var sb strings.Builder
	m.renderSnapshot(&sb)
	return strings.TrimRight(sb.String(), "\n")
}

func (m Model) renderReleaseNotes(sb *strings.Builder) {
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

func (m Model) renderStage(sb *strings.Builder, sr *pipeline.StageRun) {
	symbol := sr.State.Symbol()
	name := m.theme.StageNameStyle.Render(sr.Stage.Name)

	sb.WriteString(fmt.Sprintf("  %s %s",
		lipgloss.NewStyle().Foreground(m.theme.StateColor(sr.State)).Render(symbol),
		name,
	))

	if dur := sr.Duration(); dur > 0 {
		sb.WriteString(" " + m.theme.StageDurationStyle.Render(formatDuration(dur)))
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
		mrSymbol := pipeline.StateSuccess.Symbol()
		mrColor := m.theme.StateColor(pipeline.StateSuccess)
		if mr.State == pipeline.StateFailed {
			mrSymbol = pipeline.StateFailed.Symbol()
			mrColor = m.theme.StateColor(pipeline.StateFailed)
		} else if mr.State == pipeline.StateRunning {
			mrSymbol = pipeline.StateRunning.Symbol()
			mrColor = m.theme.StateColor(pipeline.StateRunning)
		} else if mr.State == pipeline.StatePending {
			mrSymbol = pipeline.StatePending.Symbol()
			mrColor = m.theme.StateColor(pipeline.StatePending)
		}

		mrLabel := formatMatrixInputs(mr.Inputs)
		if mr.State == pipeline.StateRunning && mr.StatusText != "" {
			mrLabel += " " + m.theme.MutedStyle.Render(mr.StatusText)
		}
		sb.WriteString(fmt.Sprintf("    %s %s\n",
			lipgloss.NewStyle().Foreground(mrColor).Render(mrSymbol),
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

// Slack's markdown_text renderer strips leading ASCII spaces and collapses
// consecutive blank lines. These Unicode characters work around that:
// - nbsp preserves indentation (non-breaking space, not stripped)
// - blankLine forces a visible blank line (zero-width space, not collapsed)
const (
	nbsp      = "\u00A0\u00A0"
	nbspx2    = "\u00A0\u00A0\u00A0\u00A0"
	blankLine = "\u200B"
)

// slackMessage builds a Slack status message using standard markdown format
// (for use with the markdown_text API field, which allows up to 12,000 chars).
func (m Model) slackMessage(finished bool) string {
	var sb strings.Builder

	header := ":rocket: **" + m.operator + "** is deploying `" + m.branch + "`"
	if commit := m.pipeline.Values()["commit"]; commit != "" && commit != m.branch {
		short := commit
		if len(short) > 7 {
			short = short[:7]
		}
		header += " (`" + short + "`)"
	}
	if m.dryRun {
		header += " (DRY RUN)"
	}
	sb.WriteString(header + "\n")

	if len(m.releaseNotes) > 0 || m.releaseNotesURL != "" {
		if len(m.releaseNotes) > 0 {
			sb.WriteString(fmt.Sprintf("\n%s\n**Release Notes** (%d PRs)", blankLine, len(m.releaseNotes)))
			if m.releaseNotesURL != "" {
				sb.WriteString(fmt.Sprintf(" — [Full diff](%s)", m.releaseNotesURL))
			}
			sb.WriteString("\n")
			for _, n := range m.releaseNotes {
				line := fmt.Sprintf("• #%d %s", n.Number, n.Title)
				if n.Author != "" {
					line += " — @" + n.Author
				}
				sb.WriteString(line + "\n")
			}
		} else if m.releaseNotesURL != "" {
			sb.WriteString(fmt.Sprintf("\n%s\n[Full diff](%s)\n", blankLine, m.releaseNotesURL))
		}
	}

	stages := m.pipeline.Stages()
	currentEnv := ""
	for _, sr := range stages {
		if sr.Env == "rollback" {
			continue
		}
		if sr.Env != currentEnv {
			currentEnv = sr.Env
			sb.WriteString(fmt.Sprintf("\n%s\n**%s**\n", blankLine, strings.ToUpper(currentEnv)))
			m.renderSlackDeployValues(&sb, currentEnv, stages)
		}
		m.renderSlackStage(&sb, sr)
	}

	rollbackStages := false
	for _, sr := range stages {
		if sr.Env == "rollback" {
			if !rollbackStages {
				sb.WriteString(fmt.Sprintf("\n%s\n**ROLLBACK**\n", blankLine))
				m.renderSlackSnapshotValues(&sb)
				rollbackStages = true
			}
			m.renderSlackStage(&sb, sr)
		}
	}

	if finished && m.phase == phaseAborted {
		sb.WriteString(fmt.Sprintf("\n%s\n:no_entry: **%s** (%s)", blankLine, m.statusMessage, m.elapsed()))
	} else if finished {
		sb.WriteString(fmt.Sprintf("\n%s\n:checkered_flag: **Complete** (%s)", blankLine, m.elapsed()))
	} else {
		sb.WriteString(fmt.Sprintf("\n%s\n:spinner_: *In progress...*", blankLine))
	}

	return sb.String()
}

func (m Model) renderSlackStage(sb *strings.Builder, sr *pipeline.StageRun) {
	emoji := slackEmoji(sr.State)
	line := fmt.Sprintf("%s%s %s", nbsp, emoji, sr.Stage.Name)

	if dur := sr.Duration(); dur > 0 && sr.State != pipeline.StateRunning {
		line += " " + formatDuration(dur)
	}

	if sr.RunURL != "" && !strings.HasPrefix(sr.RunURL, "[DRY RUN]") {
		line += fmt.Sprintf(" — [View Run](%s)", sr.RunURL)
	}

	if sr.Error != "" {
		line += " — " + sr.Error
	}

	sb.WriteString(line + "\n")

	for _, mr := range sr.MatrixRuns {
		mrLine := fmt.Sprintf("%s%s %s", nbspx2, slackEmoji(mr.State), formatMatrixInputs(mr.Inputs))
		if mr.RunURL != "" && !strings.HasPrefix(mr.RunURL, "[DRY RUN]") {
			mrLine += fmt.Sprintf(" — [View Run](%s)", mr.RunURL)
		}
		if mr.Error != "" {
			mrLine += " — " + mr.Error
		}
		sb.WriteString(mrLine + "\n")
	}
}

// renderSlackDeployValues shows artifact/image values for environments after
// the first. The first env (test) produces these values; subsequent envs
// (prod) consume them. Values are collected from all non-rollback stage
// outputs regardless of env, since the build stage in test is the only
// stage expected to produce image tags. If multiple stages emit the same
// output key, the last stage in pipeline order wins deterministically.
func (m Model) renderSlackDeployValues(sb *strings.Builder, env string, stages []*pipeline.StageRun) {
	if len(m.envOrder) > 0 && env == m.envOrder[0] {
		return
	}
	var artifact, agent, preview, publish string
	for _, sr := range stages {
		if sr.Env == "rollback" {
			continue
		}
		for k, v := range sr.Outputs {
			switch k {
			case "artifact_id":
				artifact = v
			case "agent_image_tag":
				agent = v
			case "preview_image_tag":
				preview = v
			case "publish_image_tag":
				publish = v
			}
		}
	}
	if artifact != "" {
		sb.WriteString(nbsp + "artifact: `" + artifact + "`\n")
	}
	if agent != "" || preview != "" || publish != "" {
		sb.WriteString(nbsp + "agent: `" + agent + "` preview: `" + preview + "` publish: `" + publish + "`\n")
	}
}

func (m Model) renderSlackSnapshotValues(sb *strings.Builder) {
	snap := m.pipeline.Snapshot
	if snap.ArtifactID != "" {
		sb.WriteString(nbsp + "artifact: `" + snap.ArtifactID + "`\n")
	}
	if snap.AgentImageTag != "" || snap.PreviewImageTag != "" || snap.PublishImageTag != "" {
		sb.WriteString(nbsp + "agent: `" + snap.AgentImageTag + "` preview: `" + snap.PreviewImageTag + "` publish: `" + snap.PublishImageTag + "`\n")
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

// slackEmojiToUnicode replaces Slack emoji codes with Unicode characters
// for contexts that don't render Slack codes natively (e.g. GitHub releases).
func slackEmojiToUnicode(text string) string {
	replacements := []struct{ code, unicode string }{
		{":white_check_mark:", "\u2705"},
		{":x:", "\u274C"},
		{":rocket:", "\U0001F680"},
		{":checkered_flag:", "\U0001F3C1"},
		{":large_blue_circle:", "\U0001F535"},
		{":white_circle:", "\u26AA"},
		{":no_entry:", "\u26D4"},
		{":fast_forward:", "\u23E9"},
		{":label:", "\U0001F3F7\uFE0F"},
		{":spinner_:", ""},
	}
	for _, r := range replacements {
		text = strings.ReplaceAll(text, r.code, r.unicode)
	}
	return text
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
