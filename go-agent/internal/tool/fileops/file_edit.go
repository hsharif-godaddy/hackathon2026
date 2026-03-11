package fileops

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// immutableMarker is checked on the first line of a file to prevent edits.
const immutableMarker = "TREAT AS IMMUTABLE"

// TextEditor implements Anthropic's str_replace_based_edit_tool pattern.
// TODO: Register as type "text_editor_20250728" once Anthropic SDK integration is in place.
type TextEditor struct{}

// NewTextEditor creates a text editor tool. The app root is resolved per-request from context.
func NewTextEditor() *TextEditor {
	return &TextEditor{}
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

	absPath, err := tool.ValidatePath(scope.AppRoot, in.Path)
	if err != nil {
		return err
	}

	switch in.Command {
	case "view":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.view(absPath, in, out)
	case "str_replace":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.strReplace(absPath, in, out)
	case "create":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.create(absPath, in, out)
	case "insert":
		if blockErr := tool.CheckBlocked(in.Path); blockErr != nil {
			return blockErr
		}
		return te.insert(absPath, in, out)
	default:
		return fmt.Errorf("unknown command: %s", in.Command)
	}
}

func (te *TextEditor) strReplace(absPath string, in textEditorInput, out tool.OutputStream) error {
	data, err := os.ReadFile(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file does not exist: %s", in.Path)
		}
		return fmt.Errorf("reading file: %w", err)
	}

	content := string(data)
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
	info, err := os.Stat(absPath)
	mode := os.FileMode(0o644)
	if err == nil {
		mode = info.Mode()
	}

	newContent := strings.Replace(content, in.OldStr, in.NewStr, 1)
	if err := os.WriteFile(absPath, []byte(newContent), mode); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	out.Write(fmt.Sprintf("Successfully replaced text in %s\n", in.Path))
	return nil
}

// create writes file_text to the given path, creating parent directories as needed.
// If the file already exists it is overwritten (this matches the Anthropic text editor
// behaviour where "create" is used for both new files and full-file replacements).
func (te *TextEditor) create(absPath string, in textEditorInput, out tool.OutputStream) error {
	if isImmutable(in.FileText) {
		return fmt.Errorf("cannot create file marked as immutable: %s", in.Path)
	}

	// Preserve existing permissions on overwrite; default to 0o644 for new files.
	mode := os.FileMode(0o644)
	if info, statErr := os.Stat(absPath); statErr == nil {
		mode = info.Mode()
	}

	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("creating directories: %w", err)
	}

	if err := os.WriteFile(absPath, []byte(in.FileText), mode); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	out.Write(fmt.Sprintf("Successfully created %s\n", in.Path))
	return nil
}

func (te *TextEditor) view(absPath string, in textEditorInput, out tool.OutputStream) error {
	// Check if path is a directory.
	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file does not exist: %s", in.Path)
		}
		return fmt.Errorf("stat: %w", err)
	}
	if info.IsDir() {
		return te.viewDirectory(absPath, in, out)
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	lines := splitLines(string(data))
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
	absPath string, _ textEditorInput, out tool.OutputStream,
) error {
	entries, err := os.ReadDir(absPath)
	if err != nil {
		return fmt.Errorf("reading directory: %w", err)
	}

	var b strings.Builder
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			name += "/"
		}
		fmt.Fprintf(&b, "%s\n", name)
	}
	out.Write(b.String())
	return nil
}

func (te *TextEditor) insert(absPath string, in textEditorInput, out tool.OutputStream) error {
	data, err := os.ReadFile(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file does not exist: %s", in.Path)
		}
		return fmt.Errorf("reading file: %w", err)
	}

	content := string(data)
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
	info, statErr := os.Stat(absPath)
	mode := os.FileMode(0o644)
	if statErr == nil {
		mode = info.Mode()
	}

	var b strings.Builder
	for i := range insertLine {
		b.WriteString(lines[i])
	}
	b.WriteString(insertText)
	for i := insertLine; i < len(lines); i++ {
		b.WriteString(lines[i])
	}

	if err := os.WriteFile(absPath, []byte(b.String()), mode); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	out.Write(fmt.Sprintf("Successfully inserted text at line %d in %s\n", insertLine, in.Path))
	return nil
}

// isImmutable checks if the first line of content contains the immutable marker.
func isImmutable(content string) bool {
	scanner := bufio.NewScanner(strings.NewReader(content))
	if scanner.Scan() {
		return strings.Contains(scanner.Text(), immutableMarker)
	}
	return false
}
