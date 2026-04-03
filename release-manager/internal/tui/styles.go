package tui

import (
	"image/color"

	"charm.land/lipgloss/v2"
)

var (
	colorSuccess color.Color = lipgloss.Color("#00ff00")
	colorRunning color.Color = lipgloss.Color("#00bfff")
	colorPending color.Color = lipgloss.Color("#666666")
	colorFailed  color.Color = lipgloss.Color("#ff4444")
	colorSkipped color.Color = lipgloss.Color("#888888")
	colorParsing color.Color = lipgloss.Color("#ffaa00")
	colorDryRun  color.Color = lipgloss.Color("#ff69b4")
	colorAccent  color.Color = lipgloss.Color("#7c3aed")
	colorMuted   color.Color = lipgloss.Color("#6b7280")
	colorBright  color.Color = lipgloss.Color("#f9fafb")

	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(colorAccent).
			Padding(0, 1)

	dryRunBadge = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#000000")).
			Background(colorDryRun).
			Padding(0, 1)

	sectionStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(colorBright).
			Padding(0, 0, 0, 1)

	stageNameStyle = lipgloss.NewStyle().
			Foreground(colorBright)

	stageDurationStyle = lipgloss.NewStyle().
				Foreground(colorMuted)

	stageURLStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#60a5fa")).
			Underline(true)

	stageErrorStyle = lipgloss.NewStyle().
			Foreground(colorFailed).
			Padding(0, 0, 0, 4)

	outputStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#a78bfa")).
			Padding(0, 0, 0, 4)

	snapshotLabelStyle = lipgloss.NewStyle().
				Foreground(colorMuted).
				Width(22)

	snapshotValueStyle = lipgloss.NewStyle().
				Foreground(colorBright).
				Bold(true)

	snapshotURLStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#60a5fa")).
				Underline(true)

	preflightPassStyle = lipgloss.NewStyle().
				Foreground(colorSuccess)

	preflightFailStyle = lipgloss.NewStyle().
			Foreground(colorFailed)

	preflightWarnStyle = lipgloss.NewStyle().
				Foreground(colorParsing)

	successMessageStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(colorSuccess)

	failedMessageStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(colorFailed)

	mutedStyle = lipgloss.NewStyle().
			Foreground(colorMuted)

	helpStyle = lipgloss.NewStyle().
			Foreground(colorMuted).
			Padding(1, 0, 0, 1)
)
