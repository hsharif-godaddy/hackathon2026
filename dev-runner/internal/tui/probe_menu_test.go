package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

// makeItems builds n menu items. Items with a label ending in "*" are disabled.
func makeItems(labels ...string) []ProbeMenuItem {
	items := make([]ProbeMenuItem, len(labels))
	for i, l := range labels {
		if strings.HasSuffix(l, "*") {
			items[i] = ProbeMenuItem{Label: strings.TrimSuffix(l, "*"), DisableMsg: "not available"}
		} else {
			items[i] = ProbeMenuItem{Label: l}
		}
	}
	return items
}

// pressKey simulates a single key press on the menu.
func pressKey(pm ProbeMenu, key string) (ProbeMenu, tea.Cmd) {
	var msg tea.KeyPressMsg
	switch key {
	case "up":
		msg = tea.KeyPressMsg{Code: tea.KeyUp}
	case "down":
		msg = tea.KeyPressMsg{Code: tea.KeyDown}
	case "left":
		msg = tea.KeyPressMsg{Code: tea.KeyLeft}
	case "right":
		msg = tea.KeyPressMsg{Code: tea.KeyRight}
	case "enter":
		msg = tea.KeyPressMsg{Code: tea.KeyEnter}
	case "esc":
		msg = tea.KeyPressMsg{Code: tea.KeyEscape}
	default:
		if len(key) == 1 {
			msg = tea.KeyPressMsg{Code: rune(key[0]), Text: key}
		}
	}
	return pm.Update(msg)
}

// --- Cursor boundary tests ---

func TestProbeMenu_Cursor_DoesNotGoAboveZero(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B", "C"), 10)

	// Press up from initial position (0) — cursor must stay at 0
	pm, _ = pressKey(pm, "up")
	if pm.cursor() != 0 {
		t.Errorf("cursor after up at top = %d, want 0", pm.cursor())
	}
}

func TestProbeMenu_Cursor_DoesNotGoBelowLastItem(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B", "C"), 10)

	// Move to last item
	pm, _ = pressKey(pm, "down")
	pm, _ = pressKey(pm, "down")
	// Press down again — cursor must stay at 2
	pm, _ = pressKey(pm, "down")
	if pm.cursor() != 2 {
		t.Errorf("cursor after down at bottom = %d, want 2", pm.cursor())
	}
}

func TestProbeMenu_Cursor_MovesDown(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B", "C"), 10)
	pm, _ = pressKey(pm, "down")
	if pm.cursor() != 1 {
		t.Errorf("cursor after one down = %d, want 1", pm.cursor())
	}
}

// --- Scroll offset tests ---

func TestProbeMenu_Offset_AdjustsWhenCursorExceedsWindow(t *testing.T) {
	// Visible height = 2; items A, B, C, D
	pm := newProbeMenuFromItems(makeItems("A", "B", "C", "D"), 2)

	// Initial: offset=0, cursor=0. Press down 3 times to reach "D" (index 3).
	for i := 0; i < 3; i++ {
		pm, _ = pressKey(pm, "down")
	}

	// Cursor is at 3. With height=2, offset must have advanced to keep cursor visible.
	// Minimum offset such that cursor < offset+height => offset >= cursor-height+1 = 2
	if pm.offset() < 2 {
		t.Errorf("offset = %d after scrolling to last item, want >= 2 (height=2, cursor=3)", pm.offset())
	}
}

func TestProbeMenu_Offset_AdjustsWhenCursorGoesAboveWindow(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B", "C", "D"), 2)

	// Scroll down to the bottom
	for i := 0; i < 3; i++ {
		pm, _ = pressKey(pm, "down")
	}

	// Scroll back up to the top
	for i := 0; i < 3; i++ {
		pm, _ = pressKey(pm, "up")
	}

	// Cursor is at 0 — offset must be 0
	if pm.offset() != 0 {
		t.Errorf("offset = %d after scrolling back to top, want 0", pm.offset())
	}
}

// --- Number key tests ---

func TestProbeMenu_NumberKey_JumpsToItem(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B", "C", "D"), 10)

	pm, _ = pressKey(pm, "3")
	if pm.cursor() != 2 {
		t.Errorf("after pressing '3': cursor = %d, want 2 (index 2)", pm.cursor())
	}
}

func TestProbeMenu_NumberKey_ClampedToItemCount(t *testing.T) {
	// Only 2 items; pressing "9" should not move cursor
	pm := newProbeMenuFromItems(makeItems("A", "B"), 10)
	pm, _ = pressKey(pm, "9")
	if pm.cursor() != 0 {
		t.Errorf("pressing '9' with only 2 items: cursor = %d, want 0 (unchanged)", pm.cursor())
	}
}

func TestProbeMenu_NumberKey_1JumpsToFirst(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B", "C"), 10)
	// Move cursor down first
	pm, _ = pressKey(pm, "down")
	pm, _ = pressKey(pm, "down")
	// Press "1" to jump back to first
	pm, _ = pressKey(pm, "1")
	if pm.cursor() != 0 {
		t.Errorf("after pressing '1': cursor = %d, want 0", pm.cursor())
	}
}

// --- Push / Pop submenu tests ---

func TestProbeMenu_Push_CreatesSubmenuWithCursorReset(t *testing.T) {
	subItems := makeItems("Sub1", "Sub2")
	items := []ProbeMenuItem{
		{Label: "Parent", Behavior: SubmenuBehavior{Items: subItems}},
	}
	pm := newProbeMenuFromItems(items, 10)

	// Press Enter to push submenu
	pm, _ = pressKey(pm, "enter")

	if pm.depth() != 2 {
		t.Errorf("depth after push = %d, want 2", pm.depth())
	}
	if pm.cursor() != 0 {
		t.Errorf("cursor after push = %d, want 0 (reset)", pm.cursor())
	}
	// Check the new level has the sub-items
	if len(pm.currentItems()) != 2 {
		t.Errorf("len(currentItems) after push = %d, want 2", len(pm.currentItems()))
	}
}

func TestProbeMenu_Pop_RestoresParentCursor(t *testing.T) {
	subItems := makeItems("Sub1", "Sub2")
	items := []ProbeMenuItem{
		{Label: "A"},
		{Label: "Parent", Behavior: SubmenuBehavior{Items: subItems}},
	}
	pm := newProbeMenuFromItems(items, 10)

	// Move cursor to "Parent" (index 1), push submenu
	pm, _ = pressKey(pm, "down")
	pm, _ = pressKey(pm, "enter")
	if pm.depth() != 2 {
		t.Fatalf("expected depth 2 after push, got %d", pm.depth())
	}

	// Pop back
	pm, _ = pressKey(pm, "esc")

	if pm.depth() != 1 {
		t.Errorf("depth after pop = %d, want 1", pm.depth())
	}
	// Parent cursor should be restored to 1 (where we were before push)
	if pm.cursor() != 1 {
		t.Errorf("cursor after pop = %d, want 1 (restored parent cursor)", pm.cursor())
	}
}

func TestProbeMenu_Pop_AtRoot_IsNoOp(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B"), 10)
	pm, _ = pressKey(pm, "down")

	// Press Esc at root — should not change depth, cursor stays
	pm, _ = pressKey(pm, "esc")
	if pm.depth() != 1 {
		t.Errorf("depth after esc at root = %d, want 1 (no-op)", pm.depth())
	}
	if pm.cursor() != 1 {
		t.Errorf("cursor after esc at root = %d, want 1 (preserved)", pm.cursor())
	}
}

// --- Disabled item tests ---

func TestProbeMenu_DisabledItem_Enter_DoesNotCallAction(t *testing.T) {
	called := false
	items := []ProbeMenuItem{
		{
			Label:      "Disabled",
			DisableMsg: "not yet",
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				called = true
				return nil
			}},
		},
	}
	pm := newProbeMenuFromItems(items, 10)
	_, _ = pressKey(pm, "enter")
	if called {
		t.Error("Action was called on a disabled item; expected no-op")
	}
}

func TestProbeMenu_DisabledItem_NumberKey_DoesNotCallAction(t *testing.T) {
	called := false
	items := []ProbeMenuItem{
		{
			Label:      "Disabled",
			DisableMsg: "not yet",
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				called = true
				return nil
			}},
		},
	}
	pm := newProbeMenuFromItems(items, 10)
	_, _ = pressKey(pm, "1")
	if called {
		t.Error("Action was called via number key on a disabled item; expected no-op")
	}
}

func TestProbeMenu_EnabledItem_Enter_CallsAction(t *testing.T) {
	called := false
	items := []ProbeMenuItem{
		{
			Label: "Enabled",
			Behavior: ActionBehavior{Fn: func() tea.Cmd {
				called = true
				return nil
			}},
		},
	}
	pm := newProbeMenuFromItems(items, 10)
	_, cmd := pressKey(pm, "enter")
	if cmd != nil {
		cmd() // execute to trigger the side effect
	}
	if !called {
		t.Error("Action was not called on an enabled item with Enter")
	}
}

// --- View rendering tests ---

func TestProbeMenu_View_RendersVisibleSlice(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("Alpha", "Beta", "Gamma", "Delta"), 2)

	// With height=2 and offset=0, only "Alpha" and "Beta" should appear.
	view := pm.View(80)
	if !strings.Contains(view, "Alpha") {
		t.Error("view does not contain 'Alpha'")
	}
	if !strings.Contains(view, "Beta") {
		t.Error("view does not contain 'Beta'")
	}
	if strings.Contains(view, "Gamma") {
		t.Error("view contains 'Gamma' which is outside visible window")
	}
	if strings.Contains(view, "Delta") {
		t.Error("view contains 'Delta' which is outside visible window")
	}
}

func TestProbeMenu_View_ShowsNumberIndicators(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("First", "Second"), 10)
	view := pm.View(80)
	if !strings.Contains(view, "1") {
		t.Error("view does not show number '1' for first item")
	}
	if !strings.Contains(view, "2") {
		t.Error("view does not show number '2' for second item")
	}
}

func TestProbeMenu_View_ScrolledOffset_ShowsCorrectSlice(t *testing.T) {
	pm := newProbeMenuFromItems(makeItems("A", "B", "C", "D"), 2)

	// Scroll to bottom
	for i := 0; i < 3; i++ {
		pm, _ = pressKey(pm, "down")
	}

	view := pm.View(80)
	// At offset>=2, "C" or "D" should be visible (cursor moved past A/B)
	if !strings.Contains(view, "C") && !strings.Contains(view, "D") {
		t.Error("view at bottom does not contain 'C' or 'D'")
	}
}

// --- Pagination tests ---

// makeNItems creates n items labeled "Item1", "Item2", ..., "ItemN".
func makeNItems(n int) []ProbeMenuItem {
	labels := make([]string, n)
	for i := range labels {
		labels[i] = fmt.Sprintf("Item%d", i+1)
	}
	return makeItems(labels...)
}

func TestProbeMenu_Pagination_NoPageWhenTenOrFewer(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(10), 20)
	if pm.totalPages() != 1 {
		t.Errorf("totalPages for 10 items = %d, want 1", pm.totalPages())
	}
	// No hint line
	view := pm.View(80)
	if strings.Contains(view, "Scroll Pages") {
		t.Error("hint line shown when items <= 10")
	}
}

func TestProbeMenu_Pagination_HintLineWhenMoreThanTen(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(11), 20)
	if pm.totalPages() != 2 {
		t.Errorf("totalPages for 11 items = %d, want 2", pm.totalPages())
	}
	view := pm.View(80)
	if !strings.Contains(view, "Scroll Pages") {
		t.Error("hint line not shown when items > 10")
	}
	if !strings.Contains(view, "\u2190") || !strings.Contains(view, "\u2192") {
		t.Error("hint line missing arrow symbols")
	}
}

func TestProbeMenu_Pagination_RightArrowNextPage(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)

	// Start on page 0
	if pm.currentPage() != 0 {
		t.Fatalf("initial page = %d, want 0", pm.currentPage())
	}

	pm, _ = pressKey(pm, "right")
	if pm.currentPage() != 1 {
		t.Errorf("page after right = %d, want 1", pm.currentPage())
	}
	// Cursor should be at first item of page 1 (index 10)
	if pm.cursor() != 10 {
		t.Errorf("cursor after right = %d, want 10", pm.cursor())
	}
}

func TestProbeMenu_Pagination_LeftArrowPrevPage(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)

	// Go to page 1
	pm, _ = pressKey(pm, "right")
	// Go back to page 0
	pm, _ = pressKey(pm, "left")
	if pm.currentPage() != 0 {
		t.Errorf("page after left = %d, want 0", pm.currentPage())
	}
	if pm.cursor() != 0 {
		t.Errorf("cursor after left = %d, want 0", pm.cursor())
	}
}

func TestProbeMenu_Pagination_LeftAtFirstPage_NoOp(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)
	pm, _ = pressKey(pm, "left")
	if pm.currentPage() != 0 {
		t.Errorf("page after left at first page = %d, want 0", pm.currentPage())
	}
}

func TestProbeMenu_Pagination_RightAtLastPage_NoOp(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)
	pm, _ = pressKey(pm, "right") // page 1 (last page for 15 items)
	pm, _ = pressKey(pm, "right") // should be no-op
	if pm.currentPage() != 1 {
		t.Errorf("page after right at last page = %d, want 1", pm.currentPage())
	}
}

func TestProbeMenu_Pagination_NumberKeys_PageRelative(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)

	// On page 0, pressing "3" selects index 2 (Item3)
	pm, _ = pressKey(pm, "3")
	if pm.cursor() != 2 {
		t.Errorf("cursor after '3' on page 0 = %d, want 2", pm.cursor())
	}

	// Go to page 1, pressing "2" selects index 11 (Item12)
	pm, _ = pressKey(pm, "right")
	pm, _ = pressKey(pm, "2")
	if pm.cursor() != 11 {
		t.Errorf("cursor after '2' on page 1 = %d, want 11", pm.cursor())
	}
}

func TestProbeMenu_Pagination_ZeroKey_SelectsTenthItem(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)

	// On page 0, pressing "0" selects index 9 (Item10)
	pm, _ = pressKey(pm, "0")
	if pm.cursor() != 9 {
		t.Errorf("cursor after '0' on page 0 = %d, want 9", pm.cursor())
	}
}

func TestProbeMenu_Pagination_ZeroKey_NoOpIfPageHasFewerThanTen(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)

	// Go to page 1 (items 11-15, only 5 items)
	pm, _ = pressKey(pm, "right")
	// Pressing "0" should be a no-op since there are only 5 items on page 1
	pm, _ = pressKey(pm, "0")
	if pm.cursor() != 10 {
		t.Errorf("cursor after '0' on short page = %d, want 10 (unchanged)", pm.cursor())
	}
}

func TestProbeMenu_Pagination_UpDown_ConstrainedToPage(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(15), 20)

	// Go to page 1 (items at indices 10-14)
	pm, _ = pressKey(pm, "right")
	if pm.cursor() != 10 {
		t.Fatalf("cursor at page 1 start = %d, want 10", pm.cursor())
	}

	// Up at start of page should not go to previous page
	pm, _ = pressKey(pm, "up")
	if pm.cursor() != 10 {
		t.Errorf("cursor after up at page start = %d, want 10", pm.cursor())
	}

	// Move down to last item on page (index 14)
	for i := 0; i < 4; i++ {
		pm, _ = pressKey(pm, "down")
	}
	if pm.cursor() != 14 {
		t.Fatalf("cursor at page 1 end = %d, want 14", pm.cursor())
	}

	// Down at end of page should not advance to next page
	pm, _ = pressKey(pm, "down")
	if pm.cursor() != 14 {
		t.Errorf("cursor after down at page end = %d, want 14", pm.cursor())
	}
}

func TestProbeMenu_Pagination_ViewShowsOnlyCurrentPage(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(12), 20)

	// Page 0 shows items 1-10
	view := pm.View(80)
	if !strings.Contains(view, "Item1") {
		t.Error("page 0 view missing Item1")
	}
	if !strings.Contains(view, "Item10") {
		t.Error("page 0 view missing Item10")
	}
	if strings.Contains(view, "Item11") {
		t.Error("page 0 view shows Item11 (should be on page 1)")
	}

	// Page 1 shows items 11-12
	pm, _ = pressKey(pm, "right")
	view = pm.View(80)
	if !strings.Contains(view, "Item11") {
		t.Error("page 1 view missing Item11")
	}
	if !strings.Contains(view, "Item12") {
		t.Error("page 1 view missing Item12")
	}
	// Page 1 should not show page-0-only items (Item1 specifically, not Item10/Item11)
	if strings.Contains(view, " 1 Item1\n") {
		t.Error("page 1 view still shows Item1 from page 0")
	}
}

func TestProbeMenu_Pagination_NumberPrefix_ZeroForTenth(t *testing.T) {
	pm := newProbeMenuFromItems(makeNItems(11), 20)
	view := pm.View(80)
	// The 10th item should have prefix "0"
	if !strings.Contains(view, " 0 ") {
		t.Error("view missing '0' prefix for 10th item")
	}
}

func TestProbeMenu_Pagination_SmallMenu_NoPageChange(t *testing.T) {
	// A menu with 5 items should not respond to left/right
	pm := newProbeMenuFromItems(makeNItems(5), 20)
	pm, _ = pressKey(pm, "right")
	if pm.currentPage() != 0 {
		t.Errorf("page after right on small menu = %d, want 0", pm.currentPage())
	}
}
