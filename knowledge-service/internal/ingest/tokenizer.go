package ingest

import (
	"hash/fnv"
	"strings"
	"unicode"

	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// Tokenize converts text to a BM25 sparse vector.
// Steps: lowercase, strip punctuation, split whitespace, compute term frequencies.
// Qdrant applies IDF server-side via sparse vector modifier.
func Tokenize(text string) *models.SparseVector {
	if text == "" {
		return &models.SparseVector{}
	}

	// Lowercase and strip punctuation
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, text)

	// Split on whitespace
	words := strings.Fields(cleaned)
	if len(words) == 0 {
		return &models.SparseVector{}
	}

	// Compute term frequencies
	tf := make(map[uint32]float32)
	for _, word := range words {
		idx := hashToken(word)
		tf[idx]++
	}

	// Convert to sparse vector
	indices := make([]uint32, 0, len(tf))
	values := make([]float32, 0, len(tf))
	for idx, freq := range tf {
		indices = append(indices, idx)
		values = append(values, freq)
	}

	return &models.SparseVector{
		Indices: indices,
		Values:  values,
	}
}

// hashToken uses FNV-1a to map term strings to uint32 indices.
func hashToken(s string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return h.Sum32()
}
