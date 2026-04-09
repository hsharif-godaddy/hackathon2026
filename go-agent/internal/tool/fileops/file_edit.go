package fileops

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// immutableMarker is checked on the first line of a file to prevent edits.
const immutableMarker = "TREAT AS IMMUTABLE"

// TextEditor implements Anthropic's str_replace_based_edit_tool pattern.
// TODO: Register as type "text_editor_20250728" once Anthropic SDK integration is in place.
type TextEditor struct {
	factory *supervisor.ClientFactory
}

// NewTextEditor creates a text editor tool that operates via the supervisor API.
func NewTextEditor(factory *supervisor.ClientFactory) *TextEditor {
	return &TextEditor{factory: factory}
}

func (*TextEditor) Name() string { return "str_replace_based_edit_tool" }
func (*TextEditor) Description() string {
	return "View, create, and edit files using str_replace, insert, create, or view commands"
}
func (*TextEditor) InputSchema() json.RawMessage {
	return json.RawMessage(`{
	"type": "object",
	"properties": {
		"command": {
			"type": "string",
			"enum": ["view", "str_replace", "create", "insert"],
			"description": "The edit command to execute"
		},
		"path": {"type": "string", "description": "Relative path to the file"},
		"view_range": {
			"type": "array",
			"items": {"type": "integer"},
			"minItems": 2,
			"maxItems": 2,
			"description": "Line range [start, end] for view (1-indexed, -1 for end of file)"
		},
		"old_str": {"type": "string", "description": "Text to find (for str_replace)"},
		"new_str": {"type": "string", "description": "Replacement text (for str_replace)"},
		"file_text": {"type": "string", "description": "File content (for create)"},
		"insert_line": {"type": "integer", "description": "Line number after which to insert (0 for beginning)"},
		"insert_text": {"type": "string", "description": "Text to insert"}
	},
	"required": ["command", "path"]
}`)
}

type textEditorInput struct {
	Command    string `json:"command"`
	Path       string `json:"path"`
	ViewRange  []int  `json:"view_range"`
	OldStr     string `json:"old_str"`
	NewStr     string `json:"new_str"`
	FileText   string `json:"file_text"`
	InsertLine int    `json:"insert_line"`
	InsertText string `json:"insert_text"`
}

func (te *TextEditor) Execute(
	ctx context.Context, input json.RawMessage, out tool.OutputStream,
) error {
	var in textEditorInput
	if err := json.Unmarshal(input, &in); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}

	scope, err := tool.ScopeFrom(ctx)
	if err != nil {
		return err
	}

	client, err := te.factory.Get(scope.SupervisorAddr)
	if err != nil {
		return fmt.Errorf("supervisor client: %w", err)
	}

	switch in.Command {
	case "view":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.view(ctx, client, in, out)
	case "str_replace":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.strReplace(ctx, client, in, out)
	case "create":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.create(ctx, client, in, out)
	case "insert":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.insert(ctx, client, in, out)
	default:
		return fmt.Errorf("unknown command: %s", in.Command)
	}
}

func (te *TextEditor) strReplace(
	ctx context.Context, client *supervisor.Client, in textEditorInput, out tool.OutputStream,
) error {
	resp, err := client.FSRead(ctx, supervisor.FSReadRequest{Path: in.Path, Encoding: "utf-8"})
	if err != nil {
		if errors.Is(err, supervisor.ErrNotFound) {
			return fmt.Errorf("file does not exist: %s", in.Path)
		}
		return fmt.Errorf("reading file: %w", err)
	}

	content := resp.Content
	if isImmutable(content) {
		return fmt.Errorf("file is immutable: %s", in.Path)
	}

	count := strings.Count(content, in.OldStr)
	if count == 0 {
		return fmt.Errorf("old_str not found in %s", in.Path)
	}
	if count > 1 {
		return fmt.Errorf(
			"old_str found multiple times (%d) in %s — provide more context to make the match unique",
			count, in.Path,
		)
	}

	// Preserve original file permissions.
	mode := 0
	statResp, statErr := client.FSStat(ctx, supervisor.FSStatRequest{Path: in.Path})
	if statErr == nil {
		mode = parseOctalPermissions(statResp.Permissions)
	}

	newContent := strings.Replace(content, in.OldStr, in.NewStr, 1)
	writeReq := supervisor.FSWriteRequest{Path: in.Path, Content: newContent, Encoding: "utf-8"}
	if mode != 0 {
		writeReq.Mode = mode
	}
	if _, err := client.FSWrite(ctx, writeReq); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	out.Write(fmt.Sprintf("Successfully replaced text in %s\n", in.Path))
	return nil
}

// create writes file_text to the given path, creating parent directories as needed.
// If the file already exists it is overwritten (this matches the Anthropic text editor
// behaviour where "create" is used for both new files and full-file replacements).
func (te *TextEditor) create(
	ctx context.Context, client *supervisor.Client, in textEditorInput, out tool.OutputStream,
) error {
	if isImmutable(in.FileText) {
		return fmt.Errorf("cannot create file marked as immutable: %s", in.Path)
	}

	// Preserve existing permissions on overwrite; default handled by supervisor (0644).
	mode := 0
	statResp, statErr := client.FSStat(ctx, supervisor.FSStatRequest{Path: in.Path})
	if statErr == nil {
		mode = parseOctalPermissions(statResp.Permissions)
	}

	writeReq := supervisor.FSWriteRequest{
		Path:     in.Path,
		Content:  in.FileText,
		Encoding: "utf-8",
		MkdirP:   true,
	}
	if mode != 0 {
		writeReq.Mode = mode
	}
	if _, err := client.FSWrite(ctx, writeReq); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	out.Write(fmt.Sprintf("Successfully created %s\n", in.Path))
	return nil
}

func (te *TextEditor) view(
	ctx context.Context, client *supervisor.Client, in textEditorInput, out tool.OutputStream,
) error {
	// Check if path is a directory.
	statResp, err := client.FSStat(ctx, supervisor.FSStatRequest{Path: in.Path})
	if err != nil {
		if errors.Is(err, supervisor.ErrNotFound) {
			return fmt.Errorf("file does not exist: %s", in.Path)
		}
		return fmt.Errorf("stat: %w", err)
	}
	if statResp.IsDir {
		return te.viewDirectory(ctx, client, in, out)
	}

	resp, err := client.FSRead(ctx, supervisor.FSReadRequest{Path: in.Path, Encoding: "utf-8"})
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	lines := splitLines(resp.Content)
	totalLines := len(lines)

	start := 1
	end := totalLines
	if len(in.ViewRange) == 2 {
		start = in.ViewRange[0]
		end = in.ViewRange[1]
		if start < 1 {
			start = 1
		}
		if end == -1 || end > totalLines {
			end = totalLines
		}
		if start > totalLines {
			return fmt.Errorf("start line %d exceeds file length (%d lines)", start, totalLines)
		}
		if end < start {
			return fmt.Errorf("view_range end (%d) must be >= start (%d)", end, start)
		}
	}

	var b strings.Builder
	for i := start; i <= end; i++ {
		fmt.Fprintf(&b, "%6d|%s\n", i, lines[i-1])
	}
	out.Write(b.String())
	return nil
}

func (te *TextEditor) viewDirectory(
	ctx context.Context, client *supervisor.Client, in textEditorInput, out tool.OutputStream,
) error {
	resp, err := client.FSReaddir(ctx, supervisor.FSReaddirRequest{Path: in.Path})
	if err != nil {
		return fmt.Errorf("reading directory: %w", err)
	}

	var b strings.Builder
	for _, e := range resp.Entries {
		name := e.Name
		if e.IsDir {
			name += "/"
		}
		fmt.Fprintf(&b, "%s\n", name)
	}
	out.Write(b.String())
	return nil
}

func (te *TextEditor) insert(
	ctx context.Context, client *supervisor.Client, in textEditorInput, out tool.OutputStream,
) error {
	resp, err := client.FSRead(ctx, supervisor.FSReadRequest{Path: in.Path, Encoding: "utf-8"})
	if err != nil {
		if errors.Is(err, supervisor.ErrNotFound) {
			return fmt.Errorf("file does not exist: %s", in.Path)
		}
		return fmt.Errorf("reading file: %w", err)
	}

	content := resp.Content
	if isImmutable(content) {
		return fmt.Errorf("file is immutable: %s", in.Path)
	}

	lines := strings.SplitAfter(content, "\n")
	// Remove trailing empty string from split if content ends with newline.
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}

	insertLine := min(max(in.InsertLine, 0), len(lines))

	insertText := in.InsertText
	if !strings.HasSuffix(insertText, "\n") {
		insertText += "\n"
	}

	// Preserve original file permissions.
	mode := 0
	statResp, statErr := client.FSStat(ctx, supervisor.FSStatRequest{Path: in.Path})
	if statErr == nil {
		mode = parseOctalPermissions(statResp.Permissions)
	}

	var b strings.Builder
	for i := range insertLine {
		b.WriteString(lines[i])
	}
	b.WriteString(insertText)
	for i := insertLine; i < len(lines); i++ {
		b.WriteString(lines[i])
	}

	writeReq := supervisor.FSWriteRequest{Path: in.Path, Content: b.String(), Encoding: "utf-8"}
	if mode != 0 {
		writeReq.Mode = mode
	}
	if _, err := client.FSWrite(ctx, writeReq); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	out.Write(fmt.Sprintf("Successfully inserted text at line %d in %s\n", insertLine, in.Path))
	return nil
}

// parseOctalPermissions parses an octal permissions string (e.g. "0755") into an int.
// Returns 0 on parse failure, which callers treat as "use default".
func parseOctalPermissions(perms string) int {
	v, err := strconv.ParseInt(perms, 8, 32)
	if err != nil {
		return 0
	}
	return int(v)
}

// isImmutable checks if the first line of content contains the immutable marker.
func isImmutable(content string) bool {
	scanner := bufio.NewScanner(strings.NewReader(content))
	if scanner.Scan() {
		return strings.Contains(scanner.Text(), immutableMarker)
	}
	return false
}
