package search

import (
	"context"
	"testing"
	"time"
)

type mockLLM struct {
	response string
	err      error
	delay    time.Duration
}

func (m *mockLLM) Complete(ctx context.Context, _, _ string, _ int) (string, error) {
	if m.delay > 0 {
		select {
		case <-time.After(m.delay):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	return m.response, m.err
}

func TestHypothesize_ReturnsDocument(t *testing.T) {
	hypo := "To make your website visible, use the publishClient tool to deploy to production. This builds your app and creates a live URL."
	rw := NewQueryRewriter(&mockLLM{response: hypo}, 2000, 150)

	result := rw.Hypothesize(context.Background(), "make people see my website")
	if result != hypo {
		t.Errorf("got %q, want %q", result, hypo)
	}
}

func TestHypothesize_TrimsWhitespace(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{response: "  some document content  \n"}, 2000, 150)

	result := rw.Hypothesize(context.Background(), "query")
	if result != "some document content" {
		t.Errorf("got %q, want trimmed content", result)
	}
}

func TestHypothesize_EmptyOnError(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{err: context.DeadlineExceeded}, 2000, 150)

	result := rw.Hypothesize(context.Background(), "deploy my site")
	if result != "" {
		t.Errorf("expected empty on error, got %q", result)
	}
}

func TestHypothesize_EmptyOnTimeout(t *testing.T) {
	rw := NewQueryRewriter(
		&mockLLM{response: "slow response", delay: 2 * time.Second},
		100, 150,
	)

	result := rw.Hypothesize(context.Background(), "original query")
	if result != "" {
		t.Errorf("expected empty on timeout, got %q", result)
	}
}

func TestHypothesize_EmptyOnBlankResponse(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{response: "   \n  "}, 2000, 150)

	result := rw.Hypothesize(context.Background(), "some query")
	if result != "" {
		t.Errorf("expected empty on blank response, got %q", result)
	}
}

func TestGenerateMultiQueries_ValidResponse(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{response: "how to publish a site\nhow to deploy my app\nlaunch website to production"}, 2000, 150)

	queries := rw.GenerateMultiQueries(context.Background(), "make people see my website", 3)
	if len(queries) != 3 {
		t.Errorf("expected 3 queries, got %d", len(queries))
	}
}

func TestGenerateMultiQueries_StripsNumbering(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{response: "1. deploy my app\n2. publish the site\n3) launch to production"}, 2000, 150)

	queries := rw.GenerateMultiQueries(context.Background(), "original query", 3)
	if len(queries) != 3 {
		t.Fatalf("expected 3 queries, got %d", len(queries))
	}
	if queries[0] != "deploy my app" {
		t.Errorf("expected stripped query, got %q", queries[0])
	}
}

func TestGenerateMultiQueries_ExcludesOriginal(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{response: "deploy my site\noriginal query\npublish the app"}, 2000, 150)

	queries := rw.GenerateMultiQueries(context.Background(), "original query", 3)
	for _, q := range queries {
		if q == "original query" {
			t.Error("expected original query to be excluded")
		}
	}
}

func TestGenerateMultiQueries_ErrorReturnsNil(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{err: context.DeadlineExceeded}, 2000, 150)

	queries := rw.GenerateMultiQueries(context.Background(), "some query", 3)
	if queries != nil {
		t.Errorf("expected nil on error, got %v", queries)
	}
}

func TestGenerateMultiQueries_TimeoutReturnsNil(t *testing.T) {
	rw := NewQueryRewriter(
		&mockLLM{response: "slow response", delay: 2 * time.Second},
		100, 150,
	)

	queries := rw.GenerateMultiQueries(context.Background(), "query", 3)
	if queries != nil {
		t.Errorf("expected nil on timeout, got %v", queries)
	}
}

func TestGenerateMultiQueries_BlankReturnsNil(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{response: "   \n  "}, 2000, 150)

	queries := rw.GenerateMultiQueries(context.Background(), "query", 3)
	if queries != nil {
		t.Errorf("expected nil on blank, got %v", queries)
	}
}

func TestGenerateMultiQueries_LimitsCount(t *testing.T) {
	rw := NewQueryRewriter(&mockLLM{response: "query one\nquery two\nquery three\nquery four\nquery five"}, 2000, 150)

	queries := rw.GenerateMultiQueries(context.Background(), "original", 2)
	if len(queries) != 2 {
		t.Errorf("expected 2 queries (limited by count), got %d", len(queries))
	}
}
