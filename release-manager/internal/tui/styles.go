package tui

import (
	"image/color"

	catppuccin "github.com/catppuccin/go"

	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/release-manager/internal/pipeline"
)

// Theme holds all colors and pre-built styles for the TUI, derived from a
// Catppuccin flavour. Use themeForBackground to construct.
type Theme struct {
	// Semantic colors
	Success color.Color
	Running color.Color
	Pending color.Color
	Failed  color.Color
	Skipped color.Color
	Parsing color.Color
	DryRun  color.Color
	Accent  color.Color
	Muted   color.Color
	Bright  color.Color
	URL     color.Color
	Output  color.Color

	// Pre-built styles
	TitleStyle          lipgloss.Style
	DryRunBadge         lipgloss.Style
	SectionStyle        lipgloss.Style
	StageNameStyle      lipgloss.Style
	StageDurationStyle  lipgloss.Style
	StageURLStyle       lipgloss.Style
	StageErrorStyle     lipgloss.Style
	OutputStyle         lipgloss.Style
	SnapshotLabelStyle  lipgloss.Style
	SnapshotValueStyle  lipgloss.Style
	SnapshotURLStyle    lipgloss.Style
	PreflightPassStyle  lipgloss.Style
	PreflightFailStyle  lipgloss.Style
	PreflightWarnStyle  lipgloss.Style
	SuccessMessageStyle lipgloss.Style
	FailedMessageStyle  lipgloss.Style
	RunningDotStyle     lipgloss.Style
	MutedStyle          lipgloss.Style
	HelpStyle           lipgloss.Style
}

// cat converts a catppuccin Color to a lipgloss Color.
func cat(c catppuccin.Color) color.Color {
	return lipgloss.Color(c.Hex)
}

// themeForBackground returns a Theme for the given terminal background.
func themeForBackground(isDark bool) Theme {
	var f catppuccin.Flavour
	if isDark {
		f = catppuccin.Mocha
	} else {
		f = catppuccin.Latte
	}

	// Light themes need darker neutrals because the terminal background may
	// be darker than Catppuccin Latte's own Base (#eff1f5). Step each
	// neutral role one or two levels towards Text for better contrast.
	muted := f.Subtext0()
	pending := f.Overlay0()
	skipped := f.Overlay1()
	if !isDark {
		muted = f.Subtext1()
		pending = f.Subtext0()
		skipped = f.Overlay2()
	}

	t := Theme{
		Success: cat(f.Green()),
		Running: cat(f.Sapphire()),
		Pending: cat(pending),
		Failed:  cat(f.Red()),
		Skipped: cat(skipped),
		Parsing: cat(f.Yellow()),
		DryRun:  cat(f.Pink()),
		Accent:  cat(f.Mauve()),
		Muted:   cat(muted),
		Bright:  cat(f.Text()),
		URL:     cat(f.Blue()),
		Output:  cat(f.Lavender()),
	}

	t.TitleStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(t.Accent).
		Padding(0, 1)

	t.DryRunBadge = lipgloss.NewStyle().
		Bold(true).
		Foreground(cat(f.Base())).
		Background(t.DryRun).
		Padding(0, 1)

	t.SectionStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(t.Bright).
		Padding(0, 0, 0, 1)

	t.StageNameStyle = lipgloss.NewStyle().
		Foreground(t.Bright)

	t.StageDurationStyle = lipgloss.NewStyle().
		Foreground(t.Muted)

	t.StageURLStyle = lipgloss.NewStyle().
		Foreground(t.URL).
		Underline(true)

	t.StageErrorStyle = lipgloss.NewStyle().
		Foreground(t.Failed).
		Padding(0, 0, 0, 4)

	t.OutputStyle = lipgloss.NewStyle().
		Foreground(t.Output).
		Padding(0, 0, 0, 4)

	t.SnapshotLabelStyle = lipgloss.NewStyle().
		Foreground(t.Muted).
		Width(22)

	t.SnapshotValueStyle = lipgloss.NewStyle().
		Foreground(t.Bright).
		Bold(true)

	t.SnapshotURLStyle = lipgloss.NewStyle().
		Foreground(t.URL).
		Underline(true)

	t.PreflightPassStyle = lipgloss.NewStyle().
		Foreground(t.Success)

	t.PreflightFailStyle = lipgloss.NewStyle().
		Foreground(t.Failed)

	t.PreflightWarnStyle = lipgloss.NewStyle().
		Foreground(t.Parsing)

	t.SuccessMessageStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(t.Success)

	t.FailedMessageStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(t.Failed)

	t.RunningDotStyle = lipgloss.NewStyle().
		Foreground(t.Running)

	t.MutedStyle = lipgloss.NewStyle().
		Foreground(t.Muted)

	t.HelpStyle = lipgloss.NewStyle().
		Foreground(t.Muted).
		Padding(1, 0, 0, 1)

	return t
}

// StateColor returns the color for a given pipeline stage state.
func (t Theme) StateColor(state pipeline.StageState) color.Color {
	switch state {
	case pipeline.StateSuccess:
		return t.Success
	case pipeline.StateRunning:
		return t.Running
	case pipeline.StateFailed:
		return t.Failed
	case pipeline.StateSkipped:
		return t.Skipped
	case pipeline.StateParsingOutputs:
		return t.Parsing
	default:
		return t.Pending
	}
}
