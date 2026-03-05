package ingest

import (
	"testing"
)

func TestTokenize_EmptyString(t *testing.T) {
	result := Tokenize("")
	if len(result.Indices) != 0 {
		t.Errorf("expected empty indices for empty string, got %d", len(result.Indices))
	}
}

func TestTokenize_BasicText(t *testing.T) {
	result := Tokenize("hello world hello")
	if len(result.Indices) != 2 {
		t.Errorf("expected 2 unique tokens, got %d", len(result.Indices))
	}

	// Find the "hello" token and check its frequency is 2
	helloHash := hashToken("hello")
	found := false
	for i, idx := range result.Indices {
		if idx == helloHash {
			if result.Values[i] != 2 {
				t.Errorf("expected hello frequency 2, got %f", result.Values[i])
			}
			found = true
			break
		}
	}
	if !found {
		t.Error("expected to find hello token")
	}
}

func TestTokenize_PunctuationStripping(t *testing.T) {
	result := Tokenize("hello, world! how's it going?")
	// Should strip punctuation: "hello" "world" "hows" "it" "going"
	if len(result.Indices) != 5 {
		t.Errorf("expected 5 unique tokens after punctuation stripping, got %d", len(result.Indices))
	}
}

func TestTokenize_CaseInsensitivity(t *testing.T) {
	result1 := Tokenize("Hello")
	result2 := Tokenize("hello")
	result3 := Tokenize("HELLO")

	if len(result1.Indices) != 1 || len(result2.Indices) != 1 || len(result3.Indices) != 1 {
		t.Error("expected single token for each input")
	}

	if result1.Indices[0] != result2.Indices[0] || result2.Indices[0] != result3.Indices[0] {
		t.Error("expected same hash for case-insensitive tokens")
	}
}

func TestHashToken_Deterministic(t *testing.T) {
	hash1 := hashToken("deploy")
	hash2 := hashToken("deploy")
	if hash1 != hash2 {
		t.Errorf("expected deterministic hash, got %d and %d", hash1, hash2)
	}
}

func TestHashToken_DifferentTokens(t *testing.T) {
	hash1 := hashToken("hello")
	hash2 := hashToken("world")
	if hash1 == hash2 {
		t.Error("expected different hashes for different tokens")
	}
}
