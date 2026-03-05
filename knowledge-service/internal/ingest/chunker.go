package ingest

import (
	"crypto/sha256"
	"fmt"
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

		if strings.HasPrefix(trimmed, "### ") {
			flushSection()
			header := strings.TrimPrefix(trimmed, "### ")
			header = strings.TrimSpace(header)
			if currentH2 != "" {
				currentPath = currentH2 + " > " + header
			} else if currentH1 != "" {
				currentPath = currentH1 + " > " + header
			} else {
				currentPath = header
			}
			currentLevel = 3
			currentLines = append(currentLines, line)
		} else if strings.HasPrefix(trimmed, "## ") {
			flushSection()
			header := strings.TrimPrefix(trimmed, "## ")
			header = strings.TrimSpace(header)
			if currentH1 != "" {
				currentH2 = currentH1 + " > " + header
				currentPath = currentH2
			} else {
				currentH2 = header
				currentPath = header
			}
			currentLevel = 2
			currentLines = append(currentLines, line)
		} else if strings.HasPrefix(trimmed, "# ") {
			flushSection()
			header := strings.TrimPrefix(trimmed, "# ")
			header = strings.TrimSpace(header)
			currentH1 = header
			currentH2 = ""
			currentPath = header
			currentLevel = 1
			currentLines = append(currentLines, line)
		} else {
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

// sha256Hex returns the SHA-256 hex digest of s.
func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", h)
}
