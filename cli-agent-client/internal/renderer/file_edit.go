package renderer

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
)

var (
	diffOldStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#ff5555"))
	diffNewStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#50fa7b"))
)

type fileEditInput struct {
	Command string `json:"command"`
	Path    string `json:"path"`
	OldStr  string `json:"old_str"`
	NewStr  string `json:"new_str"`
}

type FileEditRenderer struct{}

func (f *FileEditRenderer) RenderStart(toolName string, toolID string) string {
	return headerStyle.Render("▶ edit") + "\n" +
		dimStyle.Render("  Editing file...")
}

func (f *FileEditRenderer) RenderInput(toolName string, input json.RawMessage) string {
	if len(input) == 0 {
		return headerStyle.Render("▶ edit") + "\n" + dimStyle.Render("  Editing...")
	}
	var in fileEditInput
	if warn := unmarshalInput(input, &in); warn != "" {
		return headerStyle.Render("▶ edit") + "\n" + warn
	}

	var b strings.Builder
	b.WriteString(headerStyle.Render("▶ edit"))
	b.WriteString("\n\n")
	b.WriteString(labelStyle.Render("  Path: "))
	b.WriteString(in.Path)
	b.WriteString("\n")
	b.WriteString(labelStyle.Render("  Command: "))
	b.WriteString(in.Command)

	if in.Command == "str_replace" && in.OldStr != "" {
		b.WriteString("\n\n")
		b.WriteString(renderDiff(in.OldStr, in.NewStr))
	}
	return b.String()
}

func (f *FileEditRenderer) RenderResult(toolName string, input json.RawMessage, output string, errMsg string, duration time.Duration) string {
	var in fileEditInput
	inputWarn := unmarshalInput(input, &in)

	var b strings.Builder

	if errMsg != "" {
		b.WriteString(errorStyle.Render("✗ edit"))
	} else {
		b.WriteString(headerStyle.Render("✓ edit"))
	}
	b.WriteString(dimStyle.Render(fmt.Sprintf("  (%s)", duration.Truncate(time.Millisecond))))
	b.WriteString("\n\n")

	if inputWarn != "" {
		b.WriteString(inputWarn)
		b.WriteString("\n\n")
	}

	b.WriteString(labelStyle.Render("  Path: "))
	b.WriteString(in.Path)
	b.WriteString("\n")

	if errMsg != "" {
		b.WriteString(errorStyle.Render("\n  " + errMsg))
	} else if in.Command == "str_replace" && in.OldStr != "" {
		b.WriteString("\n")
		b.WriteString(renderDiff(in.OldStr, in.NewStr))
	} else {
		b.WriteString("\n")
		b.WriteString(dimStyle.Render("  " + output))
	}
	return b.String()
}

func renderDiff(oldStr, newStr string) string {
	var b strings.Builder
	for _, line := range strings.Split(oldStr, "\n") {
		b.WriteString(diffOldStyle.Render("  - " + line))
		b.WriteString("\n")
	}
	for _, line := range strings.Split(newStr, "\n") {
		b.WriteString(diffNewStyle.Render("  + " + line))
		b.WriteString("\n")
	}
	return b.String()
}
