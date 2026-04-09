package fileops

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

const maxEntries = 1000

// DirectoryListing implements the directoryListing tool.
type DirectoryListing struct {
	factory *supervisor.ClientFactory
}

// NewDirectoryListing creates a directoryListing tool that lists directories
// via the supervisor API. The app root is resolved per-request from context.
func NewDirectoryListing(factory *supervisor.ClientFactory) *DirectoryListing {
	return &DirectoryListing{factory: factory}
}

func (*DirectoryListing) Name() string        { return "directoryListing" }
func (*DirectoryListing) Description() string { return "List directory contents as a tree" }
func (*DirectoryListing) InputSchema() json.RawMessage {
	return json.RawMessage(`{
	"type": "object",
	"properties": {
		"path": {"type": "string", "default": "", "description": "Relative path within app"},
		"directoriesOnly": {"type": "boolean", "default": false, "description": "Show only directories"},
		"pattern": {"type": "string", "description": "Wildcard pattern (supports * and ?)"},
		"search": {"type": "string", "description": "Search for entries containing this text (case-insensitive)"},
		"maxDepth": {"type": "integer", "minimum": 0, "description": "Maximum traversal depth"},
		"showHidden": {"type": "boolean", "default": false, "description": "Show hidden files/directories"}
	}
}`)
}

type dirListingInput struct {
	Path            string `json:"path"`
	DirectoriesOnly bool   `json:"directoriesOnly"`
	Pattern         string `json:"pattern"`
	Search          string `json:"search"`
	MaxDepth        int    `json:"maxDepth"`
	ShowHidden      bool   `json:"showHidden"`
}

type entry struct {
	name     string
	isDir    bool
	size     int64
	children []*entry
}

func (dl *DirectoryListing) Execute(
	ctx context.Context, input json.RawMessage, out tool.OutputStream,
) error {
	var in dirListingInput
	if err := json.Unmarshal(input, &in); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}

	scope, err := tool.ScopeFrom(ctx)
	if err != nil {
		return err
	}

	client, err := dl.factory.Get(scope.SupervisorAddr)
	if err != nil {
		return fmt.Errorf("supervisor client: %w", err)
	}

	reqPath := in.Path
	if reqPath == "" {
		reqPath = "."
	}

	// Build ignore patterns from the shared ignored-directory list.
	ignorePatterns := make([]string, 0, len(tool.IgnoredDirs))
	for name := range tool.IgnoredDirs {
		ignorePatterns = append(ignorePatterns, name)
	}

	resp, err := client.FSReaddir(ctx, supervisor.FSReaddirRequest{
		Path:           reqPath,
		Recursive:      true,
		MaxDepth:       in.MaxDepth,
		MaxEntries:     maxEntries,
		IgnorePatterns: ignorePatterns,
		IncludeHidden:  in.ShowHidden,
	})
	if err != nil {
		return fmt.Errorf("reading directory: %w", err)
	}

	root := buildTree(resp.Entries, in)

	var b strings.Builder
	dirCount, fileCount := countEntries(root)
	displayName := "."
	if in.Path != "" {
		displayName = in.Path
	}
	fmt.Fprintf(
		&b, "%s (%d dirs, %d files)\n",
		displayName, dirCount, fileCount,
	)
	if resp.Truncated {
		fmt.Fprintf(&b, "truncated (%d+ items)\n", maxEntries)
	}
	b.WriteString("\n")

	renderTree(&b, root, "", true)

	out.Write(b.String())
	return nil
}

// buildTree constructs a tree from the flat list of directory entries returned
// by the supervisor's recursive readdir. Each entry has a relative path name
// (e.g. "src/", "src/main.go"). Filters (directoriesOnly, pattern, search) are
// applied in the agent.
func buildTree(entries []supervisor.FSDirEntry, opts dirListingInput) *entry {
	root := &entry{name: ".", isDir: true}

	// Index directories by path for parent lookup.
	dirMap := map[string]*entry{
		"": root,
	}

	// First pass: create all directory entries so parents exist.
	for _, e := range entries {
		if !e.IsDir {
			continue
		}
		name := strings.TrimSuffix(e.Name, "/")
		dirEntry := &entry{name: filepath.Base(name) + "/", isDir: true}
		dirMap[name] = dirEntry
	}

	// Second pass: add matching files first, tracking which directories
	// have matching content so we can include parent dirs.
	includedDirs := map[string]bool{}

	for _, e := range entries {
		if e.IsDir {
			continue
		}
		if opts.DirectoriesOnly {
			continue
		}
		name := e.Name
		base := filepath.Base(name)
		if !matchesFilters(base, false, opts) {
			continue
		}
		parentPath := filepath.Dir(name)
		if parentPath == "." {
			parentPath = ""
		}
		parent := ensureParent(dirMap, parentPath, root)
		parent.children = append(parent.children, &entry{
			name: base,
			size: e.Size,
		})
		// Mark all ancestor directories as included.
		for p := parentPath; p != ""; p = filepath.Dir(p) {
			if p == "." {
				break
			}
			includedDirs[p] = true
		}
	}

	// Track which entries have been added to avoid duplicates from ensureParent.
	added := map[*entry]struct{}{}

	// Third pass: add directories that either match filters or have matching children.
	for _, e := range entries {
		if !e.IsDir {
			continue
		}
		name := strings.TrimSuffix(e.Name, "/")
		base := filepath.Base(name)
		parentPath := filepath.Dir(name)
		if parentPath == "." {
			parentPath = ""
		}

		if !matchesFilters(base, true, opts) && !includedDirs[name] {
			continue
		}
		parent := ensureParent(dirMap, parentPath, root)
		child := dirMap[name]
		if _, dup := added[child]; !dup {
			added[child] = struct{}{}
			parent.children = append(parent.children, child)
		}
	}

	// Sort children: directories first, then files, alphabetically.
	sortTree(root)

	return root
}

// ensureParent returns the parent entry for the given parentPath, creating
// intermediate entries if they don't yet exist in the tree.
func ensureParent(dirMap map[string]*entry, parentPath string, root *entry) *entry {
	if parentPath == "" {
		return root
	}
	if p, ok := dirMap[parentPath]; ok {
		return p
	}
	// Create missing intermediate directory.
	base := filepath.Base(parentPath)
	p := &entry{name: base + "/", isDir: true}
	dirMap[parentPath] = p

	// Recursively ensure grandparent.
	grandparentPath := filepath.Dir(parentPath)
	if grandparentPath == "." {
		grandparentPath = ""
	}
	gp := ensureParent(dirMap, grandparentPath, root)
	gp.children = append(gp.children, p)
	return p
}

// sortTree recursively sorts children: directories first, then files, alphabetically.
func sortTree(e *entry) {
	sort.Slice(e.children, func(i, j int) bool {
		di, dj := e.children[i].isDir, e.children[j].isDir
		if di != dj {
			return di
		}
		return e.children[i].name < e.children[j].name
	})
	for _, child := range e.children {
		if child.isDir {
			sortTree(child)
		}
	}
}

func matchesFilters(name string, isDir bool, opts dirListingInput) bool {
	if opts.Pattern != "" && !isDir {
		matched, _ := filepath.Match(opts.Pattern, name)
		if !matched {
			return false
		}
	}
	if opts.Search != "" {
		if !strings.Contains(strings.ToLower(name), strings.ToLower(opts.Search)) {
			return false
		}
	}
	return true
}

func renderTree(b *strings.Builder, e *entry, prefix string, isRoot bool) {
	if isRoot {
		for i, child := range e.children {
			isLast := i == len(e.children)-1
			renderTreeEntry(b, child, prefix, isLast)
		}
	}
}

func renderTreeEntry(b *strings.Builder, e *entry, prefix string, isLast bool) {
	connector := "├── "
	if isLast {
		connector = "└── "
	}

	if e.isDir {
		fmt.Fprintf(b, "%s%s%s\n", prefix, connector, e.name)
		childPrefix := prefix + "│   "
		if isLast {
			childPrefix = prefix + "    "
		}
		for i, child := range e.children {
			childIsLast := i == len(e.children)-1
			renderTreeEntry(b, child, childPrefix, childIsLast)
		}
	} else {
		fmt.Fprintf(b, "%s%s%s %s\n", prefix, connector, e.name, formatSize(e.size))
	}
}

func formatSize(bytes int64) string {
	switch {
	case bytes >= 1<<30:
		return fmt.Sprintf("%.1fG", float64(bytes)/float64(1<<30))
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1fM", float64(bytes)/float64(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%.1fK", float64(bytes)/float64(1<<10))
	default:
		return fmt.Sprintf("%dB", bytes)
	}
}

func countEntries(root *entry) (int, int) {
	var dirs, files int
	for _, child := range root.children {
		if child.isDir {
			dirs++
			childDirs, childFiles := countEntries(child)
			dirs += childDirs
			files += childFiles
		} else {
			files++
		}
	}
	return dirs, files
}
