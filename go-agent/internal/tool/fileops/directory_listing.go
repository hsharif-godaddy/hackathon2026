package fileops

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

const maxEntries = 1000

// ignoredDirs aliases the shared ignored-directory list.
var ignoredDirs = tool.IgnoredDirs

// DirectoryListing implements the directoryListing tool.
type DirectoryListing struct{}

// NewDirectoryListing creates a directoryListing tool. The app root is resolved per-request from context.
func NewDirectoryListing() *DirectoryListing {
	return &DirectoryListing{}
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
	appRoot := scope.AppRoot

	rootPath := appRoot
	if in.Path != "" {
		abs, pathErr := tool.ValidatePath(appRoot, in.Path)
		if pathErr != nil {
			return pathErr
		}
		rootPath = abs
	}

	count := 0
	truncated := false
	root, walkErr := dl.walk(rootPath, 0, in, &count, &truncated)
	if walkErr != nil {
		return walkErr
	}

	var b strings.Builder
	dirCount, fileCount := countEntries(root)
	fmt.Fprintf(
		&b, "%s (%d dirs, %d files)\n",
		displayPath(appRoot, rootPath), dirCount, fileCount,
	)
	if truncated {
		fmt.Fprintf(&b, "truncated (%d+ items)\n", maxEntries)
	}
	b.WriteString("\n")

	renderTree(&b, root, "", true)

	out.Write(b.String())
	return nil
}

func (dl *DirectoryListing) walk(
	dir string, depth int, opts dirListingInput, count *int, truncated *bool,
) (*entry, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading directory: %w", err)
	}

	root := &entry{name: filepath.Base(dir) + "/", isDir: true}

	// Sort: directories first, then files, alphabetically
	sort.Slice(entries, func(i, j int) bool {
		di, dj := entries[i].IsDir(), entries[j].IsDir()
		if di != dj {
			return di
		}
		return entries[i].Name() < entries[j].Name()
	})

	for _, e := range entries {
		if *truncated {
			break
		}
		name := e.Name()

		// Skip hidden files unless requested
		if !opts.ShowHidden && strings.HasPrefix(name, ".") {
			continue
		}

		if e.IsDir() {
			dl.walkDir(dir, name, depth, opts, count, truncated, root)
		} else {
			walkFile(e, name, opts, count, truncated, root)
		}
	}

	return root, nil
}

func (dl *DirectoryListing) walkDir(
	dir, name string, depth int, opts dirListingInput,
	count *int, truncated *bool, root *entry,
) {
	if ignoredDirs[name] {
		return
	}

	if opts.MaxDepth > 0 && depth+1 >= opts.MaxDepth {
		if matchesFilters(name, true, opts) {
			*count++
			if *count > maxEntries {
				*truncated = true
				return
			}
			root.children = append(root.children, &entry{name: name + "/", isDir: true})
		}
		return
	}

	child, err := dl.walk(filepath.Join(dir, name), depth+1, opts, count, truncated)
	if err != nil {
		return
	}
	if matchesFilters(name, true, opts) || len(child.children) > 0 {
		*count++
		if *count > maxEntries {
			*truncated = true
			return
		}
		root.children = append(root.children, child)
	}
}

func walkFile(
	e os.DirEntry, name string, opts dirListingInput,
	count *int, truncated *bool, root *entry,
) {
	if opts.DirectoriesOnly {
		return
	}
	if !matchesFilters(name, false, opts) {
		return
	}
	*count++
	if *count > maxEntries {
		*truncated = true
		return
	}
	info, err := e.Info()
	var size int64
	if err == nil {
		size = info.Size()
	}
	root.children = append(root.children, &entry{name: name, size: size})
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

func displayPath(appRoot, absPath string) string {
	rel, err := filepath.Rel(appRoot, absPath)
	if err != nil || rel == "." {
		return "."
	}
	return rel
}
