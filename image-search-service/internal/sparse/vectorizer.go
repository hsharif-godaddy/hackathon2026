// Package sparse provides hash-based sparse vector generation for hybrid search.
// Tokens are mapped to vector indices using FNV-1a hashing, with Qdrant's IDF
// modifier handling inverse document frequency weighting server-side.
package sparse

import (
	"hash/fnv"
	"slices"
	"strings"
	"unicode"
)

// VocabSize is the number of dimensions in the sparse vector space.
// At 30k dimensions with ~100 unique tokens per document, hash collision probability is negligible.
const VocabSize = 30000

// Vectorize converts text to a sparse vector represented as sorted indices and term-frequency values.
// Returns nil slices for empty input.
func Vectorize(text string) ([]uint32, []float32) {
	tokens := tokenize(text)
	if len(tokens) == 0 {
		return nil, nil
	}

	tf := make(map[uint32]float32)
	for _, token := range tokens {
		idx := fnvHash(token) % VocabSize
		tf[idx]++
	}

	indices := make([]uint32, 0, len(tf))
	for idx := range tf {
		indices = append(indices, idx)
	}
	slices.Sort(indices)

	values := make([]float32, 0, len(tf))
	for _, idx := range indices {
		values = append(values, tf[idx])
	}

	return indices, values
}

// tokenize lowercases text, strips non-alphanumeric characters, and splits on whitespace.
func tokenize(text string) []string {
	lower := strings.ToLower(text)

	// Replace non-alphanumeric (except spaces) with spaces
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return ' '
	}, lower)

	return strings.Fields(cleaned)
}

// fnvHash returns the FNV-1a hash of a string as uint32.
func fnvHash(s string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(s)) //nolint:gosec // fnv hash.Write never returns an error
	return h.Sum32()
}
