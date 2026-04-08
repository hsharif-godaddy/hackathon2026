package sparse

import (
	"slices"
	"testing"
)

func TestVectorize_Basic(t *testing.T) {
	indices, values := Vectorize("bakery bread pastries display")

	if len(indices) == 0 {
		t.Fatal("expected non-empty indices")
	}
	if len(indices) != len(values) {
		t.Fatalf("indices length %d != values length %d", len(indices), len(values))
	}

	// 4 unique tokens, should have <= 4 indices (could be fewer if hash collision)
	if len(indices) > 4 {
		t.Errorf("expected at most 4 indices for 4 unique tokens, got %d", len(indices))
	}

	// All values should be 1.0 (each token appears once)
	for i, v := range values {
		if v != 1.0 {
			t.Errorf("values[%d] = %f, expected 1.0", i, v)
		}
	}
}

func TestVectorize_RepeatedTokens(t *testing.T) {
	indices, values := Vectorize("bread bread bread butter")

	if len(indices) == 0 {
		t.Fatal("expected non-empty indices")
	}

	// "bread" appears 3 times, should have TF=3 for that index
	breadIdx := fnvHash("bread") % VocabSize
	found := false
	for i, idx := range indices {
		if idx == breadIdx {
			if values[i] != 3.0 {
				t.Errorf("TF for 'bread' = %f, expected 3.0", values[i])
			}
			found = true
			break
		}
	}
	if !found {
		t.Error("expected to find index for 'bread'")
	}
}

func TestVectorize_Empty(t *testing.T) {
	indices, values := Vectorize("")
	if indices != nil || values != nil {
		t.Error("expected nil slices for empty input")
	}

	indices, values = Vectorize("   ")
	if indices != nil || values != nil {
		t.Error("expected nil slices for whitespace-only input")
	}
}

func TestVectorize_Deterministic(t *testing.T) {
	text := "professional office workspace meeting"

	indices1, values1 := Vectorize(text)
	indices2, values2 := Vectorize(text)

	if len(indices1) != len(indices2) {
		t.Fatal("indices lengths differ between runs")
	}
	for i := range indices1 {
		if indices1[i] != indices2[i] {
			t.Errorf("index %d differs: %d vs %d", i, indices1[i], indices2[i])
		}
		if values1[i] != values2[i] {
			t.Errorf("value %d differs: %f vs %f", i, values1[i], values2[i])
		}
	}
}

func TestVectorize_IndicesSorted(t *testing.T) {
	indices, _ := Vectorize("The quick brown fox jumps over the lazy dog near a river bank")

	if !slices.IsSorted(indices) {
		t.Error("indices are not sorted")
	}
}

func TestVectorize_CaseInsensitive(t *testing.T) {
	indices1, values1 := Vectorize("Bakery BREAD")
	indices2, values2 := Vectorize("bakery bread")

	if len(indices1) != len(indices2) {
		t.Fatal("case sensitivity: different number of indices")
	}
	for i := range indices1 {
		if indices1[i] != indices2[i] || values1[i] != values2[i] {
			t.Error("case sensitivity: different results for same words with different casing")
		}
	}
}

func TestVectorize_PunctuationStripping(t *testing.T) {
	indices1, _ := Vectorize("hello, world!")
	indices2, _ := Vectorize("hello world")

	if len(indices1) != len(indices2) {
		t.Fatal("punctuation not properly stripped")
	}
	for i := range indices1 {
		if indices1[i] != indices2[i] {
			t.Error("punctuation affected hashing")
		}
	}
}

func TestVectorize_IndicesWithinVocabSize(t *testing.T) {
	indices, _ := Vectorize("a long text with many different unique words to test vocabulary bounds checking properly")

	for _, idx := range indices {
		if idx >= VocabSize {
			t.Errorf("index %d exceeds VocabSize %d", idx, VocabSize)
		}
	}
}

func TestTokenize(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"hello world", []string{"hello", "world"}},
		{"Hello, World!", []string{"hello", "world"}},
		{"  spaced   out  ", []string{"spaced", "out"}},
		{"hyphen-word", []string{"hyphen", "word"}},
		{"numbers123 mixed456", []string{"numbers123", "mixed456"}},
		{"", nil},
	}

	for _, tt := range tests {
		result := tokenize(tt.input)
		if len(result) != len(tt.expected) {
			t.Errorf("tokenize(%q): got %v, want %v", tt.input, result, tt.expected)
			continue
		}
		for i := range result {
			if result[i] != tt.expected[i] {
				t.Errorf("tokenize(%q)[%d]: got %q, want %q", tt.input, i, result[i], tt.expected[i])
			}
		}
	}
}
