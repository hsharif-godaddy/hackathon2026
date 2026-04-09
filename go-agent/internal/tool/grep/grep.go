package grep

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

const defaultMaxResults = 50

// Search implements the grepSearch tool — searches file contents via the supervisor API.
type Search struct {
	factory *supervisor.ClientFactory
}

// NewSearch creates a grepSearch tool that searches via the supervisor API.
func NewSearch(factory *supervisor.ClientFactory) *Search {
	return &Search{factory: factory}
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

	// Validate user-supplied paths against agent-side blocked list.
	for _, p := range in.Paths {
		if blockErr := tool.CheckBlocked(p); blockErr != nil {
			return blockErr
		}
	}

	client, err := g.factory.Get(scope.SupervisorAddr)
	if err != nil {
		return fmt.Errorf("supervisor client: %w", err)
	}

	// Build blocked-extension exclude patterns for the agent's additional layer.
	agentExcludes := make([]string, 0, len(tool.BlockedExtensions)+len(in.ExcludePatterns))
	for ext := range tool.BlockedExtensions {
		agentExcludes = append(agentExcludes, "*"+ext)
	}
	agentExcludes = append(agentExcludes, in.ExcludePatterns...)

	resp, err := client.FSGrep(ctx, supervisor.FSGrepRequest{
		Query:           in.Query,
		Paths:           in.Paths,
		Regex:           in.Regex,
		CaseSensitive:   in.CaseSensitive,
		ContextLines:    in.ContextLines,
		MaxResults:      in.MaxResults,
		IncludePatterns: in.IncludePatterns,
		ExcludePatterns: agentExcludes,
	})
	if err != nil {
		return fmt.Errorf("grep search: %w", err)
	}

	if len(resp.Matches) == 0 {
		out.Write("No matches found\n")
		return nil
	}

	out.Write(formatMatches(resp.Matches, resp.TotalFiles))
	return nil
}

func formatMatches(matches []supervisor.FSGrepMatch, totalFiles int) string {
	// Group by file
	type fileGroup struct {
		file    string
		matches []supervisor.FSGrepMatch
	}

	seen := map[string]int{}
	var groups []fileGroup

	for _, m := range matches {
		idx, ok := seen[m.File]
		if !ok {
			idx = len(groups)
			seen[m.File] = idx
			groups = append(groups, fileGroup{file: m.File})
		}
		groups[idx].matches = append(groups[idx].matches, m)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Found %d matches across %d files\n\n",
		len(matches), max(len(groups), totalFiles))

	for _, g := range groups {
		fmt.Fprintf(&b, "%s:\n", g.file)
		for _, m := range g.matches {
			for j, ctxLine := range m.ContextBefore {
				lineNum := m.LineNum - len(m.ContextBefore) + j
				fmt.Fprintf(&b, "  %d  %s\n", lineNum, ctxLine)
			}
			fmt.Fprintf(&b, "  %d: %s\n", m.LineNum, m.LineText)
			for j, ctxLine := range m.ContextAfter {
				lineNum := m.LineNum + 1 + j
				fmt.Fprintf(&b, "  %d  %s\n", lineNum, ctxLine)
			}
		}
		b.WriteString("\n")
	}

	return b.String()
}
