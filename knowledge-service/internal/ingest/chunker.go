package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// ChunkMarkdown splits markdown by h1/h2/h3 headers into chunks.
// Merges small chunks (< minChars) into previous, then splits oversized
// chunks (> maxChars) into overlapping sliding-window sub-chunks.
// Tracks sectionPath: "Deployment > Vercel > Config".
// Computes contentHash (SHA-256 hex of content).
// Pass maxChars=0 to disable the max-size split.
func ChunkMarkdown(docName, content string, tags []string, minChars, maxChars, overlapChars int) []*models.Chunk {
	if strings.TrimSpace(content) == "" {
		return nil
	}

	sections := splitByHeaders(content)
	if len(sections) == 0 {
		return nil
	}

	merged := mergeSections(sections, minChars)

	// Expand any section that exceeds maxChars into overlapping sub-chunks.
	// Use rune length (not byte length) so multi-byte characters are counted
	// consistently with the rune-based slidingWindow implementation.
	var expanded []section
	for _, s := range merged {
		if maxChars > 0 && len([]rune(s.content)) > maxChars {
			expanded = append(expanded, slidingWindow(s, maxChars, overlapChars)...)
		} else {
			expanded = append(expanded, s)
		}
	}

	now := time.Now().UTC()
	chunks := make([]*models.Chunk, len(expanded))
	for i, s := range expanded {
		chunks[i] = &models.Chunk{
			DocName:     docName,
			SectionPath: s.path,
			Content:     s.content,
			ContentHash: sha256Hex(s.content),
			ChunkIndex:  i,
			Tags:        tags,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
	}

	return chunks
}

// slidingWindow splits a section whose content exceeds maxChars into
// overlapping sub-chunks of up to maxChars characters with overlapChars overlap.
// Each sub-chunk inherits the section path. Chunks are snapped to the nearest
// preceding whitespace so they never cut mid-word.
func slidingWindow(s section, maxChars, overlapChars int) []section {
	if maxChars <= 0 {
		return []section{s}
	}
	if overlapChars < 0 {
		overlapChars = 0
	}
	if overlapChars >= maxChars {
		overlapChars = maxChars / 4
	}

	runes := []rune(s.content)

	var result []section
	start := 0
	for start < len(runes) {
		end := start + maxChars
		if end > len(runes) {
			end = len(runes)
		} else {
			// Snap end back to the nearest preceding whitespace so chunks do
			// not cut mid-word. Fall back to the rune boundary if no whitespace
			// exists in the window.
			snap := end
			for snap > start && runes[snap-1] != ' ' && runes[snap-1] != '\n' && runes[snap-1] != '\t' {
				snap--
			}
			if snap > start {
				end = snap
			}
		}
		result = append(result, section{
			path:    s.path,
			content: string(runes[start:end]),
			level:   s.level,
		})
		if end == len(runes) {
			break
		}
		// Advance from the snapped end so no content between chunks is skipped.
		// Guard against no-progress when the snap lands at or before start
		// (e.g. a long token with no whitespace fills the entire window):
		// always move at least one rune forward to prevent an infinite loop.
		next := end - overlapChars
		if next < 0 {
			next = 0
		}
		if next <= start {
			next = start + 1
		}
		start = next
	}
	return result
}

type section struct {
	path    string // e.g. "Deployment > Vercel > Config"
	content string
	level   int // 1 for h1, 2 for h2, 3 for h3, 0 for no header
}

// splitByHeaders scans lines for #, ##, or ### prefixes and builds sections.
func splitByHeaders(content string) []section {
	lines := strings.Split(content, "\n")
	var sections []section
	var currentH1 string
	var currentH2 string
	var currentLines []string
	var currentPath string
	currentLevel := 0

	flushSection := func() {
		text := strings.TrimSpace(strings.Join(currentLines, "\n"))
		if text != "" {
			sections = append(sections, section{
				path:    currentPath,
				content: text,
				level:   currentLevel,
			})
		}
		currentLines = nil
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		switch {
		case strings.HasPrefix(trimmed, "### "):
			flushSection()
			header := strings.TrimSpace(strings.TrimPrefix(trimmed, "### "))
			currentPath = buildSectionPath(currentH1, currentH2, header)
			currentLevel = 3
			currentLines = append(currentLines, line)
		case strings.HasPrefix(trimmed, "## "):
			flushSection()
			header := strings.TrimSpace(strings.TrimPrefix(trimmed, "## "))
			currentH2 = buildSectionPath(currentH1, "", header)
			currentPath = currentH2
			currentLevel = 2
			currentLines = append(currentLines, line)
		case strings.HasPrefix(trimmed, "# "):
			flushSection()
			currentH1 = strings.TrimSpace(strings.TrimPrefix(trimmed, "# "))
			currentH2 = ""
			currentPath = currentH1
			currentLevel = 1
			currentLines = append(currentLines, line)
		default:
			currentLines = append(currentLines, line)
		}
	}

	flushSection()
	return sections
}

// mergeSections merges sections shorter than minChars into adjacent sections.
// Short sections merge backward into the previous section. If the first section
// is undersized (e.g. a lone H1 header), it merges forward into the next section.
func mergeSections(sections []section, minChars int) []section {
	if len(sections) == 0 {
		return nil
	}
	if minChars <= 0 {
		return sections
	}

	merged := []section{sections[0]}
	for i := 1; i < len(sections); i++ {
		if len([]rune(sections[i].content)) < minChars {
			// Merge into previous
			prev := &merged[len(merged)-1]
			prev.content = prev.content + "\n\n" + sections[i].content
		} else {
			merged = append(merged, sections[i])
		}
	}

	// If the first section is still undersized after backward merges (e.g. a lone
	// H1 header like "# Media Manager"), merge it forward into the next section.
	if len(merged) > 1 && len([]rune(merged[0].content)) < minChars {
		merged[1].content = merged[0].content + "\n\n" + merged[1].content
		merged = merged[1:]
	}

	return merged
}

// buildSectionPath returns "parent > header" using the closest ancestor header.
func buildSectionPath(h1, h2, header string) string {
	if h2 != "" {
		return h2 + " > " + header
	}
	if h1 != "" {
		return h1 + " > " + header
	}
	return header
}

// sha256Hex returns the SHA-256 hex digest of s.
func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
