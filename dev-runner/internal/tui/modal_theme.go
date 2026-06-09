package tui

import (
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"
)

// modalBg is the uniform fill behind every modal interior — a solid mid-gray
// panel (deliberately lighter than near-black) so the overlay reads as a
// distinct surface floating above the log content. settingsBoxStyle uses the
// same color for its border padding so the box and the huh form interior are
// seamless.
var modalBg = lipgloss.Color("238")

// modalFg is the default body-text foreground on modalBg — a high-contrast
// off-white.
var modalFg = lipgloss.Color("252")

// Accent and neutral foregrounds for the modal, chosen for contrast against
// modalBg. These are pinned explicitly rather than inherited from huh's theme:
// ThemeCharm derives its neutral text color from the terminal's light/dark
// detection, which resolves to a *dark* gray in dark-mode terminals and would
// render dark-on-dark against our fixed mid-gray panel.
var (
	modalIndigo  = lipgloss.Color("#7571F9") // titles
	modalFuchsia = lipgloss.Color("#F780E2") // selection cursor
	modalGreen   = lipgloss.Color("#02BF87") // selected option / checkmark
	modalDimFg   = lipgloss.Color("250")     // descriptions, unselected prefix
	modalHelpKey = lipgloss.Color("229")     // help key glyphs
	modalHelpFg  = lipgloss.Color("245")     // help descriptions/separators
)

// modalTheme derives huh's Charm theme but paints modalBg onto every sub-style
// (and pins legible foregrounds) so the rendered form is an edge-to-edge opaque
// panel with reliable contrast.
//
// huh's stock themes set Foreground only. Without a background on each
// sub-style, the cells huh emits (option text, the field's width-padding
// spaces, the help footer) carry no background, so every inner SGR reset drops
// the terminal back to its default (black) — settingsBoxStyle's outer
// Background can only paint the padding band and alignment fill it adds itself,
// never the pre-styled interior. Setting the background on each style closes
// that gap: every painted cell carries modalBg, and the matching box fill
// covers the alignment gaps and the empty field-separator rows.
//
// Width is intentionally NOT baked into the theme. huh caches the theme on the
// first WithTheme call and ignores later ones, so a width captured here would
// go stale on resize; relying on the field's own WithWidth padding plus the
// box's alignment fill keeps the panel correct at any width.
func modalTheme(isDark bool) *huh.Styles {
	t := huh.ThemeCharm(isDark)

	paint := func(f *huh.FieldStyles) {
		f.Base = f.Base.Background(modalBg).BorderBackground(modalBg)
		f.Title = f.Title.Foreground(modalIndigo).Background(modalBg)
		f.Description = f.Description.Foreground(modalDimFg).Background(modalBg)
		f.ErrorIndicator = f.ErrorIndicator.Background(modalBg)
		f.ErrorMessage = f.ErrorMessage.Background(modalBg)
		f.SelectSelector = f.SelectSelector.Foreground(modalFuchsia).Background(modalBg)
		f.NextIndicator = f.NextIndicator.Background(modalBg)
		f.PrevIndicator = f.PrevIndicator.Background(modalBg)
		f.Option = f.Option.Foreground(modalFg).Background(modalBg)
		f.MultiSelectSelector = f.MultiSelectSelector.Foreground(modalFuchsia).Background(modalBg)
		f.SelectedOption = f.SelectedOption.Foreground(modalGreen).Background(modalBg)
		f.SelectedPrefix = f.SelectedPrefix.Foreground(modalGreen).Background(modalBg)
		f.UnselectedOption = f.UnselectedOption.Foreground(modalFg).Background(modalBg)
		f.UnselectedPrefix = f.UnselectedPrefix.Foreground(modalDimFg).Background(modalBg)
		f.TextInput.Text = f.TextInput.Text.Foreground(modalFg).Background(modalBg)
		f.TextInput.Prompt = f.TextInput.Prompt.Foreground(modalFuchsia).Background(modalBg)
		f.TextInput.Placeholder = f.TextInput.Placeholder.Background(modalBg)
		f.TextInput.Cursor = f.TextInput.Cursor.Background(modalBg)
		// FocusedButton/BlurredButton/Next keep their own backgrounds — those
		// signal focus on Confirm fields (e.g. the quit-confirm dialog), and
		// flattening them onto modalBg would erase the focused/blurred contrast.
	}
	paint(&t.Focused)
	paint(&t.Blurred)

	t.Form.Base = t.Form.Base.Background(modalBg)
	t.Group.Base = t.Group.Base.Background(modalBg)
	t.Group.Title = t.Group.Title.Foreground(modalIndigo).Background(modalBg)
	t.Group.Description = t.Group.Description.Foreground(modalDimFg).Background(modalBg)
	t.FieldSeparator = t.FieldSeparator.Background(modalBg)

	t.Help.Ellipsis = t.Help.Ellipsis.Foreground(modalHelpFg).Background(modalBg)
	t.Help.ShortKey = t.Help.ShortKey.Foreground(modalHelpKey).Background(modalBg)
	t.Help.ShortDesc = t.Help.ShortDesc.Foreground(modalHelpFg).Background(modalBg)
	t.Help.ShortSeparator = t.Help.ShortSeparator.Foreground(modalHelpFg).Background(modalBg)
	t.Help.FullKey = t.Help.FullKey.Foreground(modalHelpKey).Background(modalBg)
	t.Help.FullDesc = t.Help.FullDesc.Foreground(modalHelpFg).Background(modalBg)
	t.Help.FullSeparator = t.Help.FullSeparator.Foreground(modalHelpFg).Background(modalBg)

	return t
}
