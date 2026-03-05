package ingest

import (
	"testing"
)

func TestChunkMarkdown_SingleH1(t *testing.T) {
	content := "# Getting Started\n\nThis is the getting started guide.\nIt has multiple lines."
	chunks := ChunkMarkdown("docs", content, []string{"guide"}, 10)

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

	chunks := ChunkMarkdown("deployment", content, nil, 10)

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

	// Verify chunk indices
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

	chunks := ChunkMarkdown("test", content, nil, 50)

	// "Short" section ("## Short\n\nHi.") is < 50 chars, should merge into previous
	if len(chunks) != 2 {
		t.Fatalf("expected 2 chunks after merging, got %d", len(chunks))
	}

	// First chunk should contain the merged short section
	if chunks[0].SectionPath != "Main" {
		t.Errorf("chunk 0: expected path 'Main', got %q", chunks[0].SectionPath)
	}
}

func TestChunkMarkdown_NoHeaders(t *testing.T) {
	content := "Just some plain text without any headers.\nMultiple lines of content."
	chunks := ChunkMarkdown("plain", content, nil, 10)

	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].SectionPath != "" {
		t.Errorf("expected empty sectionPath, got %q", chunks[0].SectionPath)
	}
}

func TestChunkMarkdown_Empty(t *testing.T) {
	chunks := ChunkMarkdown("test", "", nil, 10)
	if chunks != nil {
		t.Errorf("expected nil for empty content, got %v", chunks)
	}

	chunks = ChunkMarkdown("test", "   \n  \n  ", nil, 10)
	if chunks != nil {
		t.Errorf("expected nil for whitespace-only content, got %v", chunks)
	}
}

func TestChunkMarkdown_ContentHashDeterminism(t *testing.T) {
	content := "# Test\n\nSome content here."
	chunks1 := ChunkMarkdown("test", content, nil, 10)
	chunks2 := ChunkMarkdown("test", content, nil, 10)

	if chunks1[0].ContentHash != chunks2[0].ContentHash {
		t.Error("expected deterministic content hash")
	}
}

func TestChunkMarkdown_DifferentContentDifferentHash(t *testing.T) {
	chunks1 := ChunkMarkdown("test", "# A\n\nContent A is here.", nil, 10)
	chunks2 := ChunkMarkdown("test", "# B\n\nContent B is here.", nil, 10)

	if chunks1[0].ContentHash == chunks2[0].ContentHash {
		t.Error("expected different content hashes for different content")
	}
}

func TestSha256Hex(t *testing.T) {
	hash := sha256Hex("hello")
	if len(hash) != 64 {
		t.Errorf("expected 64-char hex string, got %d chars", len(hash))
	}

	// Deterministic
	if sha256Hex("hello") != sha256Hex("hello") {
		t.Error("expected deterministic hash")
	}

	// Different inputs = different outputs
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
