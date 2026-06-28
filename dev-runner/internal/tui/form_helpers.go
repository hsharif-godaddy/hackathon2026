package tui

import (
	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
)

// modalBoxMaxWidth caps the *rendered* box width (including settingsBoxStyle
// border + padding) so the modal never runs past the terminal edge.
const modalBoxMaxWidth = 60

// modalBoxChrome is the horizontal space consumed by settingsBoxStyle:
// DoubleBorder (2) + Padding(1, 3) (6) = 8 columns.
const modalBoxChrome = 8

// Dedicated caps for the prewarm progress overlay. The shared form cap
// (modalBoxMaxWidth = 60) is deliberately narrow for short form fields, but a
// streaming log tail wants far more room — long URLs were being truncated to
// an ellipsis. Both values are *rendered box* dimensions (border + padding
// included) so the box never runs past the terminal edge.
const (
	prewarmBoxMaxWidth  = 100
	prewarmBoxMaxHeight = 18
	// prewarmBoxVChrome is the vertical space the box reserves around the
	// scrollable viewport: DoubleBorder top+bottom (2) + Padding top+bottom
	// (2) + header line (1) + blank spacer after header (1) + blank spacer
	// before footer (1) + footer hint line (1) = 8 rows.
	prewarmBoxVChrome = 8
)

// prewarmModalSize returns the interior (viewport) width/height for the
// prewarm progress overlay, derived from the terminal size and clamped so the
// box stays on screen and never collapses on tiny terminals. Mirrors
// modalWidth but with the wider/taller prewarm caps and a height budget.
func (m *Model) prewarmModalSize() (width, height int) {
	// Width: fill the terminal minus a small margin, capped at
	// prewarmBoxMaxWidth, then strip the horizontal chrome. Floor at 30 so a
	// narrow terminal still shows readable (soft-wrapped) text.
	box := m.width - 8
	if m.width <= 0 || box > prewarmBoxMaxWidth {
		box = prewarmBoxMaxWidth
	}
	width = box - modalBoxChrome
	if width < 30 {
		width = 30
	}

	// Height: roughly half the terminal, capped at prewarmBoxMaxHeight, then
	// strip the vertical chrome. Floor at 4 visible rows so the viewport stays
	// usable on short terminals.
	hbox := m.height / 2
	if m.height <= 0 || hbox > prewarmBoxMaxHeight {
		hbox = prewarmBoxMaxHeight
	}
	height = hbox - prewarmBoxVChrome
	if height < 4 {
		height = 4
	}
	return width, height
}

// modalFormKeymap is huh's default keymap with Esc bound to Quit so modals
// are dismissable. ctrl+c is intentionally omitted — the global key handler
// intercepts ctrl+c before huh sees it, so binding it here would produce
// inaccurate help text.
var modalFormKeymap *huh.KeyMap

func init() {
	km := huh.NewDefaultKeyMap()
	km.Quit = key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "cancel"))
	modalFormKeymap = km
}

// modalWidth returns the huh form width for a modal, derived from the box
// width cap minus the surrounding chrome so the rendered box stays under
// modalBoxMaxWidth on any terminal.
func (m *Model) modalWidth() int {
	if m.width <= 0 {
		return modalBoxMaxWidth - modalBoxChrome
	}
	box := m.width
	if box > modalBoxMaxWidth {
		box = modalBoxMaxWidth
	}
	w := box - modalBoxChrome
	if w < 20 {
		w = 20
	}
	return w
}

// applyModalForm applies the modal keymap and a clamped width. Use for any
// form rendered as a centered overlay (settings, dev settings, quit confirm).
func (m *Model) applyModalForm(f *huh.Form) *huh.Form {
	if f == nil {
		return nil
	}
	f.WithKeyMap(modalFormKeymap)
	f.WithWidth(m.modalWidth())
	f.WithTheme(huh.ThemeFunc(modalTheme))
	return f
}

// applyInlineForm applies the full terminal width. Use for forms that render
// inline within the phase view (env form, fix selector).
func (m *Model) applyInlineForm(f *huh.Form) *huh.Form {
	if f != nil && m.width > 0 {
		f.WithWidth(m.width)
	}
	return f
}

// resizeForms propagates the current width to every active huh form. Called
// from the WindowSizeMsg handler so open modals/inline forms rewrap with the
// new terminal width.
func (m *Model) resizeForms() {
	for _, f := range []*huh.Form{m.envForm, m.fixSelectorForm, m.cleanPickerForm} {
		m.applyInlineForm(f)
	}
	for _, f := range []*huh.Form{m.devSettingsForm, m.quitConfirmForm, m.settingsForm, m.e2ePickerForm, m.probePickerForm, m.probeCustomRunForm, m.probeEnvEditForm, m.prewarmPickerForm, m.faultPickerForm} {
		m.applyModalForm(f)
	}
}

// stepForm forwards a message to a huh form and re-binds the returned Model to
// the *huh.Form field, collapsing the Update -> type-assert dance that every
// form handler repeats.
func stepForm(f *huh.Form, msg tea.Msg) (*huh.Form, tea.Cmd) {
	next, cmd := f.Update(msg)
	if nf, ok := next.(*huh.Form); ok {
		return nf, cmd
	}
	return f, cmd
}

// prewarmPickerActive reports whether the prewarm picker overlay is open.
func (m Model) prewarmPickerActive() bool {
	return m.prewarmPickerForm != nil
}

// anyModalOpen reports whether any overlay form is active. Used to gate
// background interaction (viewport scroll, mouse click hint, etc.) so the
// user cannot interact with the underlying UI while a modal is visible.
func (m Model) anyModalOpen() bool {
	return m.settingsForm != nil || m.devSettingsForm != nil || m.quitConfirmForm != nil ||
		m.e2ePickerActive() || m.probePickerActive() || m.probeCustomRunActive() || m.probeEnvEditActive() ||
		m.prewarmPickerActive() || m.prewarmRunning || m.prewarmErr != nil || m.faultPickerActive()
}

// forwardToActiveForm routes any tea.Msg to the currently-open form's
// per-surface update handler. huh.Form uses internal messages
// (nextFieldMsg/nextGroupMsg) to advance its state machine, so the main
// Update must forward non-keypress events or the form will never reach
// StateCompleted after the user presses Enter.
//
// Exactly one form is open at a time (modal UI); the checks below reflect
// the order used by handleKey.
func (m *Model) forwardToActiveForm(msg tea.Msg) tea.Cmd {
	switch {
	case m.quitConfirmForm != nil:
		return m.updateQuitConfirm(msg)
	case m.settingsForm != nil:
		return m.updateSettings(msg)
	case m.devSettingsForm != nil:
		return m.updateDevSettings(msg)
	case m.envForm != nil:
		return m.updateEnvForm(msg)
	case m.fixSelectorForm != nil:
		return m.updateFixSelector(msg)
	case m.cleanPickerForm != nil:
		return m.updateCleanPicker(msg)
	case m.e2ePickerForm != nil:
		return m.updateE2EPicker(msg)
	case m.probePickerForm != nil:
		return m.updateProbePicker(msg)
	case m.probeCustomRunForm != nil:
		return m.updateProbeCustomRun(msg)
	case m.probeEnvEditForm != nil:
		return m.updateProbeEnvEdit(msg)
	case m.prewarmPickerForm != nil:
		return m.updatePrewarmPicker(msg)
	case m.faultPickerForm != nil:
		return m.updateFaultPicker(msg)
	}
	return nil
}
