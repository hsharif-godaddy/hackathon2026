package tui

import (
	"strings"
	"testing"

	catppuccin "github.com/catppuccin/go"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/release-manager/internal/pipeline"
)

func TestThemeForBackground(t *testing.T) {
	t.Run("dark uses Mocha", func(t *testing.T) {
		theme := themeForBackground(true)
		f := catppuccin.Mocha

		assertColor(t, "Success", theme.Success, f.Green().Hex)
		assertColor(t, "Running", theme.Running, f.Sapphire().Hex)
		assertColor(t, "Failed", theme.Failed, f.Red().Hex)
		assertColor(t, "Bright", theme.Bright, f.Text().Hex)
		assertColor(t, "Pending", theme.Pending, f.Overlay0().Hex)
		assertColor(t, "Muted", theme.Muted, f.Subtext0().Hex)
	})

	t.Run("light uses Latte with boosted neutrals", func(t *testing.T) {
		theme := themeForBackground(false)
		f := catppuccin.Latte

		assertColor(t, "Success", theme.Success, f.Green().Hex)
		assertColor(t, "Running", theme.Running, f.Sapphire().Hex)
		assertColor(t, "Failed", theme.Failed, f.Red().Hex)
		assertColor(t, "Bright", theme.Bright, f.Text().Hex)
		// Light theme uses darker neutrals for contrast.
		assertColor(t, "Pending", theme.Pending, f.Subtext0().Hex)
		assertColor(t, "Muted", theme.Muted, f.Subtext1().Hex)
	})
}

func TestThemeStateColor(t *testing.T) {
	t.Run("dark/Mocha", func(t *testing.T) {
		theme := themeForBackground(true)
		f := catppuccin.Mocha

		assertStateColors(t, theme, map[pipeline.StageState]string{
			pipeline.StateSuccess:        f.Green().Hex,
			pipeline.StateRunning:        f.Sapphire().Hex,
			pipeline.StateFailed:         f.Red().Hex,
			pipeline.StateSkipped:        f.Overlay1().Hex,
			pipeline.StateParsingOutputs: f.Yellow().Hex,
			pipeline.StatePending:        f.Overlay0().Hex,
		})
	})

	t.Run("light/Latte", func(t *testing.T) {
		theme := themeForBackground(false)
		f := catppuccin.Latte

		assertStateColors(t, theme, map[pipeline.StageState]string{
			pipeline.StateSuccess:        f.Green().Hex,
			pipeline.StateRunning:        f.Sapphire().Hex,
			pipeline.StateFailed:         f.Red().Hex,
			pipeline.StateSkipped:        f.Overlay2().Hex,
			pipeline.StateParsingOutputs: f.Yellow().Hex,
			pipeline.StatePending:        f.Subtext0().Hex,
		})
	})
}

func assertStateColors(t *testing.T, theme Theme, want map[pipeline.StageState]string) {
	t.Helper()
	for state, hex := range want {
		t.Run(state.String(), func(t *testing.T) {
			assertColor(t, "StateColor", theme.StateColor(state), hex)
		})
	}
}

func assertColor(t *testing.T, name string, got interface{ RGBA() (uint32, uint32, uint32, uint32) }, wantHex string) {
	t.Helper()

	// Sanity check: catppuccin hex strings must have # prefix and be 7 chars.
	if !strings.HasPrefix(wantHex, "#") || len(wantHex) != 7 {
		t.Fatalf("%s: invalid hex %q (expected #RRGGBB format)", name, wantHex)
	}

	want := lipgloss.Color(wantHex)
	gr, gg, gb, _ := got.RGBA()
	wr, wg, wb, _ := want.RGBA()
	if gr != wr || gg != wg || gb != wb {
		t.Errorf("%s: got RGBA(%d,%d,%d), want RGBA(%d,%d,%d) for %s", name, gr, gg, gb, wr, wg, wb, wantHex)
	}
}
