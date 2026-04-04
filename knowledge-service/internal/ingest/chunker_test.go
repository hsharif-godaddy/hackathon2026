package ingest

import (
	"strings"
	"testing"
)

func TestChunkMarkdown_SingleH1(t *testing.T) {
	content := "# Getting Started\n\nThis is the getting started guide.\nIt has multiple lines."
	chunks := ChunkMarkdown("docs", content, []string{"guide"}, 10, 0, 0)

	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].SectionPath != "Getting Started" {
		t.Errorf("expected sectionPath 'Getting Started', got %q", chunks[0].SectionPath)
	}
	if chunks[0].DocName != "docs" {
		t.Errorf("expected docName 'docs', got %q", chunks[0].DocName)
	}
	if chunks[0].ChunkIndex != 0 {
		t.Errorf("expected chunkIndex 0, got %d", chunks[0].ChunkIndex)
	}
	if chunks[0].ContentHash == "" {
		t.Error("expected non-empty contentHash")
	}
	if len(chunks[0].Tags) != 1 || chunks[0].Tags[0] != "guide" {
		t.Errorf("expected tags [guide], got %v", chunks[0].Tags)
	}
}

func TestChunkMarkdown_MultipleH1H2(t *testing.T) {
	content := `# Deployment

Overview of deployment options.

## Vercel

Deploy to Vercel with one click. This section covers all the steps needed.

## AWS

Deploy to AWS using CloudFormation. Detailed instructions follow here.`

	chunks := ChunkMarkdown("deployment", content, nil, 10, 0, 0)

	if len(chunks) != 3 {
		t.Fatalf("expected 3 chunks, got %d", len(chunks))
	}

	if chunks[0].SectionPath != "Deployment" {
		t.Errorf("chunk 0: expected path 'Deployment', got %q", chunks[0].SectionPath)
	}
	if chunks[1].SectionPath != "Deployment > Vercel" {
		t.Errorf("chunk 1: expected path 'Deployment > Vercel', got %q", chunks[1].SectionPath)
	}
	if chunks[2].SectionPath != "Deployment > AWS" {
		t.Errorf("chunk 2: expected path 'Deployment > AWS', got %q", chunks[2].SectionPath)
	}

	for i, c := range chunks {
		if c.ChunkIndex != i {
			t.Errorf("chunk %d: expected chunkIndex %d, got %d", i, i, c.ChunkIndex)
		}
	}
}

func TestChunkMarkdown_SmallChunkMerging(t *testing.T) {
	content := `# Main

Introduction paragraph with enough content to be meaningful.

## Short

Hi.

## Long Section

This is a much longer section that has plenty of content to stand on its own without merging.`

	chunks := ChunkMarkdown("test", content, nil, 50, 0, 0)

	if len(chunks) != 2 {
		t.Fatalf("expected 2 chunks after merging, got %d", len(chunks))
	}

	if chunks[0].SectionPath != "Main" {
		t.Errorf("chunk 0: expected path 'Main', got %q", chunks[0].SectionPath)
	}
}

func TestChunkMarkdown_SmallFirstChunkMergesForward(t *testing.T) {
	// A lone H1 header (< minChars) should merge forward into the next section,
	// not remain as a standalone chunk with just "# Media Manager".
	content := `# Media Manager

## Current Status

Full media support is now available with multiple options for adding images, videos, and other media to your application.`

	chunks := ChunkMarkdown("media_manager", content, nil, 100, 0, 0)

	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk (header merged forward), got %d", len(chunks))
	}

	// The merged chunk should contain both the H1 header and the H2 content
	if !strings.Contains(chunks[0].Content, "# Media Manager") {
		t.Error("expected merged chunk to contain H1 header")
	}
	if !strings.Contains(chunks[0].Content, "Full media support") {
		t.Error("expected merged chunk to contain H2 content")
	}
}

func TestChunkMarkdown_NoHeaders(t *testing.T) {
	content := "Just some plain text without any headers.\nMultiple lines of content."
	chunks := ChunkMarkdown("plain", content, nil, 10, 0, 0)

	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].SectionPath != "" {
		t.Errorf("expected empty sectionPath, got %q", chunks[0].SectionPath)
	}
}

func TestChunkMarkdown_Empty(t *testing.T) {
	chunks := ChunkMarkdown("test", "", nil, 10, 0, 0)
	if chunks != nil {
		t.Errorf("expected nil for empty content, got %v", chunks)
	}

	chunks = ChunkMarkdown("test", "   \n  \n  ", nil, 10, 0, 0)
	if chunks != nil {
		t.Errorf("expected nil for whitespace-only content, got %v", chunks)
	}
}

func TestChunkMarkdown_ContentHashDeterminism(t *testing.T) {
	content := "# Test\n\nSome content here."
	chunks1 := ChunkMarkdown("test", content, nil, 10, 0, 0)
	chunks2 := ChunkMarkdown("test", content, nil, 10, 0, 0)

	if chunks1[0].ContentHash != chunks2[0].ContentHash {
		t.Error("expected deterministic content hash")
	}
}

func TestChunkMarkdown_DifferentContentDifferentHash(t *testing.T) {
	chunks1 := ChunkMarkdown("test", "# A\n\nContent A is here.", nil, 10, 0, 0)
	chunks2 := ChunkMarkdown("test", "# B\n\nContent B is here.", nil, 10, 0, 0)

	if chunks1[0].ContentHash == chunks2[0].ContentHash {
		t.Error("expected different content hashes for different content")
	}
}

func TestChunkMarkdown_SlidingWindow(t *testing.T) {
	// Build a section definitely > 100 chars using space-separated words so
	// word-boundary snapping has predictable whitespace to snap to.
	longContent := "# Big Section\n\n" + strings.Repeat("word ", 60)

	// maxChars=100, overlap=20: ~300-char section should split into multiple sub-chunks
	chunks := ChunkMarkdown("doc", longContent, nil, 10, 100, 20)

	if len(chunks) < 2 {
		t.Fatalf("expected multiple chunks from sliding window, got %d", len(chunks))
	}

	for _, c := range chunks {
		// Word-boundary snapping may produce chunks slightly smaller than maxChars
		if len([]rune(c.Content)) > 100 {
			t.Errorf("chunk content length %d exceeds maxChars 100", len([]rune(c.Content)))
		}
		if c.SectionPath != "Big Section" {
			t.Errorf("expected sectionPath 'Big Section', got %q", c.SectionPath)
		}
		// Chunks must not end mid-word (last char must not be a non-space letter
		// unless it's the final chunk which may end at any rune)
	}
}

func TestSlidingWindow_ZeroMaxChars(t *testing.T) {
	s := section{path: "Test", content: "some content here", level: 1}
	result := slidingWindow(s, 0, 0)
	if len(result) != 1 || result[0].content != s.content {
		t.Errorf("expected original section returned for maxChars=0, got %v", result)
	}
}

func TestSlidingWindow_NegativeOverlap(t *testing.T) {
	// Negative overlapChars must not create gaps between chunks.
	// With maxChars=10 and overlapChars=-5, a naive step=15 would skip content;
	// after clamping to 0 step=10 so chunks are contiguous with no overlap.
	s := section{path: "P", content: "aaa bbb ccc ddd eee fff ggg hhh iii jjj", level: 1}
	result := slidingWindow(s, 10, -5)
	if len(result) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(result))
	}
	// Verify no chunk exceeds maxChars in rune length
	for _, r := range result {
		if len([]rune(r.content)) > 10 {
			t.Errorf("chunk exceeds maxChars: %q", r.content)
		}
	}
}

func TestSlidingWindow_WordBoundary(t *testing.T) {
	// Content with clear word boundaries; maxChars=15 lands mid-word on each
	// window so snapping must fire for every non-final chunk.
	s := section{path: "P", content: "hello world foo bar baz qux quux corge grault", level: 1}
	result := slidingWindow(s, 15, 5)
	if len(result) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(result))
	}
	for i, r := range result {
		runes := []rune(r.content)
		// No chunk may exceed maxChars.
		if len(runes) > 15 {
			t.Errorf("chunk %d exceeds maxChars: %q (len=%d)", i, r.content, len(runes))
		}
		// Non-final chunks must end at a word boundary (last rune is not mid-word).
		// A chunk ends on a boundary when its last character is either a space/tab/newline
		// or the character immediately preceding the snapped position was whitespace —
		// which means the content itself must not end with a non-space rune that is
		// followed by more non-space content in the original string.
		// Simplified: the last rune of a non-final chunk must be preceded by whitespace
		// in the original, i.e. the chunk must not cut a word. We check this by
		// verifying the chunk does not end in the middle of a word token from the input.
		if i < len(result)-1 {
			content := r.content
			if len(content) == 0 {
				continue
			}
			lastRune := []rune(content)[len([]rune(content))-1]
			if lastRune != ' ' && lastRune != '\t' && lastRune != '\n' {
				// Last rune is not whitespace. Verify the next character in the
				// original string is also not a non-space letter (which would mean
				// we cut a word).
				endIdx := strings.Index(s.content, content) + len(content)
				if endIdx < len(s.content) && s.content[endIdx] != ' ' && s.content[endIdx] != '\t' && s.content[endIdx] != '\n' {
					t.Errorf("chunk %d cuts a word boundary: %q (next char: %q)", i, content, string(s.content[endIdx]))
				}
			}
		}
	}
}

func TestSha256Hex(t *testing.T) {
	hash := sha256Hex("hello")
	if len(hash) != 64 {
		t.Errorf("expected 64-char hex string, got %d chars", len(hash))
	}

	if sha256Hex("hello") != hash {
		t.Error("expected deterministic hash")
	}

	if sha256Hex("hello") == sha256Hex("world") {
		t.Error("expected different hashes for different inputs")
	}
}

func TestSplitByHeaders_H3UnderH2(t *testing.T) {
	content := `# API Reference

Overview of the API.

## Authentication

Auth details here that are long enough.

### OAuth

OAuth-specific auth flow details and configuration.

### API Keys

API key management and rotation process.`

	sections := splitByHeaders(content)
	if len(sections) != 4 {
		t.Fatalf("expected 4 sections, got %d", len(sections))
	}

	if sections[0].path != "API Reference" {
		t.Errorf("section 0: expected path 'API Reference', got %q", sections[0].path)
	}
	if sections[1].path != "API Reference > Authentication" {
		t.Errorf("section 1: expected path 'API Reference > Authentication', got %q", sections[1].path)
	}
	if sections[2].path != "API Reference > Authentication > OAuth" {
		t.Errorf("section 2: expected path 'API Reference > Authentication > OAuth', got %q", sections[2].path)
	}
	if sections[3].path != "API Reference > Authentication > API Keys" {
		t.Errorf("section 3: expected path 'API Reference > Authentication > API Keys', got %q", sections[3].path)
	}
	if sections[2].level != 3 {
		t.Errorf("section 2: expected level 3, got %d", sections[2].level)
	}
}

func TestSplitByHeaders_H2UnderH1(t *testing.T) {
	content := `# Parent

Intro text.

## Child One

Child one content that is fairly long and detailed.

## Child Two

Child two content that is also fairly long and detailed.`

	sections := splitByHeaders(content)
	if len(sections) != 3 {
		t.Fatalf("expected 3 sections, got %d", len(sections))
	}

	if sections[0].path != "Parent" {
		t.Errorf("section 0: expected path 'Parent', got %q", sections[0].path)
	}
	if sections[1].path != "Parent > Child One" {
		t.Errorf("section 1: expected path 'Parent > Child One', got %q", sections[1].path)
	}
	if sections[2].path != "Parent > Child Two" {
		t.Errorf("section 2: expected path 'Parent > Child Two', got %q", sections[2].path)
	}
}
