package ingest

import (
	"hash/fnv"
	"math"
	"strings"
	"unicode"

	"github.com/golang-nlp/stopwords"
	"github.com/kljensen/snowball"

	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// Tokenize converts text to a BM25 sparse vector.
// Steps: lowercase → strip punctuation → split whitespace →
//
//	remove stop words → stem (Snowball/Porter2) → compute term frequencies.
//
// Qdrant applies IDF server-side via the sparse vector modifier.
// Both query-time and ingest-time tokenization must use the same pipeline
// so that sparse vector indices align.
func Tokenize(text string) *models.SparseVector {
	if text == "" {
		return &models.SparseVector{}
	}

	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, text)

	words := strings.Fields(cleaned)
	if len(words) == 0 {
		return &models.SparseVector{}
	}

	tf := make(map[uint32]float32)
	for _, word := range words {
		if stopwords.IsStopWord("en", word) {
			continue
		}

		// Snowball Porter2 English stemmer — errors only occur for unsupported
		// languages; "english" is always supported, so we ignore the error.
		stemmed, err := snowball.Stem(word, "english", true)
		if err != nil {
			stemmed = word
		}

		tf[hashToken(stemmed)]++
	}

	if len(tf) == 0 {
		return &models.SparseVector{}
	}

	indices := make([]uint32, 0, len(tf))
	values := make([]float32, 0, len(tf))
	for idx, freq := range tf {
		indices = append(indices, idx)
		// Sublinear TF scaling: dampens the impact of high-frequency terms
		// so that a term appearing 10x isn't 10x more important than 1x.
		values = append(values, float32(1.0+math.Log(float64(freq))))
	}

	return &models.SparseVector{
		Indices: indices,
		Values:  values,
	}
}

// hashToken uses FNV-1a to map stemmed term strings to uint32 indices.
func hashToken(s string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return h.Sum32()
}
