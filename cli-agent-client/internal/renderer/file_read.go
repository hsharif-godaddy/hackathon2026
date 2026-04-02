package renderer

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type fileReadInput struct {
	Path      string `json:"path"`
	StartLine int    `json:"startLine"`
	NumLines  int    `json:"numLines"`
}

// FileReadRenderer renders readFile tool calls.
type FileReadRenderer struct{}

func (f *FileReadRenderer) RenderStart(toolName string, toolID string) string {
	return headerStyle.Render("▶ readFile") + "\n" +
		dimStyle.Render("  Reading file...")
}

func (f *FileReadRenderer) RenderInput(toolName string, input json.RawMessage) string {
	if len(input) == 0 {
		return headerStyle.Render("▶ readFile") + "\n" + dimStyle.Render("  Reading...")
	}
	var in fileReadInput
	if warn := unmarshalInput(input, &in); warn != "" {
		return headerStyle.Render("▶ readFile") + "\n" + warn
	}

	var b strings.Builder
	b.WriteString(headerStyle.Render("▶ readFile"))
	b.WriteString("\n\n")
	b.WriteString(labelStyle.Render("  Path: "))
	b.WriteString(in.Path)
	if in.StartLine > 0 || in.NumLines > 0 {
		b.WriteString("\n")
		b.WriteString(labelStyle.Render("  Lines: "))
		if in.NumLines > 0 {
			fmt.Fprintf(&b, "%d-%d", in.StartLine, in.StartLine+in.NumLines-1)
		} else {
			fmt.Fprintf(&b, "%d+", in.StartLine)
		}
	}
	b.WriteString("\n")
	b.WriteString(dimStyle.Render("  Reading..."))
	return b.String()
}

func (f *FileReadRenderer) RenderResult(toolName string, input json.RawMessage, output string, errMsg string, duration time.Duration) string {
	var in fileReadInput
	inputWarn := unmarshalInput(input, &in)

	var b strings.Builder

	if errMsg != "" {
		b.WriteString(errorStyle.Render("✗ readFile"))
	} else {
		b.WriteString(headerStyle.Render("✓ readFile"))
	}
	b.WriteString(dimStyle.Render(fmt.Sprintf("  (%s)", duration.Truncate(time.Millisecond))))
	b.WriteString("\n\n")

	if inputWarn != "" {
		b.WriteString(inputWarn)
		b.WriteString("\n\n")
	}

	if in.Path != "" {
		b.WriteString(labelStyle.Render("  Path: "))
		b.WriteString(in.Path)
		b.WriteString("\n")
	}

	if errMsg != "" {
		b.WriteString(errorStyle.Render("\n  " + errMsg))
	} else {
		lines := strings.Split(output, "\n")
		startLine := 1
		if in.StartLine > 0 {
			startLine = in.StartLine
		}
		maxLines := 50
		if len(lines) > maxLines {
			lines = lines[:maxLines]
		}
		b.WriteString("\n")
		for i, line := range lines {
			lineNum := fmt.Sprintf("  %4d │ ", startLine+i)
			b.WriteString(dimStyle.Render(lineNum))
			b.WriteString(line)
			b.WriteString("\n")
		}
	}
	return b.String()
}
