package tui

import (
	"fmt"
	"strings"

	"charm.land/bubbles/v2/viewport"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/airo-ai-builder/dev-runner/internal/process"
)

// Pane renders a scrollable log pane for a single process.
type Pane struct {
	Viewport   viewport.Model
	AutoFollow bool
	label      string

	searchQuery       string
	matchIndices      []int
	lineVisualOffsets []int // maps logical line index to visual row offset (for soft-wrap)
	currentMatch      int
	scrollAfterSearch bool
}

// NewPane creates a Pane for a process.
func NewPane(name string, width, height int) Pane {
	vp := newSoftWrapViewport(width, height)
	vp.Style = lipgloss.NewStyle()
	return Pane{
		Viewport:   vp,
		AutoFollow: true,
		label:      name,
	}
}

func newSoftWrapViewport(width, height int) viewport.Model {
	vp := viewport.New(viewport.WithWidth(width), viewport.WithHeight(height))
	vp.SoftWrap = true
	return vp
}

// SetSize resizes the pane viewport.
func (p *Pane) SetSize(width, height int) {
	p.Viewport.SetWidth(width)
	p.Viewport.SetHeight(height)
}

// UpdateContent rebuilds the viewport content from process output lines.
func (p *Pane) UpdateContent(lines []process.OutputLine, showPrefix bool) {
	savedOffset := p.Viewport.YOffset()
	var b strings.Builder
	prefix := ""
	if showPrefix {
		prefix = fmt.Sprintf("[%s] ", p.label)
	}

	p.matchIndices = nil
	savedMatch := p.currentMatch

	prefixStyle := lipgloss.NewStyle().Bold(true)

	for i, line := range lines {
		if i > 0 {
			b.WriteByte('\n')
		}

		text := line.Text
		if p.searchQuery != "" && strings.Contains(strings.ToLower(text), strings.ToLower(p.searchQuery)) {
			p.matchIndices = append(p.matchIndices, i)
			text = highlightSearch(text, p.searchQuery)
		}

		if line.IsError {
			text = errorLineStyle.Render(" ERROR ") + " " + text
		}

		if showPrefix {
			b.WriteString(prefixStyle.Render(prefix))
		}
		b.WriteString(text)
	}

	// Clamp currentMatch to new match count
	if len(p.matchIndices) > 0 {
		if savedMatch >= len(p.matchIndices) {
			p.currentMatch = len(p.matchIndices) - 1
		} else {
			p.currentMatch = savedMatch
		}
	} else {
		p.currentMatch = 0
	}

	content := b.String()

	// Precompute visual row offsets for each logical line so scrollToMatch
	// works correctly with soft-wrapped content.
	vpWidth := p.Viewport.Width()
	contentLines := strings.Split(content, "\n")
	p.lineVisualOffsets = make([]int, len(contentLines))
	visualRow := 0
	for i, cl := range contentLines {
		p.lineVisualOffsets[i] = visualRow
		w := ansi.StringWidth(cl)
		rows := 1
		if vpWidth > 0 && w > vpWidth {
			rows = (w + vpWidth - 1) / vpWidth
		}
		visualRow += rows
	}

	p.Viewport.SetContent(content)
	if p.scrollAfterSearch && len(p.matchIndices) > 0 {
		p.scrollAfterSearch = false
		p.scrollToMatch()
	} else if p.AutoFollow {
		p.Viewport.GotoBottom()
	} else {
		// Preserve scroll position when content updates
		p.Viewport.SetYOffset(savedOffset)
	}
}

// SetSearch sets the current search query and recomputes matches.
func (p *Pane) SetSearch(query string) {
	p.searchQuery = query
	p.currentMatch = 0
	// Auto-scroll to first match after next UpdateContent
	p.scrollAfterSearch = true
}

// MatchCount returns total number of search matches.
func (p *Pane) MatchCount() int {
	return len(p.matchIndices)
}

// CurrentMatchIndex returns 1-based current match position.
func (p *Pane) CurrentMatchIndex() int {
	if len(p.matchIndices) == 0 {
		return 0
	}
	return p.currentMatch + 1
}

// NextMatch scrolls to the next search match.
func (p *Pane) NextMatch() {
	if len(p.matchIndices) == 0 {
		return
	}
	p.currentMatch = (p.currentMatch + 1) % len(p.matchIndices)
	p.scrollToMatch()
}

// PrevMatch scrolls to the previous search match.
func (p *Pane) PrevMatch() {
	if len(p.matchIndices) == 0 {
		return
	}
	p.currentMatch--
	if p.currentMatch < 0 {
		p.currentMatch = len(p.matchIndices) - 1
	}
	p.scrollToMatch()
}

func (p *Pane) scrollToMatch() {
	if len(p.matchIndices) == 0 {
		return
	}
	lineIdx := p.matchIndices[p.currentMatch]
	if lineIdx < len(p.lineVisualOffsets) {
		p.Viewport.SetYOffset(p.lineVisualOffsets[lineIdx])
	} else {
		p.Viewport.SetYOffset(lineIdx)
	}
	p.AutoFollow = false
}

func highlightSearch(text, query string) string {
	if query == "" {
		return text
	}
	lower := strings.ToLower(text)
	lowerQ := strings.ToLower(query)

	var result strings.Builder
	pos := 0
	for {
		idx := strings.Index(lower[pos:], lowerQ)
		if idx < 0 {
			result.WriteString(text[pos:])
			break
		}
		result.WriteString(text[pos : pos+idx])
		result.WriteString(searchMatchStyle.Render(text[pos+idx : pos+idx+len(lowerQ)]))
		pos += idx + len(lowerQ)
	}
	return result.String()
}
