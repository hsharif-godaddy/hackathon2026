// Package rerank provides keyword-based re-ranking for search results.
// After HybridSearch retrieves candidates via dense+sparse vectors,
// this re-ranker boosts results with exact query term matches in
// title, caption, and keywords — fixing domain confusion where
// semantically similar but wrong-domain images outrank correct ones.
package rerank

import (
	"sort"
	"strings"
	"unicode"

	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

// Field weights for keyword matching.
const (
	weightTitle       = 4.0
	weightCaption     = 2.0
	weightSearchTerms = 2.0
	weightKeywords    = 1.0
)

// ByKeywordMatch re-ranks analyses by how well their text fields match the query terms.
// Results with higher keyword match scores rank first; ties are broken by the original
// relevance score (from HybridSearch RRF). Returns up to limit results.
func ByKeywordMatch(query string, analyses []*models.ImageAnalysis, limit int) []*models.ImageAnalysis {
	if len(analyses) == 0 {
		return analyses
	}

	queryTerms := tokenize(query)
	if len(queryTerms) == 0 {
		// No usable query terms — fall back to original order
		if len(analyses) > limit {
			return analyses[:limit]
		}
		return analyses
	}

	type scored struct {
		analysis     *models.ImageAnalysis
		keywordScore float64
		originalRank int
	}

	items := make([]scored, len(analyses))
	for i, a := range analyses {
		items[i] = scored{
			analysis:     a,
			keywordScore: scoreCandidate(queryTerms, a),
			originalRank: i,
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		si, sj := items[i], items[j]
		// Primary: keyword match score (higher is better)
		if si.keywordScore != sj.keywordScore {
			return si.keywordScore > sj.keywordScore
		}
		// Secondary: original HybridSearch rank (lower index = better)
		return si.originalRank < sj.originalRank
	})

	result := make([]*models.ImageAnalysis, 0, limit)
	for i := 0; i < len(items) && i < limit; i++ {
		result = append(result, items[i].analysis)
	}
	return result
}

// scoreCandidate computes a weighted keyword match score for a single candidate.
// For each query term, checks if it appears as an exact token in each field.
// Returns a score normalized by the number of query terms (0.0 to max weight sum).
func scoreCandidate(queryTerms []string, a *models.ImageAnalysis) float64 {
	titleTokens := tokenize(a.Title)
	captionTokens := tokenize(a.Caption)
	searchTermTokens := tokenizeSlice(a.SearchTerms)
	keywordTokens := tokenizeSlice(a.GettyKeywords)

	titleSet := toSet(titleTokens)
	captionSet := toSet(captionTokens)
	searchTermSet := toSet(searchTermTokens)
	keywordSet := toSet(keywordTokens)

	var totalScore float64
	for _, term := range queryTerms {
		var termScore float64
		if titleSet[term] {
			termScore += weightTitle
		}
		if captionSet[term] {
			termScore += weightCaption
		}
		if searchTermSet[term] {
			termScore += weightSearchTerms
		}
		if keywordSet[term] {
			termScore += weightKeywords
		}
		totalScore += termScore
	}

	// Normalize by query length so longer queries don't inherently score higher
	return totalScore / float64(len(queryTerms))
}

// tokenize splits text into lowercase tokens, stripping punctuation.
func tokenize(text string) []string {
	lower := strings.ToLower(text)
	words := strings.FieldsFunc(lower, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})

	// Filter out very short tokens (articles, prepositions)
	result := make([]string, 0, len(words))
	for _, w := range words {
		if len(w) >= 2 {
			result = append(result, w)
		}
	}
	return result
}

// tokenizeSlice tokenizes each string in the slice and returns all tokens.
func tokenizeSlice(strs []string) []string {
	var result []string
	for _, s := range strs {
		result = append(result, tokenize(s)...)
	}
	return result
}

// toSet converts a slice of strings to a set for O(1) lookup.
func toSet(tokens []string) map[string]bool {
	s := make(map[string]bool, len(tokens))
	for _, t := range tokens {
		s[t] = true
	}
	return s
}
