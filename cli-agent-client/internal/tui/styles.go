package tui

import (
	"charm.land/lipgloss/v2"
)

var (
	// Pane borders
	focusedBorderStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(lipgloss.Color("62"))

	unfocusedBorderStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(lipgloss.Color("240"))

	// Pane headers
	paneHeaderStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).
			Background(lipgloss.Color("62")).
			Padding(0, 1)

	paneHeaderDimStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("250")).
				Background(lipgloss.Color("240")).
				Padding(0, 1)

	// Chat pane
	userMsgStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#8be9fd"))

	agentMsgStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("255"))

	// Tool status indicators
	toolRunningStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#ffff00"))

	toolCompletedStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#50fa7b"))

	toolErrorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#ff5555"))

	toolSelectedStyle = lipgloss.NewStyle().
				Background(lipgloss.Color("237"))

	// Input area
	inputStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("62")).
			Padding(0, 1)

	inputDisabledStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(lipgloss.Color("240")).
				Padding(0, 1)

	// Status
	connectedStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#50fa7b")).
			Bold(true)

	disconnectedStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#ff5555")).
				Bold(true)

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("243"))

	errorMsgStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#ff5555"))

	// Status bar
	statusBarStyle = lipgloss.NewStyle().
			Background(lipgloss.Color("236"))

	statusBarKeyStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("229")).
				Background(lipgloss.Color("236")).
				Bold(true)

	statusBarTextStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("250")).
				Background(lipgloss.Color("236"))
)
