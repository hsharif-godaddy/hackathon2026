package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/airo-ai-builder/knowledge-service/pkg/models"
)

// ChunkMarkdown splits markdown by h1/h2/h3 headers into chunks.
// Merges small chunks (< minChars) into previous.
// Tracks sectionPath: "Deployment > Vercel > Config".
// Computes contentHash (SHA-256 hex of content).
func ChunkMarkdown(docName, content string, tags []string, minChars int) []*models.Chunk {
	if strings.TrimSpace(content) == "" {
		return nil
	}

	sections := splitByHeaders(content)
	if len(sections) == 0 {
		return nil
	}

	// Merge small sections into previous
	merged := mergeSections(sections, minChars)

	now := time.Now().UTC()
	chunks := make([]*models.Chunk, len(merged))
	for i, s := range merged {
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

// mergeSections merges sections shorter than minChars into the previous section.
func mergeSections(sections []section, minChars int) []section {
	if len(sections) == 0 {
		return nil
	}
	if minChars <= 0 {
		return sections
	}

	merged := []section{sections[0]}
	for i := 1; i < len(sections); i++ {
		if len(sections[i].content) < minChars {
			// Merge into previous
			prev := &merged[len(merged)-1]
			prev.content = prev.content + "\n\n" + sections[i].content
		} else {
			merged = append(merged, sections[i])
		}
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
