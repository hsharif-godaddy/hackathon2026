package tui

import (
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/viewport"
	"charm.land/lipgloss/v2"
)

// ChatLineType classifies lines in the chat pane.
type ChatLineType int

const (
	LineUser  ChatLineType = iota
	LineAgent              // Agent text content
	LineTool               // Tool call summary
	LineError              // Error message
	LineInfo               // System info (connected, completed, etc.)
)

// ChatLine represents a single line in the chat log.
type ChatLine struct {
	Type     ChatLineType
	Text     string
	ToolID   string // only for LineTool
	ToolName string // only for LineTool — stored to avoid parsing rendered text
}

// ChatPane is the left pane showing the conversation log.
type ChatPane struct {
	viewport    viewport.Model
	lines       []ChatLine
	toolIndices []int          // indices into lines that are LineTool
	selectedIdx int            // index into toolIndices, -1 if none
	focused     bool
	width       int
	height      int
}

// NewChatPane creates a new chat pane.
func NewChatPane(width, height int) ChatPane {
	vp := viewport.New(viewport.WithWidth(width), viewport.WithHeight(height))
	vp.SoftWrap = true
	return ChatPane{
		viewport:    vp,
		selectedIdx: -1,
		width:       width,
		height:      height,
	}
}

// AppendUserMessage adds a user message line.
func (p *ChatPane) AppendUserMessage(msg string) {
	p.lines = append(p.lines, ChatLine{
		Type: LineUser,
		Text: msg,
	})
	p.rebuildContent()
}

// AppendAgentChunk appends text to the current agent message,
// or starts a new one if the last line isn't an agent line.
func (p *ChatPane) AppendAgentChunk(text string) {
	if len(p.lines) > 0 && p.lines[len(p.lines)-1].Type == LineAgent {
		p.lines[len(p.lines)-1].Text += text
	} else {
		p.lines = append(p.lines, ChatLine{
			Type: LineAgent,
			Text: text,
		})
	}
	p.rebuildContent()
}

// AppendToolStart adds a tool call summary line with running status.
func (p *ChatPane) AppendToolStart(toolName, toolID string) {
	p.lines = append(p.lines, ChatLine{
		Type:     LineTool,
		Text:     fmt.Sprintf("  %s %s", toolRunningStyle.Render("●"), toolName),
		ToolID:   toolID,
		ToolName: toolName,
	})
	// Track tool line index and auto-select
	idx := len(p.lines) - 1
	p.toolIndices = append(p.toolIndices, idx)
	p.selectedIdx = len(p.toolIndices) - 1
	p.rebuildContent()
}

// UpdateToolResult updates the tool summary line with completion status.
func (p *ChatPane) UpdateToolResult(toolID string, duration time.Duration, success bool) {
	for _, lineIdx := range p.toolIndices {
		if p.lines[lineIdx].ToolID == toolID {
			name := p.lines[lineIdx].ToolName
			dur := duration.Truncate(time.Millisecond)
			if success {
				p.lines[lineIdx].Text = fmt.Sprintf("  %s %s %s",
					toolCompletedStyle.Render("✓"),
					name,
					dimStyle.Render(fmt.Sprintf("(%s)", dur)))
			} else {
				p.lines[lineIdx].Text = fmt.Sprintf("  %s %s %s",
					toolErrorStyle.Render("✗"),
					name,
					dimStyle.Render(fmt.Sprintf("(%s)", dur)))
			}
			break
		}
	}
	p.rebuildContent()
}

// AppendError adds an error message line.
func (p *ChatPane) AppendError(msg string) {
	p.lines = append(p.lines, ChatLine{
		Type: LineError,
		Text: msg,
	})
	p.rebuildContent()
}

// AppendInfo adds an info message line.
func (p *ChatPane) AppendInfo(msg string) {
	p.lines = append(p.lines, ChatLine{
		Type: LineInfo,
		Text: msg,
	})
	p.rebuildContent()
}

// SelectedToolID returns the tool ID of the currently selected tool line.
func (p *ChatPane) SelectedToolID() string {
	if p.selectedIdx < 0 || p.selectedIdx >= len(p.toolIndices) {
		return ""
	}
	lineIdx := p.toolIndices[p.selectedIdx]
	return p.lines[lineIdx].ToolID
}

// SelectNext moves selection to the next tool line.
func (p *ChatPane) SelectNext() {
	if len(p.toolIndices) == 0 {
		return
	}
	p.selectedIdx = (p.selectedIdx + 1) % len(p.toolIndices)
	p.rebuildContent()
}

// SelectPrev moves selection to the previous tool line.
func (p *ChatPane) SelectPrev() {
	if len(p.toolIndices) == 0 {
		return
	}
	p.selectedIdx--
	if p.selectedIdx < 0 {
		p.selectedIdx = len(p.toolIndices) - 1
	}
	p.rebuildContent()
}

// SetSize resizes the chat pane.
func (p *ChatPane) SetSize(width, height int) {
	p.width = width
	p.height = height
	p.viewport.SetWidth(width)
	p.viewport.SetHeight(height)
}

// SetFocused sets focus state.
func (p *ChatPane) SetFocused(focused bool) {
	p.focused = focused
}

// ScrollUp scrolls the viewport up.
func (p *ChatPane) ScrollUp(n int) {
	p.viewport.SetYOffset(p.viewport.YOffset() - n)
}

// ScrollDown scrolls the viewport down.
func (p *ChatPane) ScrollDown(n int) {
	p.viewport.SetYOffset(p.viewport.YOffset() + n)
}

// GotoTop scrolls to the top.
func (p *ChatPane) GotoTop() {
	p.viewport.GotoTop()
}

// GotoBottom scrolls to the bottom.
func (p *ChatPane) GotoBottom() {
	p.viewport.GotoBottom()
}

// View renders the chat pane with border.
func (p *ChatPane) View() string {
	border := unfocusedBorderStyle
	header := paneHeaderDimStyle
	if p.focused {
		border = focusedBorderStyle
		header = paneHeaderStyle
	}

	title := header.Render(" Chat ")
	// Pad title to full width
	titleWidth := lipgloss.Width(title)
	if titleWidth < p.width {
		title += lipgloss.NewStyle().
			Background(header.GetBackground()).
			Render(strings.Repeat(" ", p.width-titleWidth))
	}

	content := lipgloss.JoinVertical(lipgloss.Left,
		title,
		p.viewport.View(),
	)
	return border.Width(p.width).Render(content)
}

func (p *ChatPane) rebuildContent() {
	var b strings.Builder
	selectedLineIdx := -1
	if p.selectedIdx >= 0 && p.selectedIdx < len(p.toolIndices) {
		selectedLineIdx = p.toolIndices[p.selectedIdx]
	}

	for i, line := range p.lines {
		if i > 0 {
			b.WriteByte('\n')
		}
		text := line.Text
		switch line.Type {
		case LineUser:
			text = userMsgStyle.Render("You: ") + text
		case LineAgent:
			text = agentMsgStyle.Render(text)
		case LineTool:
			if i == selectedLineIdx {
				text = toolSelectedStyle.Render(text)
			}
		case LineError:
			text = errorMsgStyle.Render("Error: " + text)
		case LineInfo:
			text = dimStyle.Render(text)
		}
		b.WriteString(text)
	}

	p.viewport.SetContent(b.String())
	p.viewport.GotoBottom()
}

