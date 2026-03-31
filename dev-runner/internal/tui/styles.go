package tui

import (
	"charm.land/lipgloss/v2"
)

var (
	statusRunning  = lipgloss.Color("#00ff00")
	statusStarting = lipgloss.Color("#ffff00")
	statusErrored  = lipgloss.Color("#ff0000")
	statusStopped  = lipgloss.Color("#666666")

	activeTabStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).
			Background(lipgloss.Color("62")).
			Padding(0, 2)

	inactiveTabStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("250")).
				Background(lipgloss.Color("236")).
				Padding(0, 2)

	paneHeaderStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).
			Background(lipgloss.Color("240"))

	errorLineStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#ffffff")).
			Background(lipgloss.Color("#8b0000")).
			Bold(true)

	statusBarStyle = lipgloss.NewStyle().
			Background(lipgloss.Color("236"))

	statusBarTextStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("244"))

	keyHintStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("244"))

	keyStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("229")).
			Bold(true)

	settingsBoxStyle = lipgloss.NewStyle().
				Border(lipgloss.DoubleBorder()).
				BorderForeground(lipgloss.Color("62")).
				Padding(1, 3).
				Background(lipgloss.Color("235"))

	settingsSelectedStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("15")).
				Background(lipgloss.Color("62")).
				Bold(true).
				Padding(0, 1)

	settingsItemStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("252")).
				Padding(0, 1)

	searchBarStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("229")).
			Background(lipgloss.Color("238")).
			Padding(0, 1)

	searchMatchStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("0")).
				Background(lipgloss.Color("229")).
				Bold(true)

	hookTitleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("62"))

	hookOutputStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("250"))

	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("62")).
			Padding(0, 1)
)
