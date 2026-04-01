package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
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
		req.MaxDepth = maxMaxDepth
	}
	if req.MaxDepth < 0 || req.MaxDepth > maxMaxDepth {
		return fmt.Errorf("max_depth must be between 0 and %d", maxMaxDepth)
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
