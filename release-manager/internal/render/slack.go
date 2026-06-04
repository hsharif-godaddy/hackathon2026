// Package render builds the Slack status message for a release run. It is the
// single source of truth for that format, shared by the interactive TUI
// (internal/tui) and the headless runner (internal/headless) so both emit
// byte-identical messages. It depends only on the dependency-clean pipeline
// package, never on the TUI.
package render

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/pipeline"
)

// Slack's markdown_text renderer strips leading ASCII spaces and collapses
// consecutive blank lines. These Unicode characters work around that:
//   - Nbsp / Nbspx2 preserve indentation (literal U+00A0 no-break spaces).
//   - BlankLine forces a visible blank line (U+200B zero-width space). It is
//     built via string(rune) rather than a literal so the source carries no
//     invisible format character — staticcheck (ST1018) flags those, and a
//     literal would be invisible to reviewers. The value is identical.
//
// Exported so the tui package can keep referencing the same constants its
// tests assert against.
const (
	Nbsp      = "  "
	Nbspx2    = "    "
	BlankLine = string(rune(0x200B))
)

// State is the immutable input to Message — a flat snapshot of everything the
// Slack render needs, with no TUI types. Callers (TUI Model, headless runner)
// populate it from their own pipeline.
type State struct {
	Operator string
	Branch   string
	Commit   string // full or short SHA; rendered truncated to 7 chars
	DryRun   bool
	Finished bool // pipeline reached a terminal state
	Aborted  bool // terminal state was an abort/decline (vs. Complete)
	// AwaitingApproval marks the non-terminal moment where the test phase is
	// done and the pipeline is paused at the prod approval gate. It renders a
	// "Review & approve" call-to-action instead of the generic spinner so the
	// channel gets a clear ping that a human needs to act.
	AwaitingApproval bool
	RunURL           string // orchestrator run URL, linked from the approval CTA
	// ApprovedBy is the reviewer login who approved the prod gate. Set once the
	// prod phase resumes, so the message credits the approver ("approved by @x")
	// through the prod deploy and on Complete. Empty when unknown or dry-run.
	ApprovedBy      string
	ReleaseNotes    []pipeline.ReleaseNote
	ReleaseNotesURL string
	Stages          []*pipeline.StageRun
	EnvOrder        []string
	Snapshot        pipeline.RollbackSnapshot
	StatusMessage   string
	ReleaseTag      string
	ReleaseURL      string
	Elapsed         time.Duration
}

// Message builds the Slack status message in standard markdown (for the
// markdown_text API field, which allows up to 12,000 chars).
func Message(s State) string {
	var sb strings.Builder

	header := ":rocket: **" + s.Operator + "** is deploying `" + s.Branch + "`"
	if s.Commit != "" && s.Commit != s.Branch {
		short := s.Commit
		if len(short) > 7 {
			short = short[:7]
		}
		header += " (`" + short + "`)"
	}
	if s.DryRun {
		header += " (DRY RUN)"
	}
	sb.WriteString(header + "\n")

	if len(s.ReleaseNotes) > 0 || s.ReleaseNotesURL != "" {
		if len(s.ReleaseNotes) > 0 {
			sb.WriteString(fmt.Sprintf("\n%s\n**Release Notes** (%d PRs)", BlankLine, len(s.ReleaseNotes)))
			if s.ReleaseNotesURL != "" {
				sb.WriteString(fmt.Sprintf(" — [Full diff](%s)", s.ReleaseNotesURL))
			}
			sb.WriteString("\n")
			for _, n := range s.ReleaseNotes {
				line := fmt.Sprintf("• #%d %s", n.Number, n.Title)
				if n.Author != "" {
					line += " — @" + n.Author
				}
				sb.WriteString(line + "\n")
			}
		} else if s.ReleaseNotesURL != "" {
			sb.WriteString(fmt.Sprintf("\n%s\n[Full diff](%s)\n", BlankLine, s.ReleaseNotesURL))
		}
	}

	currentEnv := ""
	for _, sr := range s.Stages {
		if sr.Env == "rollback" {
			continue
		}
		if sr.Env != currentEnv {
			currentEnv = sr.Env
			sb.WriteString(fmt.Sprintf("\n%s\n**%s**\n", BlankLine, strings.ToUpper(currentEnv)))
			WriteDeployValues(&sb, currentEnv, s.Stages, s.EnvOrder)
		}
		writeStage(&sb, sr)
	}

	rollbackStages := false
	for _, sr := range s.Stages {
		if sr.Env == "rollback" {
			if !rollbackStages {
				sb.WriteString(fmt.Sprintf("\n%s\n**ROLLBACK**\n", BlankLine))
				writeSnapshotValues(&sb, s.Snapshot)
				rollbackStages = true
			}
			writeStage(&sb, sr)
		}
	}

	if s.Finished && s.Aborted {
		sb.WriteString(fmt.Sprintf("\n%s\n:no_entry: **%s** (%s)", BlankLine, s.StatusMessage, FormatElapsed(s.Elapsed)))
	} else if s.Finished {
		sb.WriteString(fmt.Sprintf("\n%s\n:checkered_flag: **Complete** (%s)", BlankLine, FormatElapsed(s.Elapsed)))
		if s.ApprovedBy != "" {
			sb.WriteString(" · approved by @" + s.ApprovedBy)
		}
		if s.ReleaseTag != "" {
			sb.WriteString(fmt.Sprintf("\n\n:label: [%s](%s)", s.ReleaseTag, s.ReleaseURL))
		}
	} else if s.AwaitingApproval {
		footer := ":hourglass_flowing_sand: **Awaiting prod approval**"
		if s.RunURL != "" {
			footer += " — [Review & approve](" + s.RunURL + ")"
		}
		sb.WriteString(fmt.Sprintf("\n%s\n%s", BlankLine, footer))
	} else if s.ApprovedBy != "" {
		// Prod phase, post-approval: credit the approver beside the spinner so
		// the gate decision stays visible while prod deploys.
		sb.WriteString(fmt.Sprintf("\n%s\n:white_check_mark: Approved by @%s · :spinner_: *Deploying to prod...*", BlankLine, s.ApprovedBy))
	} else {
		sb.WriteString(fmt.Sprintf("\n%s\n:spinner_: *In progress...*", BlankLine))
	}

	return sb.String()
}

func writeStage(sb *strings.Builder, sr *pipeline.StageRun) {
	emoji := Emoji(sr.State)
	line := fmt.Sprintf("%s%s %s", Nbsp, emoji, sr.Stage.Name)

	if dur := sr.Duration(); dur > 0 && sr.State != pipeline.StateRunning {
		line += " " + FormatDuration(dur)
	}

	if sr.RunURL != "" && !strings.HasPrefix(sr.RunURL, "[DRY RUN]") {
		line += fmt.Sprintf(" — [View Run](%s)", sr.RunURL)
	}

	if sr.Error != "" {
		line += " — " + sr.Error
	}

	sb.WriteString(line + "\n")

	for _, mr := range sr.MatrixRuns {
		mrLine := fmt.Sprintf("%s%s %s", Nbspx2, Emoji(mr.State), FormatMatrixInputs(mr.Inputs))
		if mr.RunURL != "" && !strings.HasPrefix(mr.RunURL, "[DRY RUN]") {
			mrLine += fmt.Sprintf(" — [View Run](%s)", mr.RunURL)
		}
		if mr.Error != "" {
			mrLine += " — " + mr.Error
		}
		sb.WriteString(mrLine + "\n")
	}
}

// WriteDeployValues shows artifact/image values for environments after the
// first. The first env (test) produces these values; subsequent envs (prod)
// consume them. Values are collected from all non-rollback stage outputs
// regardless of env, since the build stage in test is the only stage expected
// to produce image tags. If multiple stages emit the same output key, the last
// stage in pipeline order wins deterministically.
//
// Exported so the tui package's thin wrapper (and its existing tests) can call
// through to the single implementation here.
func WriteDeployValues(sb *strings.Builder, env string, stages []*pipeline.StageRun, envOrder []string) {
	if len(envOrder) > 0 && env == envOrder[0] {
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
		sb.WriteString(Nbsp + "artifact: `" + artifact + "`\n")
	}
	if agent != "" || preview != "" || publish != "" {
		sb.WriteString(Nbsp + "agent: `" + agent + "` preview: `" + preview + "` publish: `" + publish + "`\n")
	}
}

func writeSnapshotValues(sb *strings.Builder, snap pipeline.RollbackSnapshot) {
	if snap.ArtifactID != "" {
		sb.WriteString(Nbsp + "artifact: `" + snap.ArtifactID + "`\n")
	}
	if snap.AgentImageTag != "" || snap.PreviewImageTag != "" || snap.PublishImageTag != "" {
		sb.WriteString(Nbsp + "agent: `" + snap.AgentImageTag + "` preview: `" + snap.PreviewImageTag + "` publish: `" + snap.PublishImageTag + "`\n")
	}
}

// Emoji maps a pipeline stage state to its Slack emoji code.
func Emoji(state pipeline.StageState) string {
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

// EmojiToUnicode replaces Slack emoji codes with Unicode characters for
// contexts that don't render Slack codes natively (e.g. GitHub release bodies).
func EmojiToUnicode(text string) string {
	replacements := []struct{ code, unicode string }{
		{":white_check_mark:", "✅"},
		{":x:", "❌"},
		{":rocket:", "\U0001F680"},
		{":checkered_flag:", "\U0001F3C1"},
		{":large_blue_circle:", "\U0001F535"},
		{":white_circle:", "⚪"},
		{":no_entry:", "⛔"},
		{":fast_forward:", "⏩"},
		{":hourglass_flowing_sand:", "⏳"},
		{":label:", "\U0001F3F7️"},
		{":spinner_:", ""},
	}
	for _, r := range replacements {
		text = strings.ReplaceAll(text, r.code, r.unicode)
	}
	return text
}

// FormatMatrixInputs renders a matrix cell's inputs as space-joined "k=v"
// pairs in deterministic (sorted-key) order. Shared by the Slack render and
// the TUI's terminal view.
func FormatMatrixInputs(inputs map[string]string) string {
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

// ReleaseBody transforms a rendered Slack message into a GitHub release body:
// strips the operator/header first line, converts Slack emoji codes to Unicode,
// removes the zero-width BlankLine markers, and appends a Slack thread link when
// permalink is non-empty. Shared by the TUI and the headless runner so both cut
// identical release bodies.
func ReleaseBody(slackText, permalink string) string {
	if i := strings.Index(slackText, "\n"); i >= 0 {
		slackText = strings.TrimLeft(slackText[i+1:], "\n")
	}
	slackText = EmojiToUnicode(slackText)
	slackText = strings.ReplaceAll(slackText, BlankLine, "")
	if permalink != "" {
		slackText += "\n\n---\n[Slack thread](" + permalink + ")"
	}
	return slackText
}

// FormatDuration renders a stage duration in parens, e.g. "(5s)" / "(2m03s)".
func FormatDuration(d time.Duration) string {
	secs := d.Seconds()
	if secs < 60 {
		return fmt.Sprintf("(%.0fs)", secs)
	}
	return fmt.Sprintf("(%dm%02ds)", int(secs)/60, int(secs)%60)
}

// FormatElapsed renders total elapsed time without parens, e.g. "5s" /
// "2m03s". A zero duration renders "0s".
func FormatElapsed(d time.Duration) string {
	d = d.Truncate(time.Second)
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	return fmt.Sprintf("%dm%02ds", int(d.Minutes()), int(d.Seconds())%60)
}
