package renderer

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
)

var matchStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#f1fa8c")).Bold(true)

type grepInput struct {
	Query           string   `json:"query"`
	Paths           []string `json:"paths"`
	IncludePatterns []string `json:"includePatterns"`
	ExcludePatterns []string `json:"excludePatterns"`
	Regex           bool     `json:"regex"`
	CaseSensitive   bool     `json:"caseSensitive"`
}

// GrepRenderer renders grepSearch tool calls.
type GrepRenderer struct{}

func (g *GrepRenderer) RenderStart(toolName string, toolID string) string {
	return headerStyle.Render("▶ grepSearch") + "\n" +
		dimStyle.Render("  Searching...")
}

func (g *GrepRenderer) RenderInput(toolName string, input json.RawMessage) string {
	if len(input) == 0 {
		return headerStyle.Render("▶ grepSearch") + "\n" + dimStyle.Render("  Searching...")
	}
	var in grepInput
	if warn := unmarshalInput(input, &in); warn != "" {
		return headerStyle.Render("▶ grepSearch") + "\n" + warn
	}

	var b strings.Builder
	b.WriteString(headerStyle.Render("▶ grepSearch"))
	b.WriteString("\n\n")
	b.WriteString(labelStyle.Render("  Query: "))
	b.WriteString(matchStyle.Render(in.Query))
	if len(in.Paths) > 0 {
		b.WriteString("\n")
		b.WriteString(labelStyle.Render("  Paths: "))
		b.WriteString(strings.Join(in.Paths, ", "))
	}
	if len(in.IncludePatterns) > 0 {
		b.WriteString("\n")
		b.WriteString(labelStyle.Render("  Include: "))
		b.WriteString(strings.Join(in.IncludePatterns, ", "))
	}
	b.WriteString("\n")
	b.WriteString(dimStyle.Render("  Searching..."))
	return b.String()
}

func (g *GrepRenderer) RenderResult(toolName string, input json.RawMessage, output string, errMsg string, duration time.Duration) string {
	var in grepInput
	inputWarn := unmarshalInput(input, &in)

	var b strings.Builder

	if errMsg != "" {
		b.WriteString(errorStyle.Render("✗ grepSearch"))
	} else {
		b.WriteString(headerStyle.Render("✓ grepSearch"))
	}
	b.WriteString(dimStyle.Render(fmt.Sprintf("  (%s)", duration.Truncate(time.Millisecond))))
	b.WriteString("\n\n")

	if inputWarn != "" {
		b.WriteString(inputWarn)
		b.WriteString("\n\n")
	}

	if in.Query != "" {
		b.WriteString(labelStyle.Render("  Query: "))
		b.WriteString(matchStyle.Render(in.Query))
		b.WriteString("\n")
	}

	if errMsg != "" {
		b.WriteString(errorStyle.Render("\n  " + errMsg))
	} else {
		allLines := strings.Split(output, "\n")
		totalLines := len(allLines)
		maxLines := 80
		lines := allLines
		if len(lines) > maxLines {
			lines = lines[:maxLines]
		}
		b.WriteString("\n")
		for _, line := range lines {
			b.WriteString("  " + line + "\n")
		}
		if totalLines > maxLines {
			b.WriteString(dimStyle.Render(fmt.Sprintf("  ... (%d more lines)", totalLines-maxLines)))
		}
	}
	return b.String()
}
