package supervisor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFSReadSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fs/read", r.URL.Path)
		var req FSReadRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "src/main.go", req.Path)
		assert.Equal(t, "utf-8", req.Encoding)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(FSReadResponse{
			Content:   "package main\n",
			Size:      13,
			TotalSize: 13,
			Encoding:  "utf-8",
		})
	})
	defer srv.Close()

	resp, err := client.FSRead(context.Background(), FSReadRequest{
		Path:     "src/main.go",
		Encoding: "utf-8",
	})
	require.NoError(t, err)
	assert.Equal(t, "package main\n", resp.Content)
	assert.Equal(t, int64(13), resp.TotalSize)
}

func TestFSReadNotFound(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(apiError{Error: "not_found", Message: "file does not exist"})
	})
	defer srv.Close()

	_, err := client.FSRead(context.Background(), FSReadRequest{Path: "missing.txt"})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestFSWriteSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fs/write", r.URL.Path)
		var req FSWriteRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "out.txt", req.Path)
		assert.Equal(t, "hello\n", req.Content)
		assert.True(t, req.MkdirP)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(FSWriteResponse{BytesWritten: 6})
	})
	defer srv.Close()

	resp, err := client.FSWrite(context.Background(), FSWriteRequest{
		Path:    "out.txt",
		Content: "hello\n",
		MkdirP:  true,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(6), resp.BytesWritten)
}

func TestFSStatSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fs/stat", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(FSStatResponse{
			Size:        1024,
			IsDir:       false,
			IsFile:      true,
			Permissions: "0644",
		})
	})
	defer srv.Close()

	resp, err := client.FSStat(context.Background(), FSStatRequest{Path: "file.txt"})
	require.NoError(t, err)
	assert.Equal(t, int64(1024), resp.Size)
	assert.True(t, resp.IsFile)
	assert.False(t, resp.IsDir)
	assert.Equal(t, "0644", resp.Permissions)
}

func TestFSReaddirSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fs/readdir", r.URL.Path)
		var req FSReaddirRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.True(t, req.Recursive)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(FSReaddirResponse{
			Entries: []FSDirEntry{
				{Name: "src", IsDir: true},
				{Name: "src/main.go", IsDir: false, Size: 100},
			},
			Truncated: false,
		})
	})
	defer srv.Close()

	resp, err := client.FSReaddir(context.Background(), FSReaddirRequest{
		Path:      ".",
		Recursive: true,
	})
	require.NoError(t, err)
	assert.Len(t, resp.Entries, 2)
	assert.True(t, resp.Entries[0].IsDir)
	assert.False(t, resp.Truncated)
}

func TestFSMkdirSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fs/mkdir", r.URL.Path)
		var req FSMkdirRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "a/b/c", req.Path)
		assert.True(t, req.Recursive)

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	defer srv.Close()

	err := client.FSMkdir(context.Background(), FSMkdirRequest{
		Path:      "a/b/c",
		Recursive: true,
	})
	require.NoError(t, err)
}

func TestFSExistsSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(FSExistsResponse{Exists: true})
	})
	defer srv.Close()

	resp, err := client.FSExists(context.Background(), FSExistsRequest{Path: "file.txt"})
	require.NoError(t, err)
	assert.True(t, resp.Exists)
}

func TestFSGrepSuccess(t *testing.T) {
	t.Parallel()
	srv, client := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fs/grep", r.URL.Path)
		var req FSGrepRequest
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "hello", req.Query)
		assert.False(t, req.CaseSensitive)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(FSGrepResponse{
			Matches: []FSGrepMatch{
				{File: "main.go", LineNum: 5, LineText: `fmt.Println("hello")`},
			},
			TotalFiles: 1,
		})
	})
	defer srv.Close()

	resp, err := client.FSGrep(context.Background(), FSGrepRequest{Query: "hello"})
	require.NoError(t, err)
	assert.Len(t, resp.Matches, 1)
	assert.Equal(t, "main.go", resp.Matches[0].File)
	assert.Equal(t, 1, resp.TotalFiles)
}

func TestFSErrorClassification(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		status     int
		body       string
		wantErr    error
		wantSubstr string
	}{
		{
			name:       "403 forbidden",
			status:     http.StatusForbidden,
			body:       `{"error":"permission_denied","message":"access denied"}`,
			wantErr:    ErrPermissionDenied,
			wantSubstr: "access denied",
		},
		{
			name:       "400 validation",
			status:     http.StatusBadRequest,
			body:       `{"error":"validation_failed","message":"path is required"}`,
			wantErr:    ErrValidation,
			wantSubstr: "path is required",
		},
		{
			name:       "413 too large",
			status:     http.StatusRequestEntityTooLarge,
			body:       `{"error":"too_large","message":"body exceeds limit"}`,
			wantErr:    ErrTooLarge,
			wantSubstr: "body exceeds limit",
		},
		{
			name:       "500 generic",
			status:     http.StatusInternalServerError,
			body:       `{"error":"internal","message":"disk full"}`,
			wantSubstr: "status 500",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				w.Write([]byte(tt.body))
			}))
			defer srv.Close()
			client := NewTestClient(srv)

			_, err := client.FSRead(context.Background(), FSReadRequest{Path: "test"})
			require.Error(t, err)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
			}
			assert.Contains(t, err.Error(), tt.wantSubstr)
		})
	}
}
