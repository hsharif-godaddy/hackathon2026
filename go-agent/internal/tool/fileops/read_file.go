package fileops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// ReadFile implements the readFile tool — reads a file with line-numbered output.
type ReadFile struct {
	factory *supervisor.ClientFactory
}

// NewReadFile creates a readFile tool that reads files via the supervisor API.
func NewReadFile(factory *supervisor.ClientFactory) *ReadFile {
	return &ReadFile{factory: factory}
}

func (*ReadFile) Name() string        { return "readFile" }
func (*ReadFile) Description() string { return "Read a file with line-numbered output" }
func (*ReadFile) InputSchema() json.RawMessage {
	return json.RawMessage(`{
	"type": "object",
	"properties": {
		"path": {"type": "string", "description": "Relative path to the file"},
		"startLine": {"type": "integer", "minimum": 1, "description": "Starting line number (1-indexed)"},
		"numLines": {"type": "integer", "minimum": 1, "description": "Number of lines to read"}
	},
	"required": ["path"]
}`)
}

type readFileInput struct {
	Path      string `json:"path"`
	StartLine int    `json:"startLine"`
	NumLines  int    `json:"numLines"`
}

func (rf *ReadFile) Execute(ctx context.Context, input json.RawMessage, out tool.OutputStream) error {
	var in readFileInput
	if err := json.Unmarshal(input, &in); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}

	scope, err := tool.ScopeFrom(ctx)
	if err != nil {
		return err
	}

	if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
		return blockErr
	}

	client, err := rf.factory.Get(scope.SupervisorAddr)
	if err != nil {
		return fmt.Errorf("supervisor client: %w", err)
	}

	resp, err := client.FSRead(ctx, supervisor.FSReadRequest{
		Path:     in.Path,
		Encoding: "utf-8",
	})
	if err != nil {
		if errors.Is(err, supervisor.ErrNotFound) {
			return fmt.Errorf("file does not exist: %s", in.Path)
		}
		return fmt.Errorf("reading file: %w", err)
	}

	fileSize := resp.TotalSize

	lines := splitLines(resp.Content)
	totalLines := len(lines)

	start := 1
	end := totalLines
	if in.StartLine > 0 {
		start = in.StartLine
	}
	if start > totalLines && totalLines > 0 {
		return fmt.Errorf(
			"start line %d exceeds file length (%d lines)",
			start, totalLines,
		)
	}
	if in.NumLines > 0 {
		end = min(start+in.NumLines-1, totalLines)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "File: %s\n", in.Path)
	if in.StartLine > 0 || in.NumLines > 0 {
		fmt.Fprintf(&b, "Lines %d-%d of %d\n", start, end, totalLines)
	} else {
		fmt.Fprintf(&b, "Total lines: %d\n", totalLines)
	}
	fmt.Fprintf(&b, "File size: %d bytes\n", fileSize)
	b.WriteString("\nContent (with line numbers):\n")

	for i := start; i <= end; i++ {
		fmt.Fprintf(&b, "%6d|%s\n", i, lines[i-1])
	}

	out.Write(b.String())
	return nil
}

// splitLines splits text into lines, handling the trailing newline correctly.
func splitLines(text string) []string {
	if text == "" {
		return nil
	}
	text = strings.TrimRight(text, "\n")
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}
