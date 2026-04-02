package tui

import (
	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/cli-agent-client/internal/client"
)

// Update handles all messages.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		return m, nil

	case client.WSConnectedMsg:
		m.connected = true
		m.conversationID = msg.ConversationID
		m.chatPane.AppendInfo("Connected (conversation: " + msg.ConversationID + ")")
		m.input.SetEnabled(true)
		m.updateFocus(FocusInput)
		return m, nil

	case client.WSChunkMsg:
		m.chatPane.AppendAgentChunk(msg.Content)
		return m, nil

	case client.WSToolStartMsg:
		m.chatPane.AppendToolStart(msg.ToolName, msg.ToolID)
		tc := ToolCall{
			ID:     msg.ToolID,
			Name:   msg.ToolName,
			Status: "running",
		}
		m.toolCalls = append(m.toolCalls, tc)
		idx := len(m.toolCalls) - 1
		m.toolByID[msg.ToolID] = idx
		m.selectedTool = idx

		// Render start in tool pane
		r := m.renderers.Get(msg.ToolName)
		content := r.RenderStart(msg.ToolName, msg.ToolID)
		m.toolPane.SetContent(msg.ToolName, content)
		return m, nil

	case client.WSToolResultMsg:
		if idx, ok := m.toolByID[msg.ToolID]; ok {
			tc := &m.toolCalls[idx]
			tc.Duration = msg.Duration
			if msg.Success {
				tc.Status = "completed"
			} else {
				tc.Status = "error"
				// Derive synthetic error since protocol doesn't include error text
				if tc.Error == "" {
					tc.Error = "Tool execution failed"
				}
			}
			m.chatPane.UpdateToolResult(msg.ToolID, msg.Duration, msg.Success)

			// Re-render in tool pane if this tool is selected
			if m.selectedTool == idx {
				m.renderSelectedTool()
			}
		}
		return m, nil

	case client.WSCompleteMsg:
		m.agentResponding = false
		m.input.SetEnabled(true)
		if msg.Cancelled {
			m.chatPane.AppendInfo("Cancelled: " + msg.Reason)
		}
		return m, nil

	case client.WSErrorMsg:
		m.chatPane.AppendError(msg.Message)
		m.agentResponding = false
		m.input.SetEnabled(true)
		return m, nil

	case client.WSDisconnectedMsg:
		m.connected = false
		errMsg := "Disconnected"
		if msg.Err != nil {
			errMsg += ": " + msg.Err.Error()
		}
		m.chatPane.AppendError(errMsg)
		m.agentResponding = false
		m.input.SetEnabled(false)
		return m, nil

	case tea.KeyPressMsg:
		return m.handleKey(msg)
	}

	// Pass through to input if focused
	if m.focusedPane == FocusInput {
		cmd := m.input.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m Model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := msg.String()

	switch key {
	case "ctrl+c", "q":
		if m.focusedPane != FocusInput || m.input.Value() == "" {
			return m, tea.Quit
		}
		// If typing, don't quit — let it fall through to input

	case "tab":
		switch m.focusedPane {
		case FocusChat:
			m.updateFocus(FocusTool)
		case FocusTool:
			m.updateFocus(FocusInput)
		case FocusInput:
			m.updateFocus(FocusChat)
		}
		return m, nil

	case "shift+tab":
		switch m.focusedPane {
		case FocusChat:
			m.updateFocus(FocusInput)
		case FocusTool:
			m.updateFocus(FocusChat)
		case FocusInput:
			m.updateFocus(FocusTool)
		}
		return m, nil

	case "/":
		if m.focusedPane != FocusInput {
			m.updateFocus(FocusInput)
			return m, m.input.Focus()
		}

	case "enter":
		if m.focusedPane == FocusInput && m.input.Value() != "" {
			return m.sendMessage()
		}
		if m.focusedPane == FocusChat {
			// Select tool — load into tool pane
			m.renderSelectedTool()
			return m, nil
		}

	case "r":
		if !m.connected && m.focusedPane != FocusInput {
			m.chatPane.AppendInfo("Reconnect not yet implemented. Restart the client.")
			return m, nil
		}

	case "escape":
		if m.focusedPane == FocusInput {
			m.updateFocus(FocusChat)
			return m, nil
		}
	}

	// Scrolling for focused pane
	if m.focusedPane == FocusChat {
		switch key {
		case "j", "down":
			m.chatPane.ScrollDown(1)
			return m, nil
		case "k", "up":
			m.chatPane.ScrollUp(1)
			return m, nil
		case "g":
			m.chatPane.GotoTop()
			return m, nil
		case "G":
			m.chatPane.GotoBottom()
			return m, nil
		case "n":
			m.chatPane.SelectNext()
			m.renderSelectedTool()
			return m, nil
		case "N":
			m.chatPane.SelectPrev()
			m.renderSelectedTool()
			return m, nil
		}
	}

	if m.focusedPane == FocusTool {
		switch key {
		case "j", "down":
			m.toolPane.ScrollDown(1)
			return m, nil
		case "k", "up":
			m.toolPane.ScrollUp(1)
			return m, nil
		case "g":
			m.toolPane.GotoTop()
			return m, nil
		case "G":
			m.toolPane.GotoBottom()
			return m, nil
		}
	}

	// Pass to input when focused
	if m.focusedPane == FocusInput {
		cmd := m.input.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m *Model) sendMessage() (Model, tea.Cmd) {
	message := m.input.Value()
	m.input.Reset()
	m.chatPane.AppendUserMessage(message)
	m.agentResponding = true
	m.input.SetEnabled(false)

	return *m, func() tea.Msg {
		if err := m.wsClient.SendChat(message); err != nil {
			return client.WSErrorMsg{Message: "Failed to send: " + err.Error()}
		}
		return nil
	}
}

func (m *Model) updateFocus(pane FocusedPane) {
	m.focusedPane = pane
	m.chatPane.SetFocused(pane == FocusChat)
	m.toolPane.SetFocused(pane == FocusTool)
	m.input.SetFocused(pane == FocusInput)
}

func (m *Model) renderSelectedTool() {
	toolID := m.chatPane.SelectedToolID()
	if toolID == "" {
		m.toolPane.Clear()
		return
	}

	idx, ok := m.toolByID[toolID]
	if !ok {
		m.toolPane.Clear()
		return
	}

	tc := m.toolCalls[idx]
	r := m.renderers.Get(tc.Name)
	m.selectedTool = idx

	var content string
	switch tc.Status {
	case "running":
		if tc.Input != nil {
			content = r.RenderInput(tc.Name, tc.Input)
		} else {
			content = r.RenderStart(tc.Name, tc.ID)
		}
	case "completed", "error":
		content = r.RenderResult(tc.Name, tc.Input, tc.Output, tc.Error, tc.Duration)
	}

	m.toolPane.SetContent(tc.Name, content)
}

