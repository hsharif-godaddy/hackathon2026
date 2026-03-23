package ingest

import (
	"testing"

	"github.com/kljensen/snowball"
)

func stem(word string) string {
	s, _ := snowball.Stem(word, "english", true)
	return s
}

func TestTokenize_EmptyString(t *testing.T) {
	result := Tokenize("")
	if len(result.Indices) != 0 {
		t.Errorf("expected empty indices for empty string, got %d", len(result.Indices))
	}
}

func TestTokenize_BasicText(t *testing.T) {
	result := Tokenize("hello world hello")
	// "hello" and "world" are not stop words; both stem to themselves.
	// "hello" appears twice → 2 unique stemmed tokens.
	if len(result.Indices) != 2 {
		t.Errorf("expected 2 unique tokens, got %d", len(result.Indices))
	}

	helloHash := hashToken(stem("hello"))
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
	// Clean: hello world hows it going
	// Stop words: "it" filtered
	// Stems: hello→hello, world→world, hows→how, going→go
	// Unique stemmed tokens: {hello, world, how, go} = 4
	if len(result.Indices) != 4 {
		t.Errorf("expected 4 unique tokens after punctuation stripping, stop word removal, and stemming, got %d", len(result.Indices))
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

func TestTokenize_Stemming(t *testing.T) {
	// "deploying" and "deployment" should map to the same stemmed token
	result1 := Tokenize("deploying")
	result2 := Tokenize("deployment")

	if len(result1.Indices) != 1 || len(result2.Indices) != 1 {
		t.Error("expected single token per input")
	}
	if result1.Indices[0] != result2.Indices[0] {
		t.Errorf("expected 'deploying' and 'deployment' to share a stem token, got %d vs %d",
			result1.Indices[0], result2.Indices[0])
	}
}

func TestTokenize_StopWordFiltering(t *testing.T) {
	// Both queries should produce the same core content tokens.
	// "how", "to", "my" are stop words.
	// Stems: make→make, people→peopl, see→see, website→websit
	result1 := Tokenize("how to make people see my website")
	result2 := Tokenize("how to make people see my website, please look into it")

	if len(result1.Indices) == 0 {
		t.Error("expected non-empty sparse vector for base query")
	}

	// Build index set of base query tokens
	baseTokens := make(map[uint32]struct{}, len(result1.Indices))
	for _, idx := range result1.Indices {
		baseTokens[idx] = struct{}{}
	}

	// Extended query adds "please" (→ stem "pleas") and "look" on top of the base.
	// "into" and "it" are stop words and must not appear.
	allowedExtra := map[uint32]struct{}{
		hashToken(stem("please")): {},
		hashToken(stem("look")):   {},
	}
	for _, idx := range result2.Indices {
		if _, inBase := baseTokens[idx]; inBase {
			continue
		}
		if _, allowed := allowedExtra[idx]; !allowed {
			t.Errorf("unexpected extra token index %d in extended query — stop word leaked through", idx)
		}
	}
}

func TestTokenize_FillerPhrasePartialFilter(t *testing.T) {
	result := Tokenize("please look into it")
	// "into" and "it" are stop words; "please" (→ pleas) and "look" are not.
	if len(result.Indices) != 2 {
		t.Errorf("expected 2 tokens (please→pleas, look), got %d", len(result.Indices))
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
