package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const (
	wsFilesEncodingUTF8   = "utf-8"
	wsFilesEncodingBase64 = "base64"

	wsFilesKindFile      = "file"
	wsFilesKindDirectory = "directory"

	wsFilesMaxReadBytes   = 10 * 1024 * 1024  // 10MB max file read (view)
	wsFilesMaxEditBytes   = 1 * 1024 * 1024   // 1MB max file for edit (full in-memory replacement)
	wsFilesMaxBodySize    = 10 * 1024 * 1024  // 10MB max request body (JSON endpoints)
	wsFilesMaxUploadBytes = 100 * 1024 * 1024 // 100MB max binary upload

	wsFilesDefaultMaxEntries = 1000
	wsFilesMaxMaxDepth       = 100

	wsFilesDefaultMaxLines   = 2000
	wsFilesDefaultMaxResults = 50
	wsFilesMaxMaxResults     = 1000

	wsFilesMaxStatPaths = 100

	// Archive backstops — not normal-path limits, just runaway/zip-bomb guards.
	wsFilesMaxArchiveBytes   = 2 * 1024 * 1024 * 1024 // 2GB total uncompressed cap
	wsFilesMaxArchiveEntries = 50000                  // total entry-count cap
)

// --- Shared infrastructure ---

// fsBaseDir returns the base directory for filesystem operations.
func (s *Server) fsBaseDir() string {
	if s.config != nil && s.config.AppDir != "" {
		return s.config.AppDir
	}
	return "/app"
}

// resolveRoot resolves a named storage root to its absolute filesystem path.
// Empty root defaults to "app" for backward compatibility. Returns an error
// for unknown root names — callers must respond with 400.
func (s *Server) resolveRoot(rootName string) (string, error) {
	if rootName == "" {
		return s.fsBaseDir(), nil
	}
	roots := s.storageRoots
	if len(roots) == 0 {
		sharedStorageDir := ""
		if s.config != nil {
			sharedStorageDir = s.config.SharedStorageDir
		}
		roots = sandbox.ResolveRoots(s.fsBaseDir(), sharedStorageDir)
	}
	path, ok := sandbox.LookupRoot(roots, sandbox.StorageRootName(rootName))
	if !ok {
		return "", fmt.Errorf("unknown storage root %q; valid roots: %v", rootName, sandbox.ValidRootNames())
	}
	return path, nil
}

// resolveDir returns dir with symlinks resolved, falling back to the original
// path when resolution fails (e.g. the directory doesn't exist).
func resolveDir(dir string) string {
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		return resolved
	}
	return dir
}

// isDirSafeToDescend checks if a directory is safe to recurse into
// by resolving symlinks and verifying the target stays within the sandbox.
func isDirSafeToDescend(absPath string, sandboxDir string) bool {
	realPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return false
	}
	realSandbox := resolveDir(sandboxDir)
	return realPath == realSandbox || strings.HasPrefix(realPath, realSandbox+"/")
}

// Default ignored directories for search operations.
var defaultIgnoredDirs = []string{
	"node_modules", ".git", ".svn", ".hg", "vendor", "dist", "build", "out",
	"target", ".next", ".nuxt", ".vscode", ".idea", ".cache", ".parcel-cache",
	"coverage", ".nyc_output", "__pycache__", ".pytest_cache", ".mypy_cache",
	"venv", ".turbo", ".pnpm", ".yarn", ".vite",
}

// Default blocked file extensions for search operations.
var defaultBlockedExts = []string{
	".zip", ".tar", ".gz", ".rar", ".7z", ".bin", ".exe", ".dll", ".so", ".dylib",
	".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".eot",
	".db", ".sqlite", ".sqlite3", ".log",
}

const (
	rgTypeMatch   = "match"
	rgTypeContext = "context"
)

// rgUserError indicates a user-input error from ripgrep.
type rgUserError struct {
	message string
}

func (e *rgUserError) Error() string {
	return e.message
}

// rgJSONMessage represents a single line of ripgrep JSON output.
type rgJSONMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// rgMatchData represents the data field of a "match" type message.
type rgMatchData struct {
	Path       rgText       `json:"path"`
	Lines      rgText       `json:"lines"`
	LineNumber int          `json:"line_number"`
	Submatches []rgSubmatch `json:"submatches"`
}

type rgSubmatch struct {
	Start int `json:"start"`
}

// rgText represents a text field in ripgrep JSON output.
type rgText struct {
	Text string `json:"text"`
}

// --- Request/Response types ---

type wsFilesTreeRequest struct {
	Root      string `json:"root,omitempty"`
	Path      string `json:"path,omitempty"`
	Recursive bool   `json:"recursive,omitempty"`
	MaxDepth  int    `json:"maxDepth,omitempty"`
	// KindFilter, when set to "file" or "directory", drops non-matching
	// entries before they count against the entry cap. Subdirectory descent is
	// unaffected, so `kindFilter: "directory"` still walks into directories to
	// surface nested ones. Empty = no filter.
	KindFilter   string   `json:"kindFilter,omitempty"`
	IncludeGlobs []string `json:"includeGlobs,omitempty"`
	ExcludeGlobs []string `json:"excludeGlobs,omitempty"`
}

type wsFilesTreeEntry struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // "file" or "directory"
	// Size is always present (0 for directories) so the wire format matches
	// the TS interface — `omitempty` would silently drop the field for dirs
	// and break callers that access `entry.size` without a kind guard.
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
}

type wsFilesTreeResponse struct {
	Entries   []wsFilesTreeEntry `json:"entries"`
	Truncated bool               `json:"truncated"`
}

type wsFilesViewRequest struct {
	Root   string `json:"root,omitempty"`
	Path   string `json:"path"`
	Offset int    `json:"offset,omitempty"` // 0-based line number
	Limit  int    `json:"limit,omitempty"`  // max lines to return
}

type wsFilesViewResponse struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Encoding  string `json:"encoding"`
	Lines     int    `json:"lines"`     // total line count in file
	Size      int64  `json:"size"`      // file size in bytes
	Truncated bool   `json:"truncated"` // whether content was clipped
}

type wsFilesSearchRequest struct {
	Root          string   `json:"root,omitempty"`
	Pattern       string   `json:"pattern"`
	Path          string   `json:"path,omitempty"`
	CaseSensitive bool     `json:"caseSensitive,omitempty"`
	MaxResults    int      `json:"maxResults,omitempty"`
	IncludeGlobs  []string `json:"includeGlobs,omitempty"`
	ExcludeGlobs  []string `json:"excludeGlobs,omitempty"`
}

type wsFilesSearchMatch struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview"`
}

type wsFilesSearchResponse struct {
	Matches []wsFilesSearchMatch `json:"matches"`
}

type wsFilesWriteRequest struct {
	Root       string `json:"root,omitempty"`
	Path       string `json:"path"`
	Content    string `json:"content"`
	Encoding   string `json:"encoding,omitempty"`   // "utf-8" (default) or "base64"
	CreateOnly bool   `json:"createOnly,omitempty"` // if true, fail with 409 when file exists
}

type wsFilesWriteResponse struct {
	BytesWritten int64 `json:"bytesWritten"`
}

type wsFilesEditRequest struct {
	Root       string `json:"root,omitempty"`
	Path       string `json:"path"`
	OldString  string `json:"oldString"`
	NewString  string `json:"newString"`
	ReplaceAll bool   `json:"replaceAll,omitempty"`
}

type wsFilesEditResponse struct {
	Applied int `json:"applied"`
}

type wsFilesInsertRequest struct {
	Root    string `json:"root,omitempty"`
	Path    string `json:"path"`
	Line    int    `json:"line"` // 1-based: 0 = prepend, > total lines = append
	Content string `json:"content"`
}

type wsFilesInsertResponse struct {
	Lines int `json:"lines"` // total lines after insert
}

type wsFilesDeleteRequest struct {
	Root      string `json:"root,omitempty"`
	Path      string `json:"path"`
	Recursive bool   `json:"recursive,omitempty"`
}

type wsFilesMoveRequest struct {
	Root string `json:"root,omitempty"`
	From string `json:"from"`
	To   string `json:"to"`
}

type wsFilesStatRequest struct {
	Root  string   `json:"root,omitempty"`
	Paths []string `json:"paths"`
}

// wsFilesStatEntry is one entry in a /workspace/files/stat response.
//
// Successful entries set Kind/Size/ModifiedAt and leave Error empty.
// Failed entries set Error to a typed code ("not_found" | "permission_denied"
// | "invalid_path") and leave the metadata fields zero. Each path resolves
// independently — a missing path produces a per-entry error rather than
// failing the whole call.
//
// On successful entries, Size is emitted unconditionally (0 for directories)
// rather than `omitempty`'d — the TS `StatEntryFound` type declares
// `size: number` as required, and silently dropping the field for directories
// would force every consumer into a `kind === 'file'` guard before reading it.
// On error entries, Size is still 0 / Kind is "" — those drop via omitempty.
type wsFilesStatEntry struct {
	Path       string `json:"path"`
	Kind       string `json:"kind,omitempty"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt,omitempty"`
	Error      string `json:"error,omitempty"`
}

type wsFilesStatResponse struct {
	Entries []wsFilesStatEntry `json:"entries"`
}

// wsFilesArchiveRequest is a product-agnostic "zip these paths" request. The
// caller (the agent) supplies the allowlist; dirs are walked recursively and
// files are added if present. prefix becomes the top-level folder inside the
// zip (e.g. "myapp/src/index.ts").
type wsFilesArchiveRequest struct {
	Root   string   `json:"root,omitempty"`
	Dirs   []string `json:"dirs,omitempty"`
	Files  []string `json:"files,omitempty"`
	Prefix string   `json:"prefix,omitempty"`
}

// --- Middleware ---

func wsFilesMaxBodyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, wsFilesMaxBodySize)
		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func (s *Server) handleWorkspaceFilesTree(w http.ResponseWriter, r *http.Request) {
	var req wsFilesTreeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	basePath := req.Path
	if basePath == "" {
		basePath = "."
	}

	resolved, err := validation.ValidateFilePath(basePath, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if err := validateGlobs(req.IncludeGlobs, req.ExcludeGlobs); err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.KindFilter != "" && req.KindFilter != wsFilesKindFile && req.KindFilter != wsFilesKindDirectory {
		s.sendError(w, http.StatusBadRequest, "validation_failed",
			fmt.Sprintf("kindFilter must be %q or %q", wsFilesKindFile, wsFilesKindDirectory))
		return
	}

	maxEntries := wsFilesDefaultMaxEntries
	maxDepth := wsFilesMaxMaxDepth
	if req.MaxDepth > 0 && req.MaxDepth <= wsFilesMaxMaxDepth {
		maxDepth = req.MaxDepth
	}

	// Returned entry paths are workspace-rooted (joined to the requested
	// `path`), not bare directory-relative names. The TS contract on
	// `WorkspaceFiles.tree` documents this; callers pass the result straight
	// back into view/download/stat without re-prefixing.
	//
	// `ValidateFilePath` accepts both relative (`src`) and in-sandbox absolute
	// (`/app/src`) inputs; the prefix must always be workspace-relative so
	// callers never receive `/app/...` paths. For absolute inputs, rebase
	// against the (un-resolved) sandbox base — the same namespace
	// `ValidateFilePath` compares in before symlink resolution, so this stays
	// correct even when the base itself is a symlink.
	pathPrefix := filepath.Clean(req.Path)
	if filepath.IsAbs(pathPrefix) {
		rel, relErr := filepath.Rel(filepath.Clean(baseDir), pathPrefix)
		if relErr != nil {
			s.sendError(w, http.StatusBadRequest, "validation_failed", relErr.Error())
			return
		}
		pathPrefix = rel
	}
	if pathPrefix == "." {
		pathPrefix = ""
	}

	slog.Debug("workspace.files.tree.start", "path", basePath, "recursive", req.Recursive)

	var entries []wsFilesTreeEntry
	var truncated bool
	var treeErr error

	if req.Recursive {
		entries, truncated, treeErr = s.wsFilesTreeRecursive(resolved, req, pathPrefix, maxDepth, maxEntries, baseDir)
	} else {
		entries, truncated, treeErr = s.wsFilesTreeFlat(resolved, req, pathPrefix, maxEntries)
	}
	if treeErr != nil {
		s.sendWsFilesError(w, "workspace.files.tree", basePath, treeErr)
		return
	}

	slog.Debug("workspace.files.tree.completed", "path", basePath, "count", len(entries))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesTreeResponse{
		Entries:   entries,
		Truncated: truncated,
	}); err != nil {
		slog.Error("workspace.files.tree.encode_failed", "error", err)
	}
}

func (s *Server) wsFilesTreeFlat(
	resolved string,
	req wsFilesTreeRequest,
	pathPrefix string,
	maxEntries int,
) ([]wsFilesTreeEntry, bool, error) {
	rawEntries, err := os.ReadDir(resolved)
	if err != nil {
		return nil, false, err
	}

	result := make([]wsFilesTreeEntry, 0, len(rawEntries))
	for _, e := range rawEntries {
		relPath := wsFilesJoinPath(pathPrefix, e.Name())
		if len(req.ExcludeGlobs) > 0 && wsFilesGlobMatchAny(relPath, req.ExcludeGlobs) {
			continue
		}
		if len(req.IncludeGlobs) > 0 && !wsFilesGlobMatchAny(relPath, req.IncludeGlobs) {
			continue
		}
		info, infoErr := e.Info()
		if infoErr != nil {
			continue
		}
		if !wsFilesKindMatches(req.KindFilter, info.IsDir()) {
			continue
		}
		result = append(result, wsFilesBuildEntry(relPath, info))
		if len(result) >= maxEntries {
			return result, true, nil
		}
	}
	return result, false, nil
}

func (s *Server) wsFilesTreeRecursive(
	rootDir string,
	req wsFilesTreeRequest,
	pathPrefix string,
	maxDepth int,
	maxEntries int,
	sandboxDir string,
) ([]wsFilesTreeEntry, bool, error) {
	type walkItem struct {
		absDir string
		relDir string
		depth  int
	}
	result := make([]wsFilesTreeEntry, 0, min(maxEntries, 256))
	stack := []walkItem{{absDir: rootDir, relDir: pathPrefix, depth: 0}}

	for len(stack) > 0 {
		item := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		rawEntries, readErr := os.ReadDir(item.absDir)
		if readErr != nil {
			if item.depth > 0 && (os.IsPermission(readErr) || os.IsNotExist(readErr)) {
				continue
			}
			return nil, false, readErr
		}

		var subdirs []walkItem
		for _, e := range rawEntries {
			relPath := e.Name()
			if item.relDir != "" {
				relPath = item.relDir + "/" + e.Name()
			}

			// excludeGlobs prune: a matched entry is neither emitted nor
			// (for directories) descended into, so excluding a subtree avoids
			// walking it at all.
			if len(req.ExcludeGlobs) > 0 && wsFilesGlobMatchAny(relPath, req.ExcludeGlobs) {
				continue
			}

			info, infoErr := e.Info()
			if infoErr != nil {
				continue
			}

			// includeGlobs and kindFilter filter emission only — descent is
			// independent so a non-matching directory (e.g. `src` under
			// includeGlobs `src/**`, or any directory under kindFilter
			// "directory") is still walked to reach its matching descendants.
			if wsFilesKindMatches(req.KindFilter, info.IsDir()) &&
				(len(req.IncludeGlobs) == 0 || wsFilesGlobMatchAny(relPath, req.IncludeGlobs)) {
				result = append(result, wsFilesBuildEntry(relPath, info))
				if len(result) >= maxEntries {
					return result, true, nil
				}
			}

			if info.IsDir() && item.depth < maxDepth {
				absChild := filepath.Join(item.absDir, e.Name())
				if !isDirSafeToDescend(absChild, sandboxDir) {
					continue
				}
				subdirs = append(subdirs, walkItem{
					absDir: absChild,
					relDir: relPath,
					depth:  item.depth + 1,
				})
			}
		}

		for i := len(subdirs) - 1; i >= 0; i-- {
			stack = append(stack, subdirs[i])
		}
	}

	return result, false, nil
}

// wsFilesJoinPath joins a workspace-rooted directory prefix with a child name.
// Empty prefix means the entry is at the workspace root, so no separator is
// added. POSIX separator only — the wire format is always forward-slash.
func wsFilesJoinPath(prefix, name string) string {
	if prefix == "" {
		return name
	}
	return prefix + "/" + name
}

func wsFilesBuildEntry(path string, info fs.FileInfo) wsFilesTreeEntry {
	kind := wsFilesKindFile
	if info.IsDir() {
		kind = wsFilesKindDirectory
	}
	entry := wsFilesTreeEntry{
		Path:       path,
		Kind:       kind,
		ModifiedAt: info.ModTime().Format(time.RFC3339),
	}
	if !info.IsDir() {
		entry.Size = info.Size()
	}
	return entry
}

func validateGlobs(includeGlobs []string, excludeGlobs []string) error {
	for _, p := range includeGlobs {
		if !doublestar.ValidatePattern(p) {
			return fmt.Errorf("invalid includeGlobs pattern %q", p)
		}
	}
	for _, p := range excludeGlobs {
		if !doublestar.ValidatePattern(p) {
			return fmt.Errorf("invalid excludeGlobs pattern %q", p)
		}
	}
	return nil
}

// wsFilesGlobMatchAny reports whether the workspace-rooted, forward-slash
// `relPath` matches any pattern. Anchoring follows a single slash-presence
// rule (the same one ripgrep --glob and minimatch's matchBase apply) — NOT
// full .gitignore semantics: there is no `!` negation and no trailing-slash
// dir-only matching.
//
//   - a pattern WITHOUT a slash is matched against the basename, so it applies
//     at ANY depth (`node_modules`, `*.log`);
//   - a pattern WITH a slash is anchored to the workspace root and matched
//     against the full path via doublestar, so `src/legacy/**` scopes to a
//     subtree and `**/foo` matches `foo` at any depth. Because doublestar's
//     `**` also matches zero segments, `build/**` matches `build` itself, so
//     an excluded directory is pruned, not just its descendants.
//
// The slash-free case is a superset of the pre-path-aware behavior (basename
// filepath.Match), so existing bare-name callers keep working unchanged.
// Patterns are pre-validated by validateGlobs, so the match error is ignored.
func wsFilesGlobMatchAny(relPath string, globs []string) bool {
	base := relPath
	if i := strings.LastIndex(relPath, "/"); i >= 0 {
		base = relPath[i+1:]
	}
	for _, p := range globs {
		target := relPath
		if !strings.Contains(p, "/") {
			target = base
		}
		if matched, _ := doublestar.Match(p, target); matched {
			return true
		}
	}
	return false
}

// wsFilesKindMatches reports whether an entry of the given kind passes the
// optional kindFilter. An empty filter (or an unexpected value, already
// rejected at the handler) matches everything.
func wsFilesKindMatches(kindFilter string, isDir bool) bool {
	switch kindFilter {
	case wsFilesKindDirectory:
		return isDir
	case wsFilesKindFile:
		return !isDir
	default:
		return true
	}
}

func (s *Server) handleWorkspaceFilesView(w http.ResponseWriter, r *http.Request) {
	var req wsFilesViewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.Path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is required")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("workspace.files.view.start", "path", req.Path, "offset", req.Offset, "limit", req.Limit)

	info, err := os.Stat(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.view", req.Path, err)
		return
	}
	if info.IsDir() {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is a directory")
		return
	}
	if info.Size() > wsFilesMaxReadBytes {
		s.sendError(
			w, http.StatusRequestEntityTooLarge, "file_too_large",
			fmt.Sprintf("file size %d exceeds maximum %d", info.Size(), wsFilesMaxReadBytes),
		)
		return
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.view", req.Path, err)
		return
	}

	// Binary files: return base64 without line-range support
	if !utf8.Valid(data) {
		w.Header().Set("Content-Type", "application/json")
		if encErr := json.NewEncoder(w).Encode(wsFilesViewResponse{
			Path:      req.Path,
			Content:   base64.StdEncoding.EncodeToString(data),
			Encoding:  wsFilesEncodingBase64,
			Lines:     0,
			Size:      info.Size(),
			Truncated: false,
		}); encErr != nil {
			slog.Error("workspace.files.view.encode_failed", "error", encErr)
		}
		return
	}

	content := string(data)
	allLines := strings.Split(content, "\n")
	totalLines := len(allLines)

	offset := min(max(req.Offset, 0), totalLines)

	limit := req.Limit
	if limit <= 0 {
		limit = wsFilesDefaultMaxLines
	}

	end := offset + limit
	truncated := false
	if end > totalLines {
		end = totalLines
	} else if end < totalLines {
		truncated = true
	}

	selectedLines := allLines[offset:end]
	resultContent := strings.Join(selectedLines, "\n")

	slog.Debug("workspace.files.view.completed", "path", req.Path, "lines", totalLines)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesViewResponse{
		Path:      req.Path,
		Content:   resultContent,
		Encoding:  wsFilesEncodingUTF8,
		Lines:     totalLines,
		Size:      info.Size(),
		Truncated: truncated,
	}); err != nil {
		slog.Error("workspace.files.view.encode_failed", "error", err)
	}
}

func (s *Server) handleWorkspaceFilesSearch(w http.ResponseWriter, r *http.Request) {
	var req wsFilesSearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, rootErr := s.resolveRoot(req.Root)
	if rootErr != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", rootErr.Error())
		return
	}

	if strings.TrimSpace(req.Pattern) == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "pattern is required")
		return
	}

	if err := validateGlobs(req.IncludeGlobs, req.ExcludeGlobs); err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = wsFilesDefaultMaxResults
	}
	if maxResults > wsFilesMaxMaxResults {
		maxResults = wsFilesMaxMaxResults
	}

	searchPath := baseDir
	if req.Path != "" {
		resolved, err := validation.ValidateFilePath(req.Path, baseDir)
		if err != nil {
			s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		searchPath = resolved
	}

	slog.Debug("workspace.files.search.start", "pattern", req.Pattern, "path", searchPath)

	args := []string{"--json", "--sort", "path", "-F"}
	if !req.CaseSensitive {
		args = append(args, "-i")
	}

	// Default ignores
	for _, dir := range defaultIgnoredDirs {
		args = append(args, "--glob", fmt.Sprintf("!%s", dir))
	}
	for _, ext := range defaultBlockedExts {
		args = append(args, "--glob", fmt.Sprintf("!*%s", ext))
	}

	for _, p := range req.IncludeGlobs {
		args = append(args, "--glob", p)
	}
	for _, p := range req.ExcludeGlobs {
		args = append(args, "--glob", fmt.Sprintf("!%s", p))
	}

	args = append(args, "--", req.Pattern, searchPath)

	matches, err := s.executeWsFilesSearch(r.Context(), args, baseDir, maxResults)
	if err != nil {
		var userErr *rgUserError
		if errors.As(err, &userErr) {
			s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		slog.Error("workspace.files.search.failed", "error", err)
		s.sendError(w, http.StatusInternalServerError, "search_failed", err.Error())
		return
	}

	slog.Debug("workspace.files.search.completed", "matches", len(matches))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesSearchResponse{Matches: matches}); err != nil {
		slog.Error("workspace.files.search.encode_failed", "error", err)
	}
}

func (s *Server) executeWsFilesSearch(
	ctx context.Context, args []string, baseDir string, maxResults int,
) ([]wsFilesSearchMatch, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "rg", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := s.runShortLivedCommand(cmd)
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			switch exitErr.ExitCode() {
			case 1:
				return []wsFilesSearchMatch{}, nil
			case 2:
				return nil, &rgUserError{message: stderr.String()}
			}
		}
		return nil, fmt.Errorf("rg failed: %s", stderr.String())
	}

	return parseWsFilesSearchOutput(stdout.Bytes(), baseDir, maxResults), nil
}

func parseWsFilesSearchOutput(data []byte, baseDir string, maxResults int) []wsFilesSearchMatch {
	matches := make([]wsFilesSearchMatch, 0)
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var msg rgJSONMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			continue
		}

		if msg.Type != rgTypeMatch {
			continue
		}

		var md rgMatchData
		if err := json.Unmarshal(msg.Data, &md); err != nil {
			continue
		}

		relPath := md.Path.Text
		if filepath.IsAbs(relPath) {
			if rel, err := filepath.Rel(baseDir, relPath); err == nil {
				relPath = rel
			}
		}

		preview := strings.TrimRight(md.Lines.Text, "\n\r")

		column := 1
		if len(md.Submatches) > 0 {
			column = md.Submatches[0].Start + 1 // ripgrep is 0-based, API is 1-based
		}

		matches = append(matches, wsFilesSearchMatch{
			Path:    relPath,
			Line:    md.LineNumber,
			Column:  column,
			Preview: preview,
		})

		if len(matches) >= maxResults {
			break
		}
	}

	return matches
}

func (s *Server) handleWorkspaceFilesWrite(w http.ResponseWriter, r *http.Request) {
	var req wsFilesWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.Path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is required")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.CreateOnly {
		if _, statErr := os.Stat(resolved); statErr == nil {
			s.sendError(w, http.StatusConflict, "file_exists",
				fmt.Sprintf("file already exists: %s", req.Path))
			return
		}
	}

	slog.Debug("workspace.files.write.start", "path", req.Path)

	var data []byte
	if req.Encoding == wsFilesEncodingBase64 {
		data, err = base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid base64 content")
			return
		}
	} else {
		data = []byte(req.Content)
	}

	// Auto-create parent directories
	dir := filepath.Dir(resolved)
	if mkdirErr := os.MkdirAll(dir, 0o750); mkdirErr != nil {
		s.sendWsFilesError(w, "workspace.files.write", req.Path, mkdirErr)
		return
	}

	// Atomic write: tmp + rename so readers never see a partial file
	tmpFile := resolved + ".tmp"
	//nolint:gosec // workspace files are intentionally world-readable
	if err := os.WriteFile(tmpFile, data, 0o644); err != nil {
		s.sendWsFilesError(w, "workspace.files.write", req.Path, err)
		return
	}
	if err := os.Rename(tmpFile, resolved); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.write", req.Path, err)
		return
	}

	slog.Debug("workspace.files.write.completed", "path", req.Path, "bytes_written", len(data))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesWriteResponse{BytesWritten: int64(len(data))}); err != nil {
		slog.Error("workspace.files.write.encode_failed", "error", err)
	}
}

func (s *Server) handleWorkspaceFilesEdit(w http.ResponseWriter, r *http.Request) {
	var req wsFilesEditRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.Path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is required")
		return
	}
	if req.OldString == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "oldString is required")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("workspace.files.edit.start", "path", req.Path, "replace_all", req.ReplaceAll)

	info, err := os.Stat(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.edit", req.Path, err)
		return
	}
	if info.Size() > wsFilesMaxEditBytes {
		s.sendError(w, http.StatusRequestEntityTooLarge, "file_too_large",
			fmt.Sprintf("file size %d exceeds edit maximum %d", info.Size(), wsFilesMaxEditBytes))
		return
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.edit", req.Path, err)
		return
	}

	content := string(data)
	count := strings.Count(content, req.OldString)

	if count == 0 {
		s.sendError(w, http.StatusBadRequest, "no_match", "oldString not found in file")
		return
	}

	if !req.ReplaceAll && count > 1 {
		s.sendError(w, http.StatusBadRequest, "ambiguous_match",
			fmt.Sprintf("oldString found %d times; set replaceAll=true or provide a more specific match", count))
		return
	}

	var newContent string
	var applied int
	if req.ReplaceAll {
		newContent = strings.ReplaceAll(content, req.OldString, req.NewString)
		applied = count
	} else {
		newContent = strings.Replace(content, req.OldString, req.NewString, 1)
		applied = 1
	}

	// Atomic write: preserve original file permissions (explicit chmod to bypass umask)
	tmpFile := resolved + ".tmp"
	if err := os.WriteFile(tmpFile, []byte(newContent), 0o600); err != nil {
		s.sendWsFilesError(w, "workspace.files.edit", req.Path, err)
		return
	}
	if err := os.Chmod(tmpFile, info.Mode().Perm()); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.edit", req.Path, err)
		return
	}
	if err := os.Rename(tmpFile, resolved); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.edit", req.Path, err)
		return
	}

	slog.Debug("workspace.files.edit.completed", "path", req.Path, "applied", applied)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesEditResponse{Applied: applied}); err != nil {
		slog.Error("workspace.files.edit.encode_failed", "error", err)
	}
}

func (s *Server) handleWorkspaceFilesInsert(w http.ResponseWriter, r *http.Request) {
	var req wsFilesInsertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.Path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is required")
		return
	}
	if req.Content == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "content is required")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("workspace.files.insert.start", "path", req.Path, "line", req.Line)

	info, err := os.Stat(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}
	if info.Size() > wsFilesMaxEditBytes {
		s.sendError(w, http.StatusRequestEntityTooLarge, "file_too_large",
			fmt.Sprintf("file size %d exceeds edit maximum %d", info.Size(), wsFilesMaxEditBytes))
		return
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}

	content := string(data)
	lines := strings.Split(content, "\n")

	// Handle trailing newline: if file ends with \n, last split element is empty — strip it
	// and restore the trailing newline after splicing.
	trailingNewline := len(lines) > 0 && lines[len(lines)-1] == ""
	if trailingNewline {
		lines = lines[:len(lines)-1]
	}

	// Determine insertion index (line is 1-based; 0 = prepend, line=N inserts before line N)
	idx := min(max(req.Line, 1)-1, len(lines))
	if req.Line == 0 {
		idx = 0
	}

	// Splice: insert content at idx
	result := make([]string, 0, len(lines)+1)
	result = append(result, lines[:idx]...)
	result = append(result, req.Content)
	result = append(result, lines[idx:]...)

	newContent := strings.Join(result, "\n")
	if trailingNewline {
		newContent += "\n"
	}

	// Atomic write: preserve original file permissions
	tmpFile := resolved + ".tmp"
	if err := os.WriteFile(tmpFile, []byte(newContent), 0o600); err != nil {
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}
	if err := os.Chmod(tmpFile, info.Mode().Perm()); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}
	if err := os.Rename(tmpFile, resolved); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.insert", req.Path, err)
		return
	}

	totalLines := len(strings.Split(newContent, "\n"))
	slog.Debug("workspace.files.insert.completed", "path", req.Path, "lines", totalLines)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesInsertResponse{Lines: totalLines}); err != nil {
		slog.Error("workspace.files.insert.encode_failed", "error", err)
	}
}

func (s *Server) handleWorkspaceFilesDelete(w http.ResponseWriter, r *http.Request) {
	var req wsFilesDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.Path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is required")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("workspace.files.delete.start", "path", req.Path, "recursive", req.Recursive)

	if req.Recursive {
		err = os.RemoveAll(resolved)
	} else {
		err = os.Remove(resolved)
	}
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.delete", req.Path, err)
		return
	}

	slog.Debug("workspace.files.delete.completed", "path", req.Path)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
		slog.Error("workspace.files.delete.encode_failed", "error", err)
	}
}

func (s *Server) handleWorkspaceFilesMove(w http.ResponseWriter, r *http.Request) {
	var req wsFilesMoveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	baseDir, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if req.From == "" || req.To == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "from and to are required")
		return
	}

	resolvedFrom, err := validation.ValidateFilePath(req.From, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", fmt.Sprintf("from: %s", err.Error()))
		return
	}

	resolvedTo, err := validation.ValidateFilePath(req.To, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", fmt.Sprintf("to: %s", err.Error()))
		return
	}

	// Check destination doesn't exist
	if _, statErr := os.Stat(resolvedTo); statErr == nil {
		s.sendError(w, http.StatusBadRequest, "destination_exists", "destination path already exists")
		return
	}

	slog.Debug("workspace.files.move.start", "from", req.From, "to", req.To)

	// Auto-create parent directories for destination
	if mkdirErr := os.MkdirAll(filepath.Dir(resolvedTo), 0o750); mkdirErr != nil {
		s.sendWsFilesError(w, "workspace.files.move", req.From, mkdirErr)
		return
	}

	if err := os.Rename(resolvedFrom, resolvedTo); err != nil {
		s.sendWsFilesError(w, "workspace.files.move", req.From, err)
		return
	}

	slog.Debug("workspace.files.move.completed", "from", req.From, "to", req.To)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
		slog.Error("workspace.files.move.encode_failed", "error", err)
	}
}

func (s *Server) handleWorkspaceFilesUpload(w http.ResponseWriter, r *http.Request) {
	root := r.URL.Query().Get("root")
	baseDir, err := s.resolveRoot(root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path query parameter is required")
		return
	}

	resolved, err := validation.ValidateFilePath(path, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("workspace.files.upload.start", "path", path)

	// Auto-create parent directories
	if mkdirErr := os.MkdirAll(filepath.Dir(resolved), 0o750); mkdirErr != nil {
		s.sendWsFilesError(w, "workspace.files.upload", path, mkdirErr)
		return
	}

	// Stream body directly to a temp file — avoids buffering the full upload in memory
	tmpFile := resolved + ".upload.tmp"
	//nolint:gosec // workspace files are intentionally world-readable
	f, err := os.OpenFile(tmpFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.upload", path, err)
		return
	}

	written, copyErr := io.Copy(f, r.Body)
	closeErr := f.Close()

	if copyErr != nil {
		_ = os.Remove(tmpFile)
		s.sendError(w, http.StatusBadRequest, "upload_failed", copyErr.Error())
		return
	}
	if closeErr != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.upload", path, closeErr)
		return
	}

	// Atomic rename into place
	if err := os.Rename(tmpFile, resolved); err != nil {
		_ = os.Remove(tmpFile)
		s.sendWsFilesError(w, "workspace.files.upload", path, err)
		return
	}

	slog.Debug("workspace.files.upload.completed", "path", path, "bytes_written", written)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesWriteResponse{BytesWritten: written}); err != nil {
		slog.Error("workspace.files.upload.encode_failed", "error", err)
	}
}

func (s *Server) handleWorkspaceFilesDownload(w http.ResponseWriter, r *http.Request) {
	root := r.URL.Query().Get("root")
	baseDir, err := s.resolveRoot(root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path query parameter is required")
		return
	}

	resolved, err := validation.ValidateFilePath(path, baseDir)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	f, err := os.Open(resolved)
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.download", path, err)
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		s.sendWsFilesError(w, "workspace.files.download", path, err)
		return
	}
	if info.IsDir() {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "path is a directory")
		return
	}
	if info.Size() > wsFilesMaxReadBytes {
		s.sendError(
			w, http.StatusRequestEntityTooLarge, "file_too_large",
			fmt.Sprintf("file size %d exceeds maximum %d", info.Size(), wsFilesMaxReadBytes),
		)
		return
	}

	contentType := mime.TypeByExtension(filepath.Ext(resolved))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	slog.Debug("workspace.files.download.start", "path", path, "size", info.Size())

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))

	if _, err := io.Copy(w, f); err != nil {
		slog.Error("workspace.files.download.stream_failed", "path", path, "error", err)
	}
}

// handleWorkspaceFilesArchive streams a zip of the requested dirs/files built
// directly from the workspace filesystem. It writes the zip to the response as
// it walks (O(1) memory) and applies NO per-file size cap — unlike view/download,
// which cap at wsFilesMaxReadBytes.
//
// Failure model:
//   - A file that fails to OPEN is logged and skipped (no bytes written for it),
//     so one unreadable file does not abort the whole archive.
//   - If EVERY matched file fails to open (zero entries written, but failures
//     occurred), nothing has been flushed yet, so we return a clean JSON error
//     instead of a misleading 200 + empty zip (the "total-failure floor").
//   - A failure AFTER an entry's bytes have started streaming (Create/Copy error,
//     or a final Close error) is unrecoverable — the status line is already sent —
//     so we panic(http.ErrAbortHandler) to abort the connection. The client sees a
//     truncated transfer, never a clean 200 wrapping a corrupt zip.
func (s *Server) handleWorkspaceFilesArchive(w http.ResponseWriter, r *http.Request) {
	var req wsFilesArchiveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	base, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if len(req.Dirs) == 0 && len(req.Files) == 0 {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "dirs or files is required")
		return
	}
	// ValidateFilePath returns symlink-resolved absolute paths; rebasing entry
	// names against the unresolved base would inject ".." on a symlinked base
	// (macOS /var, a symlinked prod /app), so resolve the base too.
	resolvedBase := resolveDir(base)

	resolvedDirs := make([]string, 0, len(req.Dirs))
	for _, d := range req.Dirs {
		resolved, err := validation.ValidateFilePath(d, base)
		if err != nil {
			s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		resolvedDirs = append(resolvedDirs, resolved)
	}
	resolvedFiles := make([]string, 0, len(req.Files))
	for _, f := range req.Files {
		resolved, err := validation.ValidateFilePath(f, base)
		if err != nil {
			s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		resolvedFiles = append(resolvedFiles, resolved)
	}

	ab := &wsArchiveBuilder{
		w:            w,
		resolvedBase: resolvedBase,
		prefix:       strings.Trim(req.Prefix, "/"),
	}

	for _, dirAbs := range resolvedDirs {
		if ab.limitHit {
			break
		}
		_ = filepath.WalkDir(dirAbs, ab.walkFunc)
	}
	for _, fileAbs := range resolvedFiles {
		if ab.limitHit {
			break
		}
		info, err := os.Lstat(fileAbs)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		ab.addFile(fileAbs)
	}

	// Total-failure floor: every matched file failed to open. Nothing flushed yet
	// (zw is nil), so return a clean error rather than a misleading 200 + empty zip.
	if ab.zw == nil {
		if ab.failedCount > 0 {
			slog.Error("workspace.files.archive.all_failed",
				"entry_count", ab.entryCount, "failed_count", ab.failedCount, "total_bytes", ab.totalBytes)
			s.sendError(w, http.StatusInternalServerError, "archive_failed",
				fmt.Sprintf("all %d files failed to read", ab.failedCount))
			return
		}
		// Nothing matched at all — emit a valid empty zip (200).
		ab.ensureWriter()
	}

	if err := ab.zw.Close(); err != nil {
		slog.Error("workspace.files.archive.close_failed", "error", err.Error(),
			"entry_count", ab.entryCount, "failed_count", ab.failedCount, "total_bytes", ab.totalBytes)
		panic(http.ErrAbortHandler)
	}

	if ab.limitHit {
		slog.Warn("workspace.files.archive.limit_hit",
			"entry_count", ab.entryCount, "total_bytes", ab.totalBytes)
	}
	slog.Info("workspace.files.archive.success",
		"entry_count", ab.entryCount, "failed_count", ab.failedCount, "total_bytes", ab.totalBytes)
}

// wsArchiveBuilder holds the mutable state for a single streamed-zip response.
// Its methods are extracted from handleWorkspaceFilesArchive so the handler
// stays under the gocyclo limit; behavior is identical to the inlined closures.
type wsArchiveBuilder struct {
	w            http.ResponseWriter
	resolvedBase string
	prefix       string

	zw          *zip.Writer
	entryCount  int
	totalBytes  int64
	failedCount int
	limitHit    bool
}

// ensureWriter lazily commits the response to a streamed zip. Called only once
// at least one file has been opened successfully, so a walk that opens zero
// files leaves the response un-flushed and can still return JSON.
func (ab *wsArchiveBuilder) ensureWriter() {
	if ab.zw == nil {
		ab.w.Header().Set("Content-Type", "application/zip")
		ab.zw = zip.NewWriter(ab.w)
	}
}

// recordSkip logs and counts a file that could not be opened. The walk
// continues — one unreadable file must not abort the whole archive.
func (ab *wsArchiveBuilder) recordSkip(absPath string, err error) {
	ab.failedCount++
	slog.Warn("workspace.files.archive.file.failed", "path", absPath, "error", err.Error())
}

// addFile opens absPath and streams it into the zip under prefix/<rel>. An open
// failure is logged, counted, and skipped. A failure AFTER the entry's bytes
// have started streaming (Create/Copy) is unrecoverable — the status line is
// already sent — so it panics with http.ErrAbortHandler to abort the connection
// rather than deliver a clean 200 wrapping a corrupt zip.
func (ab *wsArchiveBuilder) addFile(absPath string) {
	if ab.entryCount >= wsFilesMaxArchiveEntries || ab.totalBytes >= wsFilesMaxArchiveBytes {
		ab.limitHit = true
		return
	}

	rel, err := filepath.Rel(ab.resolvedBase, absPath)
	if err != nil {
		ab.recordSkip(absPath, err)
		return
	}
	f, err := os.Open(absPath)
	if err != nil {
		ab.recordSkip(absPath, err)
		return
	}
	defer f.Close()

	name := rel
	if ab.prefix != "" {
		name = ab.prefix + "/" + rel
	}

	ab.ensureWriter() // first successful open commits us to a 200 + zip stream

	entry, err := ab.zw.Create(name)
	if err != nil {
		slog.Error("workspace.files.archive.entry_failed", "path", absPath, "error", err.Error(),
			"entry_count", ab.entryCount, "failed_count", ab.failedCount, "total_bytes", ab.totalBytes)
		panic(http.ErrAbortHandler)
	}
	n, err := io.Copy(entry, f)
	if err != nil {
		slog.Error("workspace.files.archive.copy_failed", "path", absPath, "error", err.Error(),
			"entry_count", ab.entryCount, "failed_count", ab.failedCount, "total_bytes", ab.totalBytes)
		panic(http.ErrAbortHandler)
	}
	ab.entryCount++
	ab.totalBytes += n
}

// walkFunc is a filepath.WalkDir callback that adds regular files to the
// archive, skipping directories, symlinks, and special files.
func (ab *wsArchiveBuilder) walkFunc(p string, d fs.DirEntry, err error) error {
	if ab.limitHit {
		return filepath.SkipAll
	}
	if err != nil {
		slog.Debug("workspace.files.archive.walk.skip", "path", p, "error", err.Error())
		if d != nil && d.IsDir() {
			return filepath.SkipDir
		}
		return nil
	}
	if d.IsDir() || d.Type()&fs.ModeSymlink != 0 || !d.Type().IsRegular() {
		return nil
	}
	ab.addFile(p)
	return nil
}

// wsFilesUploadMiddleware limits binary upload body size separately from JSON endpoints.
func wsFilesUploadMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, wsFilesMaxUploadBytes)
		next.ServeHTTP(w, r)
	})
}

// handleWorkspaceFilesStat returns metadata for one or more paths in a single
// round-trip. This is the cheap stat-equivalent that callers should reach for
// instead of view() (which downloads file content) or tree() (which walks a
// directory).
//
// Path-level outcomes inline as one of three typed errors and do NOT fail the
// call: "not_found" (path doesn't exist), "permission_denied" (EACCES), and
// "invalid_path" (failed validation, e.g. path traversal). Other unexpected
// errors (EIO, etc.) still 500 the whole request — they're rare and a partial
// response with no signal would be worse.
func (s *Server) handleWorkspaceFilesStat(w http.ResponseWriter, r *http.Request) {
	var req wsFilesStatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	base, err := s.resolveRoot(req.Root)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if len(req.Paths) == 0 {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "paths is required and must be non-empty")
		return
	}
	if len(req.Paths) > wsFilesMaxStatPaths {
		s.sendError(
			w, http.StatusBadRequest, "validation_failed",
			fmt.Sprintf("paths length %d exceeds maximum %d", len(req.Paths), wsFilesMaxStatPaths),
		)
		return
	}
	entries := make([]wsFilesStatEntry, 0, len(req.Paths))
	for _, p := range req.Paths {
		entry := wsFilesStatEntry{Path: p}

		resolved, err := validation.ValidateFilePath(p, base)
		if err != nil {
			entry.Error = "invalid_path"
			entries = append(entries, entry)
			continue
		}

		info, statErr := os.Stat(resolved)
		if statErr != nil {
			switch {
			case os.IsNotExist(statErr):
				entry.Error = "not_found"
			case os.IsPermission(statErr):
				entry.Error = "permission_denied"
			default:
				slog.Error("workspace.files.stat.failed", "path", p, "error", statErr)
				s.sendError(w, http.StatusInternalServerError, "workspace.files.stat_failed", statErr.Error())
				return
			}
			entries = append(entries, entry)
			continue
		}

		if info.IsDir() {
			entry.Kind = wsFilesKindDirectory
		} else {
			entry.Kind = wsFilesKindFile
			entry.Size = info.Size()
		}
		entry.ModifiedAt = info.ModTime().Format(time.RFC3339)
		entries = append(entries, entry)
	}

	slog.Debug("workspace.files.stat.completed", "count", len(entries))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wsFilesStatResponse{Entries: entries}); err != nil {
		slog.Error("workspace.files.stat.encode_failed", "error", err)
	}
}

// sendWsFilesError maps filesystem errors to HTTP status codes.
func (s *Server) sendWsFilesError(w http.ResponseWriter, operation string, path string, err error) {
	if os.IsNotExist(err) {
		s.sendError(w, http.StatusNotFound, "not_found", fmt.Sprintf("%s: %s", path, err.Error()))
		return
	}
	if os.IsPermission(err) {
		s.sendError(w, http.StatusForbidden, "permission_denied", fmt.Sprintf("%s: %s", path, err.Error()))
		return
	}
	slog.Error(operation+".failed", "path", path, "error", err)
	s.sendError(w, http.StatusInternalServerError, operation+"_failed", err.Error())
}
