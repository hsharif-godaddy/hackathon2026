package main

import (
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
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const (
	encodingUTF8   = "utf-8"
	encodingBase64 = "base64"

	// maxReadLength is the maximum bytes a single /fs/read can return (100MB).
	maxReadLength = 100 * 1024 * 1024

	defaultMaxEntries = 1000
	maxMaxEntries     = 10000
	maxMaxDepth       = 100

	// maxRequestBodySize is the maximum request body size for /fs endpoints.
	// Matches maxReadLength since /fs/write carries file content in the body.
	// Base64-encoded content is ~33% larger, so this allows ~75MB of raw data.
	maxRequestBodySize = maxReadLength
)

// fsBaseDir returns the base directory for filesystem operations.
func (s *Server) fsBaseDir() string {
	if s.config != nil && s.config.AppDir != "" {
		return s.config.AppDir
	}
	return "/app"
}

// inputError represents a client input validation error (should map to HTTP 400).
type inputError struct{ msg string }

func (e *inputError) Error() string { return e.msg }

// readFileData reads file content, supporting partial reads via offset/length.
// Returns the data read, the total file size on disk, and any error.
// Returns *inputError for invalid request parameters (negative offset/length, exceeds max).
func (s *Server) readFileData(resolved string, req validation.FileReadRequest) ([]byte, int64, error) {
	if req.Offset < 0 {
		return nil, 0, &inputError{"offset cannot be negative"}
	}
	if req.Length < 0 {
		return nil, 0, &inputError{"length cannot be negative"}
	}

	f, err := os.Open(resolved)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()

	info, statErr := f.Stat()
	if statErr != nil {
		return nil, 0, statErr
	}
	fileSize := info.Size()

	if req.Offset > 0 {
		if _, err = f.Seek(req.Offset, 0); err != nil {
			return nil, 0, err
		}
	}

	length := req.Length
	if length <= 0 {
		length = fileSize - req.Offset
		if length <= 0 {
			return []byte{}, fileSize, nil
		}
	}
	if length > maxReadLength {
		return nil, 0, &inputError{fmt.Sprintf("requested read length %d exceeds maximum %d", length, maxReadLength)}
	}

	data, readErr := io.ReadAll(io.LimitReader(f, length))
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return nil, 0, readErr
	}
	return data, fileSize, nil
}

func (s *Server) handleFsRead(w http.ResponseWriter, r *http.Request) {
	var req validation.FileReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("fs.read.start", "path", req.Path, "encoding", req.Encoding)

	data, totalSize, readErr := s.readFileData(resolved, req)
	if readErr != nil {
		var ie *inputError
		if errors.As(readErr, &ie) {
			s.sendError(w, http.StatusBadRequest, "validation_failed", ie.Error())
		} else {
			s.sendFsError(w, "fs.read", req.Path, readErr)
		}
		return
	}

	var content string
	encoding := req.Encoding
	if encoding == encodingUTF8 || encoding == "utf8" {
		content = string(data)
		encoding = encodingUTF8
	} else {
		content = base64.StdEncoding.EncodeToString(data)
		encoding = encodingBase64
	}

	slog.Debug("fs.read.completed", "path", req.Path, "size", len(data))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(validation.FileReadResponse{
		Content:   content,
		Size:      int64(len(data)),
		TotalSize: totalSize,
		Encoding:  encoding,
	}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleFsWrite(w http.ResponseWriter, r *http.Request) {
	var req validation.FileWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("fs.write.start", "path", req.Path, "encoding", req.Encoding, "mkdir_p", req.MkdirP)

	if req.MkdirP {
		dir := filepath.Dir(resolved)
		if mkdirErr := os.MkdirAll(dir, 0o750); mkdirErr != nil {
			s.sendFsError(w, "fs.write", req.Path, mkdirErr)
			return
		}
	}

	var data []byte
	if req.Encoding == encodingBase64 {
		data, err = base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid base64 content")
			return
		}
	} else {
		data = []byte(req.Content)
	}

	mode := fs.FileMode(0o644)
	if req.Mode != 0 {
		if req.Mode < 0 || req.Mode > 0o777 {
			s.sendError(w, http.StatusBadRequest, "validation_failed", "invalid file mode")
			return
		}
		mode = fs.FileMode(req.Mode) & os.ModePerm
	}

	if err := os.WriteFile(resolved, data, mode); err != nil {
		s.sendFsError(w, "fs.write", req.Path, err)
		return
	}

	slog.Debug("fs.write.completed", "path", req.Path, "bytes_written", len(data))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(validation.FileWriteResponse{
		BytesWritten: int64(len(data)),
	}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleFsStat(w http.ResponseWriter, r *http.Request) {
	var req validation.FilePathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	info, err := os.Stat(resolved)
	if err != nil {
		s.sendFsError(w, "fs.stat", req.Path, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(validation.FileStatResponse{
		Size:        info.Size(),
		IsDir:       info.IsDir(),
		IsFile:      info.Mode().IsRegular(),
		ModTimeMs:   info.ModTime().UnixMilli(),
		ModTime:     info.ModTime().Format(time.RFC3339),
		Permissions: fmt.Sprintf("%04o", info.Mode().Perm()),
	}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleFsReaddir(w http.ResponseWriter, r *http.Request) {
	var req validation.FileReaddirRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if validateErr := validateReaddirRequest(&req); validateErr != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", validateErr.Error())
		return
	}

	slog.Debug("fs.readdir.start", "path", req.Path, "recursive", req.Recursive)

	var resp validation.FileReaddirResponse
	if req.Recursive {
		resp.Entries, resp.Truncated, err = s.readdirRecursive(resolved, req)
	} else {
		resp.Entries, resp.Truncated, err = s.readdirFlat(resolved, req)
	}
	if err != nil {
		s.sendFsError(w, "fs.readdir", req.Path, err)
		return
	}

	slog.Debug("fs.readdir.completed", "path", req.Path, "count", len(resp.Entries), "truncated", resp.Truncated)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

// validateReaddirRequest validates and applies defaults to a readdir request.
func validateReaddirRequest(req *validation.FileReaddirRequest) error {
	if req.MaxEntries == 0 {
		req.MaxEntries = defaultMaxEntries
	}
	if req.MaxEntries < 0 || req.MaxEntries > maxMaxEntries {
		return fmt.Errorf("max_entries must be between 1 and %d", maxMaxEntries)
	}
	if req.Recursive && req.MaxDepth == 0 {
		// 0 means "unspecified" — default to max depth for recursive listing.
		req.MaxDepth = maxMaxDepth
	}
	if req.MaxDepth < 0 || req.MaxDepth > maxMaxDepth {
		return fmt.Errorf("max_depth must be between 1 and %d (or 0 for default)", maxMaxDepth)
	}
	for _, p := range req.IgnorePatterns {
		if _, err := filepath.Match(p, ""); err != nil {
			return fmt.Errorf("invalid ignore pattern %q: %w", p, err)
		}
	}
	return nil
}

// readdirFlat lists a single directory's entries with stat info.
func (s *Server) readdirFlat(
	resolved string,
	req validation.FileReaddirRequest,
) ([]validation.DirEntry, bool, error) {
	rawEntries, err := os.ReadDir(resolved)
	if err != nil {
		return nil, false, err
	}

	result := make([]validation.DirEntry, 0, len(rawEntries))
	for _, e := range rawEntries {
		if shouldSkipEntry(e.Name(), req) {
			continue
		}
		info, infoErr := e.Info()
		if infoErr != nil {
			continue // race: file deleted between readdir and stat
		}
		result = append(result, buildDirEntry(e.Name(), info))
		if len(result) >= req.MaxEntries {
			return result, true, nil
		}
	}
	return result, false, nil
}

// readdirRecursive walks a directory tree and returns enriched entries.
// Uses a manual DFS stack to control symlink validation per directory.
func (s *Server) readdirRecursive(
	rootDir string,
	req validation.FileReaddirRequest,
) ([]validation.DirEntry, bool, error) {
	type walkItem struct {
		absDir string // absolute path on disk
		relDir string // relative path from rootDir
		depth  int
	}

	sandboxDir := s.fsBaseDir()
	result := make([]validation.DirEntry, 0, min(req.MaxEntries, 256))
	stack := []walkItem{{absDir: rootDir, relDir: "", depth: 0}}

	for len(stack) > 0 {
		// Pop from stack (DFS)
		item := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		rawEntries, readErr := os.ReadDir(item.absDir)
		if readErr != nil {
			if item.depth > 0 && (os.IsPermission(readErr) || os.IsNotExist(readErr)) {
				continue // skip inaccessible/deleted subdirectories
			}
			return nil, false, readErr
		}

		// Collect subdirectories to push onto stack (in reverse for alphabetical DFS order)
		var subdirs []walkItem

		for _, e := range rawEntries {
			if shouldSkipEntry(e.Name(), req) {
				continue
			}

			info, infoErr := e.Info()
			if infoErr != nil {
				continue // race: file deleted between readdir and stat
			}

			relPath := e.Name()
			if item.relDir != "" {
				relPath = item.relDir + "/" + e.Name()
			}

			result = append(result, buildDirEntry(relPath, info))
			if len(result) >= req.MaxEntries {
				return result, true, nil
			}

			if info.IsDir() && item.depth < req.MaxDepth {
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

		// Push in reverse order so first dir is processed first (stack is LIFO)
		for i := len(subdirs) - 1; i >= 0; i-- {
			stack = append(stack, subdirs[i])
		}
	}

	return result, false, nil
}

// shouldSkipEntry returns true if an entry should be excluded from results.
func shouldSkipEntry(name string, req validation.FileReaddirRequest) bool {
	if !req.IncludeHidden && strings.HasPrefix(name, ".") {
		return true
	}
	return matchesAnyPattern(name, req.IgnorePatterns)
}

// matchesAnyPattern returns true if name matches any of the glob patterns.
func matchesAnyPattern(name string, patterns []string) bool {
	for _, p := range patterns {
		if matched, _ := filepath.Match(p, name); matched {
			return true
		}
	}
	return false
}

// buildDirEntry constructs a DirEntry from a name and file info.
func buildDirEntry(name string, info fs.FileInfo) validation.DirEntry {
	entry := validation.DirEntry{
		Name:      name,
		IsDir:     info.IsDir(),
		ModTimeMs: info.ModTime().UnixMilli(),
	}
	if !info.IsDir() {
		entry.Size = info.Size()
	}
	return entry
}

// isDirSafeToDescend checks if a directory is safe to recurse into
// by resolving symlinks and verifying the target stays within the sandbox.
func isDirSafeToDescend(absPath string, sandboxDir string) bool {
	realPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return false
	}
	realSandbox := sandboxDir
	if rb, evalErr := filepath.EvalSymlinks(sandboxDir); evalErr == nil {
		realSandbox = rb
	}
	return realPath == realSandbox || strings.HasPrefix(realPath, realSandbox+"/")
}

func (s *Server) handleFsMkdir(w http.ResponseWriter, r *http.Request) {
	var req validation.FileMkdirRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("fs.mkdir.start", "path", req.Path, "recursive", req.Recursive)

	if req.Recursive {
		err = os.MkdirAll(resolved, 0o750)
	} else {
		err = os.Mkdir(resolved, 0o750)
	}
	if err != nil {
		s.sendFsError(w, "fs.mkdir", req.Path, err)
		return
	}

	slog.Debug("fs.mkdir.completed", "path", req.Path)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleFsUnlink(w http.ResponseWriter, r *http.Request) {
	var req validation.FilePathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	slog.Debug("fs.unlink.start", "path", req.Path)

	if err := os.Remove(resolved); err != nil {
		s.sendFsError(w, "fs.unlink", req.Path, err)
		return
	}

	slog.Debug("fs.unlink.completed", "path", req.Path)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleFsRename(w http.ResponseWriter, r *http.Request) {
	var req validation.FileRenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolvedOld, err := validation.ValidateFilePath(req.OldPath, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", fmt.Sprintf("old_path: %s", err.Error()))
		return
	}

	resolvedNew, err := validation.ValidateFilePath(req.NewPath, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", fmt.Sprintf("new_path: %s", err.Error()))
		return
	}

	slog.Debug("fs.rename.start", "old_path", req.OldPath, "new_path", req.NewPath)

	if err := os.Rename(resolvedOld, resolvedNew); err != nil {
		s.sendFsError(w, "fs.rename", req.OldPath+" -> "+req.NewPath, err)
		return
	}

	slog.Debug("fs.rename.completed", "old_path", req.OldPath, "new_path", req.NewPath)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleFsExists(w http.ResponseWriter, r *http.Request) {
	var req validation.FilePathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	resolved, err := validation.ValidateFilePath(req.Path, s.fsBaseDir())
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	_, statErr := os.Stat(resolved)
	if statErr != nil && !os.IsNotExist(statErr) {
		// Real errors (permission denied, I/O failure) should not be masked as "not found"
		s.sendFsError(w, "fs.exists", req.Path, statErr)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(validation.FileExistsResponse{
		Exists: statErr == nil,
	}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

// Default ignored directories for grep operations. Do not modify at runtime.
var defaultIgnoredDirs = []string{
	"node_modules", ".git", ".svn", ".hg", "vendor", "dist", "build", "out",
	"target", ".next", ".nuxt", ".vscode", ".idea", ".cache", ".parcel-cache",
	"coverage", ".nyc_output", "__pycache__", ".pytest_cache", ".mypy_cache",
	"venv", ".turbo", ".pnpm", ".yarn", ".vite",
}

// Default blocked file extensions for grep operations. Do not modify at runtime.
var defaultBlockedExts = []string{
	".zip", ".tar", ".gz", ".rar", ".7z", ".bin", ".exe", ".dll", ".so", ".dylib",
	".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".eot",
	".db", ".sqlite", ".sqlite3", ".log",
}

const (
	defaultGrepMaxResults = 50
	maxGrepMaxResults     = 1000
	maxGrepContextLines   = 10

	rgTypeMatch   = "match"
	rgTypeContext = "context"
)

func (s *Server) handleFsGrep(w http.ResponseWriter, r *http.Request) {
	var req validation.FileGrepRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	if strings.TrimSpace(req.Query) == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "query cannot be empty")
		return
	}

	if req.MaxResults == 0 {
		req.MaxResults = defaultGrepMaxResults
	}
	if req.MaxResults < 1 || req.MaxResults > maxGrepMaxResults {
		s.sendError(w, http.StatusBadRequest, "validation_failed",
			fmt.Sprintf("max_results must be between 1 and %d", maxGrepMaxResults))
		return
	}

	if req.ContextLines < 0 {
		req.ContextLines = 0
	}
	if req.ContextLines > maxGrepContextLines {
		req.ContextLines = maxGrepContextLines
	}

	baseDir := s.fsBaseDir()

	// Resolve search paths
	var searchPaths []string
	if len(req.Paths) == 0 {
		searchPaths = []string{baseDir}
	} else {
		for _, p := range req.Paths {
			resolved, err := validation.ValidateFilePath(p, baseDir)
			if err != nil {
				s.sendError(w, http.StatusBadRequest, "validation_failed", fmt.Sprintf("path %q: %s", p, err.Error()))
				return
			}
			searchPaths = append(searchPaths, resolved)
		}
	}

	slog.Debug("fs.grep.start", "query", req.Query, "paths", searchPaths, "regex", req.Regex)

	// Build rg command args
	args := []string{"--json", "--sort", "path"}

	if !req.Regex {
		args = append(args, "-F")
	}
	if !req.CaseSensitive {
		args = append(args, "-i")
	}
	if req.ContextLines > 0 {
		args = append(args, "-C", strconv.Itoa(req.ContextLines))
	}

	// Default ignores
	if !req.NoDefaultIgnores {
		for _, dir := range defaultIgnoredDirs {
			args = append(args, "--glob", fmt.Sprintf("!%s", dir))
		}
		for _, ext := range defaultBlockedExts {
			args = append(args, "--glob", fmt.Sprintf("!*%s", ext))
		}
	}

	// Caller-provided patterns
	for _, p := range req.IncludePatterns {
		args = append(args, "--glob", p)
	}
	for _, p := range req.ExcludePatterns {
		args = append(args, "--glob", fmt.Sprintf("!%s", p))
	}

	// Query and search paths
	args = append(args, "--", req.Query)
	args = append(args, searchPaths...)

	resp, err := s.executeRipgrep(r.Context(), args, baseDir, req.MaxResults, req.ContextLines)
	if err != nil {
		var userErr *rgUserError
		if errors.As(err, &userErr) {
			slog.Warn("fs.grep.user_error", "error", err)
			s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
			return
		}
		slog.Error("fs.grep.failed", "error", err)
		s.sendError(w, http.StatusInternalServerError, "grep_failed", err.Error())
		return
	}

	slog.Debug("fs.grep.completed", "matches", len(resp.Matches), "total_files", resp.TotalFiles)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

// rgUserError indicates a user-input error from ripgrep (e.g., invalid regex or glob pattern).
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
	Path       rgText `json:"path"`
	Lines      rgText `json:"lines"`
	LineNumber int    `json:"line_number"`
}

// rgContextData represents the data field of a "context" type message.
type rgContextData struct {
	Path       rgText `json:"path"`
	Lines      rgText `json:"lines"`
	LineNumber int    `json:"line_number"`
}

// rgText represents a text field in ripgrep JSON output.
type rgText struct {
	Text string `json:"text"`
}

// executeRipgrep runs rg with the given args and parses the JSON output.
func (s *Server) executeRipgrep(
	ctx context.Context, args []string, baseDir string, maxResults int, contextLines int,
) (validation.FileGrepResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "rg", args...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	// rg exits 1 when no matches found, 2 for usage/pattern errors, other codes for internal errors
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			switch exitErr.ExitCode() {
			case 1:
				// No matches
				return validation.FileGrepResponse{
					Matches:    []validation.FileGrepMatch{},
					TotalFiles: 0,
				}, nil
			case 2:
				// Exit code 2: bad regex, invalid glob, or other user-input errors
				return validation.FileGrepResponse{}, &rgUserError{message: stderr.String()}
			}
		}
		return validation.FileGrepResponse{}, fmt.Errorf("rg failed: %s", stderr.String())
	}

	return parseRipgrepOutput(stdout.Bytes(), baseDir, maxResults, contextLines), nil
}

// rgLineEntry holds a parsed match or context line from ripgrep JSON output.
type rgLineEntry struct {
	msgType    string
	filePath   string
	lineNumber int
	lineText   string
}

// parseRipgrepOutput parses ripgrep JSON output into FileGrepResponse.
func parseRipgrepOutput(
	data []byte, baseDir string, maxResults int, contextLines int,
) validation.FileGrepResponse {
	var entries []rgLineEntry
	scanner := bufio.NewScanner(bytes.NewReader(data))
	// Increase scanner buffer for long lines
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

		switch msg.Type {
		case rgTypeMatch:
			var md rgMatchData
			if err := json.Unmarshal(msg.Data, &md); err != nil {
				continue
			}
			entries = append(entries, rgLineEntry{
				msgType:    rgTypeMatch,
				filePath:   md.Path.Text,
				lineNumber: md.LineNumber,
				lineText:   strings.TrimRight(md.Lines.Text, "\n\r"),
			})
		case rgTypeContext:
			var cd rgContextData
			if err := json.Unmarshal(msg.Data, &cd); err != nil {
				continue
			}
			entries = append(entries, rgLineEntry{
				msgType:    rgTypeContext,
				filePath:   cd.Path.Text,
				lineNumber: cd.LineNumber,
				lineText:   strings.TrimRight(cd.Lines.Text, "\n\r"),
			})
		}
	}

	// Second pass: build matches with context
	var matches []validation.FileGrepMatch
	filesSet := make(map[string]struct{})
	matchCount := 0

	for i, entry := range entries {
		if entry.msgType != rgTypeMatch {
			continue
		}
		if matchCount >= maxResults {
			break
		}

		relPath := entry.filePath
		if filepath.IsAbs(relPath) {
			if rel, err := filepath.Rel(baseDir, relPath); err == nil {
				relPath = rel
			}
		}
		filesSet[relPath] = struct{}{}

		match := validation.FileGrepMatch{
			File:     relPath,
			LineNum:  entry.lineNumber,
			LineText: entry.lineText,
		}

		if contextLines > 0 {
			match.ContextBefore = gatherContextBefore(entries, i, contextLines)
			match.ContextAfter = gatherContextAfter(entries, i, contextLines)
		}

		matches = append(matches, match)
		matchCount++
	}

	if matches == nil {
		matches = []validation.FileGrepMatch{}
	}

	return validation.FileGrepResponse{
		Matches:    matches,
		TotalFiles: len(filesSet),
	}
}

// gatherContextBefore collects context lines preceding the match at index i.
func gatherContextBefore(entries []rgLineEntry, i int, contextLines int) []string {
	entry := entries[i]
	var reversed []string
	for j := i - 1; j >= 0; j-- {
		ce := entries[j]
		if ce.filePath != entry.filePath || ce.msgType == rgTypeMatch {
			break
		}
		if ce.lineNumber < entry.lineNumber-contextLines {
			break
		}
		if ce.msgType == rgTypeContext && ce.lineNumber < entry.lineNumber {
			reversed = append(reversed, ce.lineText)
		}
	}
	// Reverse to get chronological order.
	for left, right := 0, len(reversed)-1; left < right; left, right = left+1, right-1 {
		reversed[left], reversed[right] = reversed[right], reversed[left]
	}
	return reversed
}

// gatherContextAfter collects context lines following the match at index i.
func gatherContextAfter(entries []rgLineEntry, i int, contextLines int) []string {
	entry := entries[i]
	var result []string
	for j := i + 1; j < len(entries); j++ {
		ce := entries[j]
		if ce.filePath != entry.filePath || ce.msgType == rgTypeMatch {
			break
		}
		if ce.lineNumber > entry.lineNumber+contextLines {
			break
		}
		if ce.msgType == rgTypeContext && ce.lineNumber > entry.lineNumber {
			result = append(result, ce.lineText)
		}
	}
	return result
}

// fsMaxBodyMiddleware limits request body size on /fs endpoints.
func fsMaxBodyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
		next.ServeHTTP(w, r)
	})
}

// sendFsError maps filesystem errors to appropriate HTTP status codes.
func (s *Server) sendFsError(w http.ResponseWriter, operation string, path string, err error) {
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
