package renderer

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
)

var (
	headerStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#00ff00"))
	labelStyle  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("250"))
	dimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("243"))
	errorStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#ff0000")).Bold(true)
)

type DefaultRenderer struct{}

func (d *DefaultRenderer) RenderStart(toolName string, toolID string) string {
	return headerStyle.Render("▶ "+toolName) + "\n" +
		dimStyle.Render("  ID: "+toolID) + "\n" +
		dimStyle.Render("  Running...")
}

func (d *DefaultRenderer) RenderInput(toolName string, input json.RawMessage) string {
	var b strings.Builder
	b.WriteString(headerStyle.Render("▶ " + toolName))
	b.WriteString("\n\n")
	b.WriteString(labelStyle.Render("Input:"))
	b.WriteString("\n")
	b.WriteString(prettyJSON(input))
	return b.String()
}

func (d *DefaultRenderer) RenderResult(toolName string, input json.RawMessage, output string, errMsg string, duration time.Duration) string {
	var b strings.Builder

	status := "✓"
	titleStyle := headerStyle
	if errMsg != "" {
		status = "✗"
		titleStyle = errorStyle
	}
	b.WriteString(titleStyle.Render(fmt.Sprintf("%s %s", status, toolName)))
	b.WriteString(dimStyle.Render(fmt.Sprintf("  (%s)", duration.Truncate(time.Millisecond))))
	b.WriteString("\n\n")

	b.WriteString(labelStyle.Render("Input:"))
	b.WriteString("\n")
	b.WriteString(prettyJSON(input))
	b.WriteString("\n\n")

	if errMsg != "" {
		b.WriteString(errorStyle.Render("Error:"))
		b.WriteString("\n")
		b.WriteString(errorStyle.Render(errMsg))
	} else {
		b.WriteString(labelStyle.Render("Output:"))
		b.WriteString("\n")
		// Try to pretty-print if it looks like JSON
		if len(output) > 0 && (output[0] == '{' || output[0] == '[') {
			var raw json.RawMessage
			if json.Unmarshal([]byte(output), &raw) == nil {
				b.WriteString(prettyJSON(raw))
			} else {
				b.WriteString(output)
			}
		} else {
			b.WriteString(output)
		}
	}
	return b.String()
}

// unmarshalInput is a helper that unmarshals input and returns a warning string on error.
func unmarshalInput(input json.RawMessage, dest any) string {
	if len(input) == 0 {
		return ""
	}
	if err := json.Unmarshal(input, dest); err != nil {
		return dimStyle.Render("  (malformed input: " + err.Error() + ")")
	}
	return ""
}

func prettyJSON(data json.RawMessage) string {
	if len(data) == 0 {
		return dimStyle.Render("(empty)")
	}
	indented, err := json.MarshalIndent(json.RawMessage(data), "  ", "  ")
	if err != nil {
		return string(data)
	}
	return "  " + string(indented)
}
