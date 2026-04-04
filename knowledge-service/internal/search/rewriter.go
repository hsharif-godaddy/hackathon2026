package search

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
)

// HyDE (Hypothetical Document Embeddings) prompt. The LLM generates a short
// knowledge-base-style passage that would answer the user's question. We then
// embed this passage instead of the raw query, which bridges the vocabulary
// gap between conversational questions and technical documentation.
const hydeSystemPrompt = `You are a technical documentation writer for Airo, an AI-powered web application builder.

Given a user question, write a 3-5 sentence knowledge base passage that directly answers it. Write as if excerpting from Airo's official documentation:
- Use precise technical terms: "publish", "deploy", "preview", "agent", "component", "template", "domain", "build"
- Reference concrete Airo tools and concepts where relevant
- Use present tense, imperative mood ("To deploy, click..." not "You would deploy by...")
- Include configuration details, file paths, or API endpoints if applicable

Do NOT answer the question conversationally. Write what the documentation WOULD say.

Output only the passage, nothing else.`

const multiQuerySystemPrompt = `You are a search query expansion assistant for Airo, an AI-powered web application builder.

Given a user query, generate alternative search queries that would help find relevant documentation. Each alternative should:
- Rephrase using different terminology (e.g., "deploy" ↔ "publish", "website" ↔ "site" ↔ "app")
- Focus on a different aspect of the question
- Use vocabulary that would appear in technical documentation

Output exactly one query per line. No numbering, bullets, or explanation.`

var lineNumberingRe = regexp.MustCompile(`^\s*\d+[\.\)]\s*`)

type llmCompleter interface {
	Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error)
}

// QueryRewriter uses HyDE (Hypothetical Document Embeddings) to generate a
// hypothetical knowledge base document for a user query. The hypothetical
// document is embedded and used for vector search alongside the original
// query, bridging the vocabulary gap between conversational questions
// and technical documentation.
type QueryRewriter struct {
	llm       llmCompleter
	timeoutMs int
	maxTokens int
}

func NewQueryRewriter(llm llmCompleter, timeoutMs, maxTokens int) *QueryRewriter {
	return &QueryRewriter{
		llm:       llm,
		timeoutMs: timeoutMs,
		maxTokens: maxTokens,
	}
}

// Hypothesize generates a hypothetical knowledge base document that would
// answer the user's query. The returned text is meant to be embedded and
// used for vector search — its vocabulary will be closer to the indexed
// documents than the raw user query. Returns "" on failure or timeout.
func (qr *QueryRewriter) Hypothesize(ctx context.Context, query string) string {
	timeout := time.Duration(qr.timeoutMs) * time.Millisecond
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	doc, err := qr.llm.Complete(ctx, hydeSystemPrompt, query, qr.maxTokens)
	if err != nil {
		slog.Warn("search.hyde.failed", "query", query, "error", err)
		return ""
	}

	doc = strings.TrimSpace(doc)
	if doc == "" {
		return ""
	}

	slog.Info("search.hyde.complete", "query", query, "hydeLength", len(doc))
	return doc
}

// GenerateMultiQueries generates alternative search queries for the given
// query. Returns nil on failure so callers can gracefully degrade.
func (qr *QueryRewriter) GenerateMultiQueries(ctx context.Context, query string, count int) []string {
	timeout := time.Duration(qr.timeoutMs) * time.Millisecond
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	userPrompt := fmt.Sprintf("Generate %d alternative queries for:\n%s", count, query)
	resp, err := qr.llm.Complete(ctx, multiQuerySystemPrompt, userPrompt, qr.maxTokens)
	if err != nil {
		slog.Warn("search.multiquery.failed", "query", query, "error", err)
		return nil
	}

	resp = strings.TrimSpace(resp)
	if resp == "" {
		return nil
	}

	queryLower := strings.ToLower(strings.TrimSpace(query))
	var queries []string
	for _, line := range strings.Split(resp, "\n") {
		line = strings.TrimSpace(line)
		line = lineNumberingRe.ReplaceAllString(line, "")
		line = strings.TrimPrefix(line, "- ")
		line = strings.TrimSpace(line)
		if line == "" || strings.ToLower(line) == queryLower {
			continue
		}
		queries = append(queries, line)
		if len(queries) >= count {
			break
		}
	}

	if len(queries) == 0 {
		return nil
	}

	slog.Info("search.multiquery.complete", "query", query, "variants", len(queries))
	return queries
}
