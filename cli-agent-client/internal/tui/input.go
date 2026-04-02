package tui

import (
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// Input is the bottom text input area.
type Input struct {
	textInput textinput.Model
	enabled   bool
	width     int
}

// NewInput creates a new input area.
func NewInput(width int) Input {
	ti := textinput.New()
	ti.Placeholder = "Type a message..."
	ti.Focus()
	ti.CharLimit = 4096

	return Input{
		textInput: ti,
		enabled:   true,
		width:     width,
	}
}

// SetEnabled enables or disables input.
func (i *Input) SetEnabled(enabled bool) {
	i.enabled = enabled
	if enabled {
		i.textInput.Focus()
		i.textInput.Placeholder = "Type a message..."
	} else {
		i.textInput.Blur()
		i.textInput.Placeholder = "Agent responding..."
	}
}

// SetWidth resizes the input.
func (i *Input) SetWidth(width int) {
	i.width = width
}

// Value returns the current input text.
func (i *Input) Value() string {
	return i.textInput.Value()
}

// Reset clears the input.
func (i *Input) Reset() {
	i.textInput.Reset()
}

// Focus gives focus to the input.
func (i *Input) Focus() tea.Cmd {
	return i.textInput.Focus()
}

// Blur removes focus from the input.
func (i *Input) Blur() {
	i.textInput.Blur()
}

// Update handles input messages.
func (i *Input) Update(msg tea.Msg) tea.Cmd {
	if !i.enabled {
		return nil
	}
	var cmd tea.Cmd
	i.textInput, cmd = i.textInput.Update(msg)
	return cmd
}

// View renders the input area.
func (i *Input) View() string {
	style := inputStyle
	if !i.enabled {
		style = inputDisabledStyle
	}

	content := i.textInput.View()
	return style.Width(i.width - 2).Render(content) // -2 for border
}

// Focused returns whether the input is focused.
func (i *Input) Focused() bool {
	return i.textInput.Focused()
}

// SetFocused controls focus state.
func (i *Input) SetFocused(focused bool) {
	if focused {
		i.textInput.Focus()
	} else {
		i.textInput.Blur()
	}
}

func renderStatusBar(width int, connected bool, conversationID string, agentResponding bool) string {
	var left string
	if connected {
		left = connectedStyle.Render("● Connected")
		if conversationID != "" {
			left += statusBarTextStyle.Render("  " + conversationID)
		}
	} else {
		left = disconnectedStyle.Render("● Disconnected")
	}
	left = statusBarTextStyle.Render(" ") + left

	var right string
	if agentResponding {
		right = statusBarTextStyle.Render("Responding... ")
	} else {
		right = statusBarKeyStyle.Render("Tab") + statusBarTextStyle.Render(":Focus ") +
			statusBarKeyStyle.Render("Enter") + statusBarTextStyle.Render(":Send ") +
			statusBarKeyStyle.Render("q") + statusBarTextStyle.Render(":Quit ")
	}

	gap := width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 0 {
		gap = 0
	}
	pad := statusBarStyle.Render(repeatSpace(gap))
	return left + pad + right
}

func repeatSpace(n int) string {
	if n <= 0 {
		return ""
	}
	b := make([]byte, n)
	for i := range b {
		b[i] = ' '
	}
	return string(b)
}
