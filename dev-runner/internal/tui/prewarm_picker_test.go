package tui

import (
	"strings"
	"testing"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// assertRectangular fails if the lines of s do not all render at the same
// display width — i.e. the modal box is ragged rather than a clean rectangle.
// This guards the "lines aren't the same size" overlay regression.
func assertRectangular(t *testing.T, label, s string) {
	t.Helper()
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) < 2 {
		t.Fatalf("%s: expected a multi-line box, got %d line(s)", label, len(lines))
	}
	want := lipgloss.Width(lines[0])
	for i, line := range lines {
		if w := lipgloss.Width(line); w != want {
			t.Errorf("%s: line %d width = %d, want %d (box is ragged)\n%q", label, i, w, want, line)
		}
	}
}

// TestPrewarmPickerRendersRectangular renders the picker overlay and the
// in-progress overlay and asserts each is a clean rectangle, so the modal
// background fills uniformly instead of leaving ragged-width rows.
func TestPrewarmPickerRendersRectangular(t *testing.T) {
	m := Model{width: 120, height: 40, ready: true}
	m.spinner = spinner.New()

	// Picker overlay.
	_ = m.openPrewarmPicker()
	if m.prewarmPickerForm == nil {
		t.Fatal("openPrewarmPicker did not build a form")
	}
	assertRectangular(t, "picker", m.renderPrewarmPicker())

	// In-progress overlay with a long line that previously got truncated.
	m.prewarmPickerForm = nil
	m.prewarmRunning = true
	m.prewarmOutput = "[prewarm] waiting for https://local.gasket.dev-godaddy.com:8443/ to become ready ...\n  200    412ms  /api/health\n"
	m.refreshPrewarmViewport()
	assertRectangular(t, "prewarming", m.renderPrewarming())
}

// chanWriter must split each Write into one prewarmLineMsg per line so live
// progress streams line-by-line; a split regression would silently drop lines.
func TestChanWriterSplitsLines(t *testing.T) {
	ch := make(chan tea.Msg, 16)
	w := &chanWriter{ch: ch}

	if _, err := w.Write([]byte("a\nb\nc")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if _, err := w.Write([]byte("x\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	close(ch)

	var got []string
	for msg := range ch {
		line, ok := msg.(prewarmLineMsg)
		if !ok {
			t.Fatalf("got %T, want prewarmLineMsg", msg)
		}
		got = append(got, string(line))
	}

	want := []string{"a", "b", "c", "x"}
	if len(got) != len(want) {
		t.Fatalf("lines = %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestAssemblePrewarmSelection(t *testing.T) {
	all := assemblePrewarmSelection([]int{0, 1})
	if !all.API || !all.Docker {
		t.Errorf("indices [0,1] => %+v, want both", all)
	}
	apiOnly := assemblePrewarmSelection([]int{0})
	if !apiOnly.API || apiOnly.Docker {
		t.Errorf("index [0] => %+v, want API only", apiOnly)
	}
	dockerOnly := assemblePrewarmSelection([]int{1})
	if dockerOnly.API || !dockerOnly.Docker {
		t.Errorf("index [1] => %+v, want Docker only", dockerOnly)
	}
	none := assemblePrewarmSelection(nil)
	if !none.Empty() {
		t.Errorf("nil => %+v, want empty", none)
	}
}
