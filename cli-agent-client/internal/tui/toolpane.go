package tui

import (
	"strings"

	"charm.land/bubbles/v2/viewport"
	"charm.land/lipgloss/v2"
)

// ToolPane is the right pane showing tool execution details.
type ToolPane struct {
	viewport viewport.Model
	content  string
	title    string
	focused  bool
	width    int
	height   int
}

// NewToolPane creates a new tool detail pane.
func NewToolPane(width, height int) ToolPane {
	vp := viewport.New(viewport.WithWidth(width), viewport.WithHeight(height))
	vp.SoftWrap = true
	return ToolPane{
		viewport: vp,
		title:    "Tool Detail",
		width:    width,
		height:   height,
	}
}

// SetContent updates the pane with new tool detail content.
func (p *ToolPane) SetContent(title, content string) {
	p.title = title
	p.content = content
	p.viewport.SetContent(content)
	p.viewport.GotoTop()
}

// Clear empties the pane.
func (p *ToolPane) Clear() {
	p.title = "Tool Detail"
	p.content = ""
	p.viewport.SetContent(dimStyle.Render("  No tool selected"))
}

// SetSize resizes the pane.
func (p *ToolPane) SetSize(width, height int) {
	p.width = width
	p.height = height
	p.viewport.SetWidth(width)
	p.viewport.SetHeight(height)
}

// SetFocused sets the focus state.
func (p *ToolPane) SetFocused(focused bool) {
	p.focused = focused
}

// ScrollUp scrolls up.
func (p *ToolPane) ScrollUp(n int) {
	p.viewport.SetYOffset(p.viewport.YOffset() - n)
}

// ScrollDown scrolls down.
func (p *ToolPane) ScrollDown(n int) {
	p.viewport.SetYOffset(p.viewport.YOffset() + n)
}

// GotoTop scrolls to the top.
func (p *ToolPane) GotoTop() {
	p.viewport.GotoTop()
}

// GotoBottom scrolls to the bottom.
func (p *ToolPane) GotoBottom() {
	p.viewport.GotoBottom()
}

// View renders the tool pane with border.
func (p *ToolPane) View() string {
	border := unfocusedBorderStyle
	header := paneHeaderDimStyle
	if p.focused {
		border = focusedBorderStyle
		header = paneHeaderStyle
	}

	title := header.Render(" " + p.title + " ")
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
