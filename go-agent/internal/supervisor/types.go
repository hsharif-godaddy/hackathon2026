package supervisor

// FSReadRequest is the request body for POST /fs/read.
type FSReadRequest struct {
	Path     string `json:"path"`
	Encoding string `json:"encoding,omitempty"` // "utf-8" or "base64", defaults to base64
	Offset   int64  `json:"offset,omitempty"`
	Length   int64  `json:"length,omitempty"` // 0 = entire file
}

// FSReadResponse is the response body from POST /fs/read.
type FSReadResponse struct {
	Content   string `json:"content"`
	Size      int64  `json:"size"`       // bytes in response
	TotalSize int64  `json:"total_size"` // actual file size
	Encoding  string `json:"encoding"`
}

// FSWriteRequest is the request body for POST /fs/write.
type FSWriteRequest struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding,omitempty"` // "utf-8" (default) or "base64"
	Mode     int    `json:"mode,omitempty"`     // file permissions, default 0644
	MkdirP   bool   `json:"mkdir_p,omitempty"`  // create parent dirs
}

// FSWriteResponse is the response body from POST /fs/write.
type FSWriteResponse struct {
	BytesWritten int64 `json:"bytes_written"`
}

// FSStatRequest is the request body for POST /fs/stat.
type FSStatRequest struct {
	Path string `json:"path"`
}

// FSStatResponse is the response body from POST /fs/stat.
type FSStatResponse struct {
	Size        int64  `json:"size"`
	IsDir       bool   `json:"is_dir"`
	IsFile      bool   `json:"is_file"`
	ModTimeMs   int64  `json:"mod_time_ms"`
	ModTime     string `json:"mod_time"`
	Permissions string `json:"permissions"` // octal e.g. "0644"
}

// FSReaddirRequest is the request body for POST /fs/readdir.
type FSReaddirRequest struct {
	Path           string   `json:"path"`
	Recursive      bool     `json:"recursive,omitempty"`
	MaxDepth       int      `json:"max_depth,omitempty"`   // default 100 when recursive
	MaxEntries     int      `json:"max_entries,omitempty"` // default 1000, max 10000
	IgnorePatterns []string `json:"ignore_patterns,omitempty"`
	IncludeHidden  bool     `json:"include_hidden,omitempty"`
}

// FSDirEntry represents a single directory entry.
type FSDirEntry struct {
	Name      string `json:"name"`
	IsDir     bool   `json:"is_dir"`
	Size      int64  `json:"size,omitempty"`
	ModTimeMs int64  `json:"mod_time_ms"`
}

// FSReaddirResponse is the response body from POST /fs/readdir.
type FSReaddirResponse struct {
	Entries   []FSDirEntry `json:"entries"`
	Truncated bool         `json:"truncated,omitempty"`
}

// FSMkdirRequest is the request body for POST /fs/mkdir.
type FSMkdirRequest struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive,omitempty"`
}

// FSExistsRequest is the request body for POST /fs/exists.
type FSExistsRequest struct {
	Path string `json:"path"`
}

// FSExistsResponse is the response body from POST /fs/exists.
type FSExistsResponse struct {
	Exists bool `json:"exists"`
}

// FSGrepRequest is the request body for POST /fs/grep.
type FSGrepRequest struct {
	Query            string   `json:"query"`
	Paths            []string `json:"paths,omitempty"`
	Regex            bool     `json:"regex,omitempty"`
	CaseSensitive    bool     `json:"case_sensitive,omitempty"`
	ContextLines     int      `json:"context_lines,omitempty"`
	MaxResults       int      `json:"max_results,omitempty"` // default 50
	IncludePatterns  []string `json:"include_patterns,omitempty"`
	ExcludePatterns  []string `json:"exclude_patterns,omitempty"`
	NoDefaultIgnores bool     `json:"no_default_ignores,omitempty"` // disable built-in ignores
}

// FSGrepMatch represents a single grep match.
type FSGrepMatch struct {
	File          string   `json:"file"`
	LineNum       int      `json:"line_num"`
	LineText      string   `json:"line_text"`
	ContextBefore []string `json:"context_before,omitempty"`
	ContextAfter  []string `json:"context_after,omitempty"`
}

// FSGrepResponse is the response body from POST /fs/grep.
type FSGrepResponse struct {
	Matches    []FSGrepMatch `json:"matches"`
	TotalFiles int           `json:"total_files"`
}
