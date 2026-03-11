package grep

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

const defaultMaxResults = 50

// binaryExtensions are file extensions skipped during search.
var binaryExtensions = map[string]bool{
	".zip": true, ".tar": true, ".gz": true, ".rar": true, ".7z": true,
	".bin": true, ".exe": true, ".dll": true, ".so": true, ".dylib": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".ico": true,
	".pdf": true, ".woff": true, ".woff2": true, ".ttf": true, ".eot": true,
	".db": true, ".sqlite": true, ".sqlite3": true,
}

// Search implements the grepSearch tool — searches file contents.
type Search struct{}

// NewSearch creates a grepSearch tool. The app root is resolved per-request from context.
func NewSearch() *Search {
	return &Search{}
}

func (*Search) Name() string        { return "grepSearch" }
func (*Search) Description() string { return "Search file contents with literal or regex patterns" }
func (*Search) InputSchema() json.RawMessage {
	return json.RawMessage(`{
	"type": "object",
	"properties": {
		"query": {"type": "string", "description": "Search term or regex pattern"},
		"paths": {"type": "array", "items": {"type": "string"}, "description": "Paths to search within"},
		"regex": {"type": "boolean", "default": false, "description": "Treat query as regex"},
		"caseSensitive": {"type": "boolean", "default": false, "description": "Case-sensitive search"},
		"contextLines": {"type": "integer", "minimum": 0, "default": 0, "description": "Lines of context around matches"},
		"maxResults": {"type": "integer", "minimum": 1, "default": 50, "description": "Maximum number of matches"},
		"includePatterns": {"type": "array", "items": {"type": "string"}, "description": "Glob patterns to include"},
		"excludePatterns": {"type": "array", "items": {"type": "string"}, "description": "Glob patterns to exclude"}
	},
	"required": ["query"]
}`)
}

type grepInput struct {
	Query           string   `json:"query"`
	Paths           []string `json:"paths"`
	Regex           bool     `json:"regex"`
	CaseSensitive   bool     `json:"caseSensitive"`
	ContextLines    int      `json:"contextLines"`
	MaxResults      int      `json:"maxResults"`
	IncludePatterns []string `json:"includePatterns"`
	ExcludePatterns []string `json:"excludePatterns"`
}

type match struct {
	file          string
	lineNum       int
	lineText      string
	contextBefore []string
	contextAfter  []string
}

func (g *Search) Execute(ctx context.Context, input json.RawMessage, out tool.OutputStream) error {
	var in grepInput
	if err := json.Unmarshal(input, &in); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}
	if in.Query == "" {
		return errors.New("query is required")
	}
	if in.MaxResults <= 0 {
		in.MaxResults = defaultMaxResults
	}

	scope, err := tool.ScopeFrom(ctx)
	if err != nil {
		return err
	}
	appRoot := scope.AppRoot

	matcher, err := buildMatcher(in.Query, in.Regex, in.CaseSensitive)
	if err != nil {
		return fmt.Errorf("invalid query: %w", err)
	}

	searchRoots := []string{appRoot}
	if len(in.Paths) > 0 {
		searchRoots = make([]string, 0, len(in.Paths))
		for _, p := range in.Paths {
			abs, pathErr := tool.ValidatePath(appRoot, p)
			if pathErr != nil {
				return pathErr
			}
			searchRoots = append(searchRoots, abs)
		}
	}

	var matches []match
	for _, root := range searchRoots {
		if len(matches) >= in.MaxResults {
			break
		}
		g.searchDir(root, appRoot, in, matcher, &matches)
	}

	if len(matches) == 0 {
		out.Write("No matches found\n")
		return nil
	}

	out.Write(formatMatches(matches))
	return nil
}

func (g *Search) searchDir(dir, appRoot string, opts grepInput, matcher func(string) bool, matches *[]match) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	// Sort for deterministic output
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, e := range entries {
		if len(*matches) >= opts.MaxResults {
			return
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") && name != "." {
			continue
		}

		fullPath := filepath.Join(dir, name)

		if e.IsDir() {
			if tool.IgnoredDirs[name] {
				continue
			}
			g.searchDir(fullPath, appRoot, opts, matcher, matches)
			continue
		}

		if !matchesFileFilters(name, opts.IncludePatterns, opts.ExcludePatterns) {
			continue
		}
		if binaryExtensions[filepath.Ext(name)] {
			continue
		}

		g.searchFile(fullPath, appRoot, opts, matcher, matches)
	}
}

// binarySniffSize is the number of bytes checked for null bytes to detect binary files.
const binarySniffSize = 512

func (g *Search) searchFile(
	path, appRoot string, opts grepInput, matcher func(string) bool, matches *[]match,
) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}

	// Skip binary files that aren't caught by the extension check.
	sniff := data
	if len(sniff) > binarySniffSize {
		sniff = sniff[:binarySniffSize]
	}
	if bytes.ContainsRune(sniff, 0) {
		return
	}

	lines := strings.Split(string(data), "\n")
	relPath, _ := filepath.Rel(appRoot, path)

	for i, line := range lines {
		if len(*matches) >= opts.MaxResults {
			return
		}
		if !matcher(line) {
			continue
		}

		m := match{
			file:     relPath,
			lineNum:  i + 1,
			lineText: line,
		}

		if opts.ContextLines > 0 {
			start := max(i-opts.ContextLines, 0)
			end := i + opts.ContextLines
			if end >= len(lines) {
				end = len(lines) - 1
			}
			for j := start; j < i; j++ {
				m.contextBefore = append(m.contextBefore, lines[j])
			}
			for j := i + 1; j <= end; j++ {
				m.contextAfter = append(m.contextAfter, lines[j])
			}
		}

		*matches = append(*matches, m)
	}
}

func buildMatcher(query string, isRegex, caseSensitive bool) (func(string) bool, error) {
	if isRegex {
		pattern := query
		if !caseSensitive {
			pattern = "(?i)" + pattern
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, err
		}
		return re.MatchString, nil
	}

	if caseSensitive {
		return func(line string) bool {
			return strings.Contains(line, query)
		}, nil
	}

	lowerQuery := strings.ToLower(query)
	return func(line string) bool {
		return strings.Contains(strings.ToLower(line), lowerQuery)
	}, nil
}

func matchesFileFilters(name string, include, exclude []string) bool {
	if len(include) > 0 {
		matched := false
		for _, pattern := range include {
			if ok, _ := filepath.Match(pattern, name); ok {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	for _, pattern := range exclude {
		if ok, _ := filepath.Match(pattern, name); ok {
			return false
		}
	}
	return true
}

func formatMatches(matches []match) string {
	// Group by file
	type fileGroup struct {
		file    string
		matches []match
	}

	seen := map[string]int{}
	var groups []fileGroup

	for _, m := range matches {
		idx, ok := seen[m.file]
		if !ok {
			idx = len(groups)
			seen[m.file] = idx
			groups = append(groups, fileGroup{file: m.file})
		}
		groups[idx].matches = append(groups[idx].matches, m)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Found %d matches across %d files\n\n", len(matches), len(groups))

	for _, g := range groups {
		fmt.Fprintf(&b, "%s:\n", g.file)
		for _, m := range g.matches {
			for j, ctxLine := range m.contextBefore {
				lineNum := m.lineNum - len(m.contextBefore) + j
				fmt.Fprintf(&b, "  %d  %s\n", lineNum, ctxLine)
			}
			fmt.Fprintf(&b, "  %d: %s\n", m.lineNum, m.lineText)
			for j, ctxLine := range m.contextAfter {
				lineNum := m.lineNum + 1 + j
				fmt.Fprintf(&b, "  %d  %s\n", lineNum, ctxLine)
			}
		}
		b.WriteString("\n")
	}

	return b.String()
}
