package tui

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// probeMenuPageSize is the maximum number of items displayed per page.
// Keys 1-9 select items 1-9; key 0 selects the 10th.
const probeMenuPageSize = 10

// MenuBehavior is the activation behavior for a menu item.
type MenuBehavior interface{ menuBehavior() }

// ActionBehavior activates by calling Fn to produce a Cmd.
type ActionBehavior struct{ Fn func() tea.Cmd }

func (ActionBehavior) menuBehavior() {}

// SubmenuBehavior activates by pushing Items as a new menu level.
type SubmenuBehavior struct{ Items []ProbeMenuItem }

func (SubmenuBehavior) menuBehavior() {}

// ProbeMenuItem is a single entry in the probe navigation menu.
type ProbeMenuItem struct {
	// Label is the display text.
	Label string
	// DisableMsg is shown instead of activating when non-empty.
	// A non-empty DisableMsg marks the item as disabled.
	DisableMsg string
	// Behavior is the activation behavior. nil = no-op.
	// Use ActionBehavior or SubmenuBehavior.
	Behavior MenuBehavior
}

// probeMenuLevel is a single level on the navigation stack.
type probeMenuLevel struct {
	items  []ProbeMenuItem
	cursor int
	offset int
	page   int // current zero-based page (used when len(items) > probeMenuPageSize)
}

// ProbeMenu is a keyboard-navigable menu with an N-level stack for submenus.
// It is a value type — Update returns an updated copy (Bubble Tea convention).
type ProbeMenu struct {
	stack  []probeMenuLevel
	height int
}

// newProbeMenuFromItems constructs a ProbeMenu from a flat item list.
// height is the number of visible rows in the pane.
func newProbeMenuFromItems(items []ProbeMenuItem, height int) ProbeMenu {
	return ProbeMenu{
		stack:  []probeMenuLevel{{items: items}},
		height: height,
	}
}

// --- Test-accessible helpers (unexported) ---

func (pm ProbeMenu) cursor() int {
	if len(pm.stack) == 0 {
		return 0
	}
	return pm.stack[len(pm.stack)-1].cursor
}

func (pm ProbeMenu) offset() int {
	if len(pm.stack) == 0 {
		return 0
	}
	return pm.stack[len(pm.stack)-1].offset
}

func (pm ProbeMenu) depth() int {
	return len(pm.stack)
}

func (pm ProbeMenu) currentItems() []ProbeMenuItem {
	if len(pm.stack) == 0 {
		return nil
	}
	return pm.stack[len(pm.stack)-1].items
}

func (pm ProbeMenu) currentPage() int {
	if len(pm.stack) == 0 {
		return 0
	}
	return pm.stack[len(pm.stack)-1].page
}

func (pm ProbeMenu) totalPages() int {
	if len(pm.stack) == 0 {
		return 0
	}
	n := len(pm.stack[len(pm.stack)-1].items)
	if n <= probeMenuPageSize {
		return 1
	}
	return (n + probeMenuPageSize - 1) / probeMenuPageSize
}

// paginated reports whether the current level has more items than fit on one page.
func (pm ProbeMenu) paginated() bool {
	return pm.totalPages() > 1
}

// SetHeight updates the visible window height. Called on terminal resize.
func (pm *ProbeMenu) SetHeight(h int) {
	if h < 1 {
		h = 1
	}
	pm.height = h
}

// Push appends a new menu level with the given items. Called by async discovery
// handlers to display dynamically loaded content without replacing the root menu.
func (pm *ProbeMenu) Push(items []ProbeMenuItem) {
	pm.stack = append(pm.stack, probeMenuLevel{items: items})
}

// ScrollUp moves the visible window up by one row (mouse wheel support).
func (pm *ProbeMenu) ScrollUp() {
	if len(pm.stack) == 0 {
		return
	}
	top := &pm.stack[len(pm.stack)-1]
	if top.offset > 0 {
		top.offset--
	}
}

// ScrollDown moves the visible window down by one row (mouse wheel support).
func (pm *ProbeMenu) ScrollDown() {
	if len(pm.stack) == 0 {
		return
	}
	top := &pm.stack[len(pm.stack)-1]
	maxOffset := len(top.items) - pm.height
	if maxOffset < 0 {
		maxOffset = 0
	}
	if top.offset < maxOffset {
		top.offset++
	}
}

// Update processes a key press and returns the updated menu and an optional Cmd.
func (pm ProbeMenu) Update(msg tea.KeyPressMsg) (ProbeMenu, tea.Cmd) {
	if len(pm.stack) == 0 {
		return pm, nil
	}

	// Copy the stack so mutations don't alias the original.
	newStack := make([]probeMenuLevel, len(pm.stack))
	copy(newStack, pm.stack)
	pm.stack = newStack

	topIdx := len(pm.stack) - 1
	level := pm.stack[topIdx]

	if pm.paginated() {
		return pm.updatePaginated(msg, topIdx, level)
	}
	return pm.updateScrolling(msg, topIdx, level)
}

// updateScrolling handles key input for non-paginated menus (<=10 items).
func (pm ProbeMenu) updateScrolling(msg tea.KeyPressMsg, topIdx int, level probeMenuLevel) (ProbeMenu, tea.Cmd) {
	switch msg.String() {
	case "up":
		if level.cursor > 0 {
			level.cursor--
			level.offset = adjustedOffset(level.cursor, level.offset, pm.height)
		}
		pm.stack[topIdx] = level

	case "down":
		if level.cursor < len(level.items)-1 {
			level.cursor++
			level.offset = adjustedOffset(level.cursor, level.offset, pm.height)
		}
		pm.stack[topIdx] = level

	case "enter", " ":
		if level.cursor >= 0 && level.cursor < len(level.items) {
			return pm.activate(topIdx, level, level.cursor)
		}

	case "esc":
		if len(pm.stack) > 1 {
			pm.stack = pm.stack[:len(pm.stack)-1]
		}

	default:
		s := msg.String()
		if len(s) == 1 && s[0] >= '1' && s[0] <= '9' {
			n := int(s[0]-'0') - 1
			if n < len(level.items) {
				level.cursor = n
				level.offset = adjustedOffset(level.cursor, level.offset, pm.height)
				pm.stack[topIdx] = level
				return pm.activate(topIdx, level, n)
			}
		}
	}

	return pm, nil
}

// updatePaginated handles key input for paginated menus (>10 items).
func (pm ProbeMenu) updatePaginated(msg tea.KeyPressMsg, topIdx int, level probeMenuLevel) (ProbeMenu, tea.Cmd) {
	pageStart := level.page * probeMenuPageSize
	pageEnd := pageStart + probeMenuPageSize
	if pageEnd > len(level.items) {
		pageEnd = len(level.items)
	}

	switch msg.String() {
	case "left":
		if level.page > 0 {
			level.page--
			level.cursor = level.page * probeMenuPageSize
		}
		pm.stack[topIdx] = level

	case "right":
		if level.page < pm.totalPages()-1 {
			level.page++
			level.cursor = level.page * probeMenuPageSize
		}
		pm.stack[topIdx] = level

	case "up":
		if level.cursor > pageStart {
			level.cursor--
		}
		pm.stack[topIdx] = level

	case "down":
		if level.cursor < pageEnd-1 {
			level.cursor++
		}
		pm.stack[topIdx] = level

	case "enter", " ":
		if level.cursor >= 0 && level.cursor < len(level.items) {
			return pm.activate(topIdx, level, level.cursor)
		}

	case "esc":
		if len(pm.stack) > 1 {
			pm.stack = pm.stack[:len(pm.stack)-1]
		}

	default:
		s := msg.String()
		if len(s) == 1 && s[0] >= '1' && s[0] <= '9' {
			idx := pageStart + int(s[0]-'0') - 1
			if idx < pageEnd {
				level.cursor = idx
				pm.stack[topIdx] = level
				return pm.activate(topIdx, level, idx)
			}
		}
		if s == "0" {
			idx := pageStart + 9
			if idx < pageEnd {
				level.cursor = idx
				pm.stack[topIdx] = level
				return pm.activate(topIdx, level, idx)
			}
		}
	}

	return pm, nil
}

// activate handles item selection: disabled items are no-ops, SubmenuBehavior
// pushes a new level, and ActionBehavior returns the action's Cmd.
func (pm ProbeMenu) activate(topIdx int, level probeMenuLevel, idx int) (ProbeMenu, tea.Cmd) {
	item := level.items[idx]

	if item.DisableMsg != "" {
		return pm, nil
	}

	switch b := item.Behavior.(type) {
	case SubmenuBehavior:
		pm.stack = append(pm.stack, probeMenuLevel{items: b.Items})
		return pm, nil
	case ActionBehavior:
		return pm, b.Fn()
	}

	return pm, nil
}

// View renders the visible slice of the current menu level.
func (pm ProbeMenu) View(width int) string {
	if len(pm.stack) == 0 {
		return ""
	}
	level := pm.stack[len(pm.stack)-1]
	items := level.items

	if pm.paginated() {
		return pm.viewPaginated(level, items, width)
	}
	return pm.viewScrolling(level, items, width)
}

// viewScrolling renders items using the scroll-offset model (<=10 items).
func (pm ProbeMenu) viewScrolling(level probeMenuLevel, items []ProbeMenuItem, width int) string {
	start := level.offset
	end := start + pm.height
	if end > len(items) {
		end = len(items)
	}
	if start >= len(items) {
		return ""
	}

	var lines []string
	for i := start; i < end; i++ {
		lines = append(lines, pm.renderItemLine(items[i], i, i, level.cursor, width))
	}

	return strings.Join(lines, "\n")
}

// viewPaginated renders items using the page model (>10 items).
func (pm ProbeMenu) viewPaginated(level probeMenuLevel, items []ProbeMenuItem, width int) string {
	pageStart := level.page * probeMenuPageSize
	pageEnd := pageStart + probeMenuPageSize
	if pageEnd > len(items) {
		pageEnd = len(items)
	}

	var lines []string
	for i := pageStart; i < pageEnd; i++ {
		posOnPage := i - pageStart // 0-based position within the page
		lines = append(lines, pm.renderItemLine(items[i], i, posOnPage, level.cursor, width))
	}

	// Hint line showing page navigation
	hint := fmt.Sprintf("  Scroll Pages \u2190 / \u2192  (%d/%d)", level.page+1, pm.totalPages())
	lines = append(lines, probeMenuHintStyle.Render(hint))

	return strings.Join(lines, "\n")
}

// renderItemLine renders a single menu item line with its number prefix and styling.
// globalIdx is the item's absolute index in the items slice (used for cursor comparison).
// posOnPage is the 0-based position within the visible page (used for the number prefix).
func (pm ProbeMenu) renderItemLine(item ProbeMenuItem, globalIdx, posOnPage, cursor, width int) string {
	isActive := globalIdx == cursor

	// Build number prefix: 1-9 for positions 0-8, 0 for position 9.
	var numPrefix string
	n := posOnPage + 1
	switch {
	case n <= 9:
		numPrefix = fmt.Sprintf(" %d ", n)
	case n == 10:
		numPrefix = " 0 "
	default:
		numPrefix = "   "
	}

	label := item.Label
	if item.DisableMsg != "" {
		label = label + " (disabled)"
	}

	line := numPrefix + label
	if width > 0 && len(line) > width {
		line = line[:width]
	}

	if item.DisableMsg != "" {
		return probeMenuDisabledStyle.Render(line)
	}
	if isActive {
		return probeMenuActiveStyle.Width(width).Render(line)
	}
	return probeMenuItemStyle.Render(line)
}

// adjustedOffset returns the scroll offset that keeps cursor visible in a
// window of the given height.
func adjustedOffset(cursor, offset, height int) int {
	if height < 1 {
		height = 1
	}
	// Cursor scrolled below window bottom
	if cursor >= offset+height {
		offset = cursor - height + 1
	}
	// Cursor scrolled above window top
	if cursor < offset {
		offset = cursor
	}
	if offset < 0 {
		offset = 0
	}
	return offset
}

// --- Styles for probe menu ---

var (
	probeMenuActiveStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("15")).
				Background(lipgloss.Color("62")).
				Bold(true)

	probeMenuItemStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("250"))

	probeMenuDisabledStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("240"))

	probeMenuHintStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("245")).
				Italic(true)
)
