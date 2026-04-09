package fileops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// standardEntries returns a typical directory tree for testing:
//
//	docs/
//	docs/guide.md
//	src/
//	src/app.ts
//	src/components/
//	src/components/Button.tsx
//	src/index.ts
//	README.md
func standardEntries() []supervisor.FSDirEntry {
	return []supervisor.FSDirEntry{
		{Name: "docs/", IsDir: true},
		{Name: "docs/guide.md", Size: 7},
		{Name: "src/", IsDir: true},
		{Name: "src/app.ts", Size: 13},
		{Name: "src/components/", IsDir: true},
		{Name: "src/components/Button.tsx", Size: 9},
		{Name: "src/index.ts", Size: 9},
		{Name: "README.md", Size: 8},
	}
}

// newDirListingTest creates a DirectoryListing wired to a mock supervisor that
// returns the given entries (and optional truncated flag).
func newDirListingTest(
	t *testing.T, entries []supervisor.FSDirEntry, truncated bool,
) (*DirectoryListing, *httptest.Server, context.Context) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSReaddirResponse{
			Entries:   entries,
			Truncated: truncated,
		})
	}))

	factory := supervisor.NewClientFactory()
	addr := "http://" + srv.Listener.Addr().String()
	ctx := tool.TestContextWithSupervisor("", addr)

	return NewDirectoryListing(factory), srv, ctx
}

// newDirListingTestWithHandler creates a DirectoryListing wired to a mock
// supervisor with a custom handler for request validation.
func newDirListingTestWithHandler(
	t *testing.T, handler http.HandlerFunc,
) (*DirectoryListing, *httptest.Server, context.Context) {
	t.Helper()
	srv := httptest.NewServer(handler)

	factory := supervisor.NewClientFactory()
	addr := "http://" + srv.Listener.Addr().String()
	ctx := tool.TestContextWithSupervisor("", addr)

	return NewDirectoryListing(factory), srv, ctx
}

func execDirListing(ctx context.Context, t *testing.T, dl tool.Tool, input map[string]any) string {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	require.NoError(t, dl.Execute(ctx, data, &stream))
	return stream.String()
}

func TestDirectoryListingRoot(t *testing.T) {
	dl, srv, ctx := newDirListingTest(t, standardEntries(), false)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{})
	assert.Contains(t, out, "src/")
	assert.Contains(t, out, "docs/")
	assert.Contains(t, out, "README.md")
}

func TestDirectoryListingSubdir(t *testing.T) {
	// When a subdir is requested, the supervisor returns entries relative to that subdir.
	entries := []supervisor.FSDirEntry{
		{Name: "components/", IsDir: true},
		{Name: "components/Button.tsx", Size: 9},
		{Name: "app.ts", Size: 13},
		{Name: "index.ts", Size: 9},
	}
	dl, srv, ctx := newDirListingTest(t, entries, false)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{"path": "src"})
	assert.Contains(t, out, "components/")
	assert.Contains(t, out, "index.ts")
	assert.Contains(t, out, "app.ts")
}

func TestDirectoryListingPattern(t *testing.T) {
	dl, srv, ctx := newDirListingTest(t, standardEntries(), false)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{"pattern": "*.md"})
	assert.Contains(t, out, "README.md")
	// Non-matching files should be filtered out.
	assert.NotContains(t, out, "index.ts")
}

func TestDirectoryListingDirectoriesOnly(t *testing.T) {
	dl, srv, ctx := newDirListingTest(t, standardEntries(), false)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{"directoriesOnly": true})
	assert.Contains(t, out, "src/")
	assert.Contains(t, out, "docs/")
	assert.NotContains(t, out, "README.md")
}

func TestDirectoryListingMaxDepth(t *testing.T) {
	// Supervisor handles maxDepth; simulate it returning only depth-1 entries.
	entries := []supervisor.FSDirEntry{
		{Name: "docs/", IsDir: true},
		{Name: "src/", IsDir: true},
		{Name: "README.md", Size: 8},
	}
	dl, srv, ctx := newDirListingTest(t, entries, false)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{"maxDepth": 1})
	assert.Contains(t, out, "src/")
	assert.Contains(t, out, "README.md")
	// Components dir is at depth 2, should not appear.
	assert.NotContains(t, out, "components")
	assert.NotContains(t, out, "Button.tsx")
}

func TestDirectoryListingShowHidden(t *testing.T) {
	entries := append(standardEntries(),
		supervisor.FSDirEntry{Name: ".hidden/", IsDir: true},
		supervisor.FSDirEntry{Name: ".hidden/secret.txt", Size: 6},
	)
	dl, srv, ctx := newDirListingTest(t, entries, false)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{"showHidden": true})
	assert.Contains(t, out, ".hidden/")
}

func TestDirectoryListingIgnoresNodeModules(t *testing.T) {
	// The ignore patterns are sent to the supervisor, so node_modules entries
	// should not appear in the response. Verify the request includes them.
	dl, srv, ctx := newDirListingTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSReaddirRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.Contains(t, req.IgnorePatterns, "node_modules")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSReaddirResponse{
			Entries: standardEntries(),
		})
	})
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{})
	assert.NotContains(t, out, "node_modules")
}

func TestDirectoryListingSearch(t *testing.T) {
	dl, srv, ctx := newDirListingTest(t, standardEntries(), false)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{"search": "button"})
	assert.Contains(t, out, "Button.tsx")
}

func TestDirectoryListingToolMetadata(t *testing.T) {
	factory := supervisor.NewClientFactory()
	dl := NewDirectoryListing(factory)

	assert.Equal(t, "directoryListing", dl.Name())
	assert.NotEmpty(t, dl.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(dl.InputSchema(), &schema))
	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "path")
	assert.Contains(t, props, "pattern")
	assert.Contains(t, props, "maxDepth")
}

func TestDirectoryListingMissingScope(t *testing.T) {
	factory := supervisor.NewClientFactory()
	dl := NewDirectoryListing(factory)

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{})
	err := dl.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}

func TestDirectoryListingTruncated(t *testing.T) {
	dl, srv, ctx := newDirListingTest(t, standardEntries(), true)
	defer srv.Close()

	out := execDirListing(ctx, t, dl, map[string]any{})
	assert.Contains(t, out, "truncated")
}

func TestDirectoryListingSendsCorrectRequest(t *testing.T) {
	dl, srv, ctx := newDirListingTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSReaddirRequest
		json.NewDecoder(r.Body).Decode(&req)

		assert.Equal(t, "src", req.Path)
		assert.True(t, req.Recursive)
		assert.Equal(t, 2, req.MaxDepth)
		assert.Equal(t, maxEntries, req.MaxEntries)
		assert.True(t, req.IncludeHidden)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSReaddirResponse{
			Entries: []supervisor.FSDirEntry{
				{Name: "index.ts", Size: 9},
			},
		})
	})
	defer srv.Close()

	execDirListing(ctx, t, dl, map[string]any{
		"path":       "src",
		"maxDepth":   2,
		"showHidden": true,
	})
}
