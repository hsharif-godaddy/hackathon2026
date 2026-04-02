package renderer

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type directoryInput struct {
	Path string `json:"path"`
}

type DirectoryRenderer struct{}

func (d *DirectoryRenderer) RenderStart(toolName string, toolID string) string {
	return headerStyle.Render("▶ directoryListing") + "\n" +
		dimStyle.Render("  Listing directory...")
}

func (d *DirectoryRenderer) RenderInput(toolName string, input json.RawMessage) string {
	if len(input) == 0 {
		return headerStyle.Render("▶ directoryListing") + "\n" + dimStyle.Render("  Listing...")
	}
	var in directoryInput
	if warn := unmarshalInput(input, &in); warn != "" {
		return headerStyle.Render("▶ directoryListing") + "\n" + warn
	}

	var b strings.Builder
	b.WriteString(headerStyle.Render("▶ directoryListing"))
	b.WriteString("\n\n")
	b.WriteString(labelStyle.Render("  Path: "))
	b.WriteString(in.Path)
	b.WriteString("\n")
	b.WriteString(dimStyle.Render("  Listing..."))
	return b.String()
}

func (d *DirectoryRenderer) RenderResult(toolName string, input json.RawMessage, output string, errMsg string, duration time.Duration) string {
	var in directoryInput
	inputWarn := unmarshalInput(input, &in)

	var b strings.Builder

	if errMsg != "" {
		b.WriteString(errorStyle.Render("✗ directoryListing"))
	} else {
		b.WriteString(headerStyle.Render("✓ directoryListing"))
	}
	b.WriteString(dimStyle.Render(fmt.Sprintf("  (%s)", duration.Truncate(time.Millisecond))))
	b.WriteString("\n\n")

	if inputWarn != "" {
		b.WriteString(inputWarn)
		b.WriteString("\n\n")
	}

	b.WriteString(labelStyle.Render("  Path: "))
	b.WriteString(in.Path)
	b.WriteString("\n\n")

	if errMsg != "" {
		b.WriteString(errorStyle.Render("  " + errMsg))
	} else {
		lines := strings.Split(output, "\n")
		for _, line := range lines {
			b.WriteString("  " + line + "\n")
		}
	}
	return b.String()
}
