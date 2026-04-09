package grep

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

// newGrepTest creates a Search tool wired to a mock supervisor that returns
// the given response for /fs/grep requests.
func newGrepTest(t *testing.T, resp supervisor.FSGrepResponse) (*Search, *httptest.Server, context.Context) {
	t.Helper()
	return newGrepTestWithHandler(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})
}

func newGrepTestWithHandler(t *testing.T, handler http.HandlerFunc) (*Search, *httptest.Server, context.Context) {
	t.Helper()
	srv := httptest.NewServer(handler)
	factory := supervisor.NewClientFactory()
	addr := "http://" + srv.Listener.Addr().String()
	ctx := tool.TestContextWithSupervisor("", addr)
	return NewSearch(factory), srv, ctx
}

func execGrep(ctx context.Context, t *testing.T, g tool.Tool, input map[string]any) (string, error) {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	execErr := g.Execute(ctx, data, &stream)
	return stream.String(), execErr
}

func TestGrepLiteralSearch(t *testing.T) {
	g, srv, ctx := newGrepTest(t, supervisor.FSGrepResponse{
		Matches: []supervisor.FSGrepMatch{
			{File: "src/main.go", LineNum: 6, LineText: `fmt.Println("hello world")`},
			{File: "docs/README.md", LineNum: 2, LineText: "This is a hello world project."},
		},
		TotalFiles: 2,
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "hello"})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go")
	assert.Contains(t, out, "hello world")
	assert.Contains(t, out, "docs/README.md")
	assert.Contains(t, out, "Found 2 matches across 2 files")
}

func TestGrepRegexSearch(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.True(t, req.Regex)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches: []supervisor.FSGrepMatch{
				{File: "src/main.go", LineNum: 5, LineText: "func main() {"},
				{File: "src/util.go", LineNum: 3, LineText: "func add(a, b int) int {"},
			},
			TotalFiles: 2,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query": "func \\w+\\(",
		"regex": true,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "func main(")
	assert.Contains(t, out, "func add(")
}

func TestGrepCaseInsensitive(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.False(t, req.CaseSensitive)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches: []supervisor.FSGrepMatch{
				{File: "src/main.go", LineNum: 6, LineText: `fmt.Println("hello world")`},
			},
			TotalFiles: 1,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":         "HELLO",
		"caseSensitive": false,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "hello world")
}

func TestGrepCaseSensitive(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.True(t, req.CaseSensitive)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches:    []supervisor.FSGrepMatch{},
			TotalFiles: 0,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":         "HELLO",
		"caseSensitive": true,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "No matches found")
}

func TestGrepContextLines(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.Equal(t, 1, req.ContextLines)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches: []supervisor.FSGrepMatch{
				{
					File:          "src/main.go",
					LineNum:       6,
					LineText:      `fmt.Println("hello")`,
					ContextBefore: []string{"func main() {"},
					ContextAfter:  []string{"}"},
				},
			},
			TotalFiles: 1,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":        "Println",
		"contextLines": 1,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "fmt.Println")
	assert.Contains(t, out, "func main()")
}

func TestGrepMaxResults(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.Equal(t, 1, req.MaxResults)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches: []supervisor.FSGrepMatch{
				{File: "src/main.go", LineNum: 5, LineText: "func main() {"},
			},
			TotalFiles: 1,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":      "func",
		"maxResults": 1,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "Found 1 matches")
}

func TestGrepIncludePatterns(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.Equal(t, []string{"*.go"}, req.IncludePatterns)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches: []supervisor.FSGrepMatch{
				{File: "src/main.go", LineNum: 6, LineText: `fmt.Println("hello world")`},
			},
			TotalFiles: 1,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":           "hello",
		"includePatterns": []string{"*.go"},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go")
	assert.NotContains(t, out, "README.md")
}

func TestGrepExcludePatterns(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		// Should contain both blocked extensions and user-provided excludes.
		assert.Contains(t, req.ExcludePatterns, "*.md")
		assert.Contains(t, req.ExcludePatterns, "*.log")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches: []supervisor.FSGrepMatch{
				{File: "src/main.go", LineNum: 6, LineText: `fmt.Println("hello world")`},
			},
			TotalFiles: 1,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":           "hello",
		"excludePatterns": []string{"*.md"},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go")
}

func TestGrepPathFilter(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		assert.Equal(t, []string{"docs/"}, req.Paths)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches: []supervisor.FSGrepMatch{
				{File: "docs/README.md", LineNum: 2, LineText: "hello world project"},
			},
			TotalFiles: 1,
		})
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query": "hello",
		"paths": []string{"docs/"},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "docs/README.md")
	assert.NotContains(t, out, "src/main.go")
}

func TestGrepNoResults(t *testing.T) {
	g, srv, ctx := newGrepTest(t, supervisor.FSGrepResponse{
		Matches:    []supervisor.FSGrepMatch{},
		TotalFiles: 0,
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "nonexistent_string_xyz"})
	require.NoError(t, err)
	assert.Contains(t, out, "No matches found")
}

func TestGrepToolMetadata(t *testing.T) {
	factory := supervisor.NewClientFactory()
	g := NewSearch(factory)

	assert.Equal(t, "grepSearch", g.Name())
	assert.NotEmpty(t, g.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(g.InputSchema(), &schema))
	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "query")
	assert.Contains(t, props, "regex")
	assert.Contains(t, props, "caseSensitive")
}

func TestGrepGroupedByFile(t *testing.T) {
	g, srv, ctx := newGrepTest(t, supervisor.FSGrepResponse{
		Matches: []supervisor.FSGrepMatch{
			{File: "src/main.go", LineNum: 5, LineText: "func main() {"},
			{File: "src/util.go", LineNum: 3, LineText: "func add(a, b int) int {"},
			{File: "src/util.go", LineNum: 7, LineText: "func multiply(a, b int) int {"},
		},
		TotalFiles: 2,
	})
	defer srv.Close()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "func"})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go:")
	assert.Contains(t, out, "src/util.go:")
}

func TestGrepBlockedExtensionsSentAsExcludes(t *testing.T) {
	g, srv, ctx := newGrepTestWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req supervisor.FSGrepRequest
		json.NewDecoder(r.Body).Decode(&req)
		// Agent should send blocked extensions as exclude patterns.
		assert.Contains(t, req.ExcludePatterns, "*.log")
		assert.Contains(t, req.ExcludePatterns, "*.db")
		assert.Contains(t, req.ExcludePatterns, "*.png")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(supervisor.FSGrepResponse{
			Matches:    []supervisor.FSGrepMatch{},
			TotalFiles: 0,
		})
	})
	defer srv.Close()

	_, err := execGrep(ctx, t, g, map[string]any{"query": "test"})
	require.NoError(t, err)
}

func TestGrepBlockedPathsRejected(t *testing.T) {
	g, srv, ctx := newGrepTest(t, supervisor.FSGrepResponse{})
	defer srv.Close()

	_, err := execGrep(ctx, t, g, map[string]any{
		"query": "test",
		"paths": []string{"node_modules/pkg"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestGrepMissingScope(t *testing.T) {
	factory := supervisor.NewClientFactory()
	g := NewSearch(factory)

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"query": "test"})
	err := g.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}
