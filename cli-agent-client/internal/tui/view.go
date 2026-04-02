package tui

import (
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// View renders the full TUI layout.
func (m Model) View() tea.View {
	if !m.ready {
		v := tea.NewView("Connecting to agent...")
		v.AltScreen = true
		return v
	}

	// Calculate layout dimensions
	borderWidth := 2 // left + right border
	inputHeight := 3 // input area height including border
	statusHeight := 1
	contentHeight := m.height - inputHeight - statusHeight

	leftWidth := int(float64(m.width) * m.splitRatio)
	rightWidth := m.width - leftWidth

	// Resize panes (subtract border)
	m.chatPane.SetSize(leftWidth-borderWidth, contentHeight-2) // -2 for header + border
	m.toolPane.SetSize(rightWidth-borderWidth, contentHeight-2)

	// Compose layout
	leftView := m.chatPane.View()
	rightView := m.toolPane.View()

	topSection := lipgloss.JoinHorizontal(lipgloss.Top, leftView, rightView)

	m.input.SetWidth(m.width - borderWidth)
	inputView := m.input.View()

	statusBar := renderStatusBar(m.width, m.connected, m.conversationID, m.agentResponding)

	content := lipgloss.JoinVertical(lipgloss.Left,
		topSection,
		inputView,
		statusBar,
	)

	v := tea.NewView(content)
	v.AltScreen = true
	return v
}
