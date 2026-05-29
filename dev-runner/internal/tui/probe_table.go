package tui

import (
	"fmt"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/probe"
)

// buildBaselinesContent formats baseline entries as a table.
func buildBaselinesContent(entries []probe.BaselineEntry) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  %d baseline(s)\n\n", len(entries))

	if len(entries) == 0 {
		b.WriteString("  (no baselines saved)\n")
		return b.String()
	}

	headers := []string{"Scenario", "Run ID", "Created"}
	var rows [][]string

	for _, e := range entries {
		createdAt := e.CreatedAt.Format("2006-01-02 15:04")
		if e.CreatedAt.IsZero() {
			createdAt = "—"
		}
		rows = append(rows, []string{
			e.ScenarioName,
			truncate(e.RunID, 36),
			createdAt,
		})
	}

	b.WriteString(renderTable(headers, rows))
	return b.String()
}

// renderTable renders a plain-text table with aligned columns.
// Each row must have the same length as headers.
func renderTable(headers []string, rows [][]string) string {
	if len(headers) == 0 {
		return ""
	}

	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(h)
	}
	for _, row := range rows {
		for i, cell := range row {
			if i < len(widths) && len(cell) > widths[i] {
				widths[i] = len(cell)
			}
		}
	}

	var b strings.Builder
	// Header row with 2-space left indent.
	b.WriteString("  ")
	for i, h := range headers {
		if i > 0 {
			b.WriteString("  ")
		}
		b.WriteString(padRight(h, widths[i]))
	}
	b.WriteString("\n")

	// Separator.
	b.WriteString("  ")
	for i, w := range widths {
		if i > 0 {
			b.WriteString("  ")
		}
		b.WriteString(strings.Repeat("─", w))
	}
	b.WriteString("\n")

	// Data rows.
	for _, row := range rows {
		b.WriteString("  ")
		for i := range headers {
			if i > 0 {
				b.WriteString("  ")
			}
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			b.WriteString(padRight(cell, widths[i]))
		}
		b.WriteString("\n")
	}

	return b.String()
}

// padRight pads s with spaces to at least width characters.
func padRight(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}

// truncate shortens s to at most maxLen characters, appending "…" if cut.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 1 {
		return "…"
	}
	return s[:maxLen-1] + "…"
}
