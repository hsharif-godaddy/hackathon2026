package validation

// ProcessStartRequest represents a request to start a process
type ProcessStartRequest struct {
	Command    string            `json:"command"`
	Env        map[string]string `json:"env,omitempty"`
	WorkingDir string            `json:"working_dir,omitempty"`
	Ports      []int             `json:"ports,omitempty"` // Explicit port specification
}

// CommandRequest represents a request to execute a command
type CommandRequest struct {
	Command       string `json:"command"`
	Timeout       int    `json:"timeout,omitempty"`
	CaptureOutput bool   `json:"capture_output,omitempty"`
	WorkingDir    string `json:"working_dir,omitempty"`
}

// EnvironmentSetRequest represents a request to set environment variables
type EnvironmentSetRequest struct {
	Variables      map[string]string `json:"variables"`
	RestartProcess bool              `json:"restart_process,omitempty"`
}

// FileReadRequest represents a request to read a file
type FileReadRequest struct {
	Path     string `json:"path"`
	Encoding string `json:"encoding,omitempty"` // "utf-8" for text, "" for base64
	Offset   int64  `json:"offset,omitempty"`   // byte offset for partial reads
	Length   int64  `json:"length,omitempty"`   // max bytes (0 = entire file)
}

// FileWriteRequest represents a request to write a file
type FileWriteRequest struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding,omitempty"` // "utf-8" (default) or "base64"
	Mode     int    `json:"mode,omitempty"`     // file permissions (default 0644)
	MkdirP   bool   `json:"mkdir_p,omitempty"`  // create parent dirs
}

// FilePathRequest is used for operations that only need a path
type FilePathRequest struct {
	Path string `json:"path"`
}

// FileReaddirRequest represents a request to list directory entries.
type FileReaddirRequest struct {
	Path           string   `json:"path"`
	Recursive      bool     `json:"recursive,omitempty"`
	MaxDepth       int      `json:"max_depth,omitempty"`       // 0 = default (100 when recursive, ignored otherwise)
	MaxEntries     int      `json:"max_entries,omitempty"`     // default 1000, max 10000
	IgnorePatterns []string `json:"ignore_patterns,omitempty"` // filepath.Match globs
	IncludeHidden  bool     `json:"include_hidden,omitempty"`
}

// FileRenameRequest represents a rename/move operation
type FileRenameRequest struct {
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
}

// FileMkdirRequest represents a directory creation request
type FileMkdirRequest struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive,omitempty"`
}

// FileReadResponse is the response for /fs/read
type FileReadResponse struct {
	Content   string `json:"content"`
	Size      int64  `json:"size"`       // bytes returned in this response
	TotalSize int64  `json:"total_size"` // actual file size on disk
	Encoding  string `json:"encoding"`   // "utf-8" or "base64"
}

// FileStatResponse is the response for /fs/stat
type FileStatResponse struct {
	Size        int64  `json:"size"`
	IsDir       bool   `json:"is_dir"`
	IsFile      bool   `json:"is_file"`
	ModTimeMs   int64  `json:"mod_time_ms"`
	ModTime     string `json:"mod_time"` // ISO 8601
	Permissions string `json:"permissions"`
}

// DirEntry represents a single directory entry with stat info.
type DirEntry struct {
	Name      string `json:"name"`
	IsDir     bool   `json:"is_dir"`
	Size      int64  `json:"size,omitempty"` // file size in bytes (files only)
	ModTimeMs int64  `json:"mod_time_ms"`
}

// FileReaddirResponse is the response for /fs/readdir
type FileReaddirResponse struct {
	Entries   []DirEntry `json:"entries"`
	Truncated bool       `json:"truncated,omitempty"`
}

// FileExistsResponse is the response for /fs/exists
type FileExistsResponse struct {
	Exists bool `json:"exists"`
}

// FileWriteResponse is the response for /fs/write
type FileWriteResponse struct {
	BytesWritten int64 `json:"bytes_written"`
}
