package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/knowledge-service/internal/config"
)

// pipelineFeatureVersion is a manually-bumped constant that encodes structural
// changes to how chunks are built and embedded (e.g. sectionPath prepend, new
// tokenizer behaviour). Bump it whenever the embedding pipeline changes in a way
// that makes stored vectors incompatible with freshly-computed ones.
const pipelineFeatureVersion = "v2"

// CheckVersion compares the current pipeline configuration against the version
// stored in a sentinel file from the previous run. If they differ — meaning the
// embedding pipeline has changed — it logs a one-time Warn so operators know
// they should delete the collection and re-ingest. Returns without error in all
// cases (a missing or unreadable sentinel is treated as "first run").
func CheckVersion(cfg *config.Config) {
	current := computeVersion(cfg)
	path := sentinelPath(cfg.QdrantCollection)

	stored, err := os.ReadFile(path)
	if err != nil {
		// First run or stale /tmp — write the current version and continue.
		if writeErr := os.WriteFile(path, []byte(current), 0o600); writeErr != nil {
			slog.Debug("ingest.pipeline_version.write_failed", "error", writeErr)
		}
		return
	}

	if strings.TrimSpace(string(stored)) == current {
		slog.Debug("ingest.pipeline_version.ok", "version", current)
		return
	}

	// Mismatch: pipeline configuration has changed since the last run.
	slog.Warn("ingest.pipeline_version.mismatch",
		"stored", strings.TrimSpace(string(stored)),
		"current", current,
		"hint", "embedding pipeline changed; delete the Qdrant collection and re-ingest all documents to avoid semantic inconsistencies")

	// Update sentinel so we warn only once per upgrade, not on every restart.
	if writeErr := os.WriteFile(path, []byte(current), 0o600); writeErr != nil {
		slog.Debug("ingest.pipeline_version.write_failed", "error", writeErr)
	}
}

// computeVersion returns a short hash that uniquely identifies the pipeline
// configuration that affects stored embeddings and sparse vectors.
func computeVersion(cfg *config.Config) string {
	raw := fmt.Sprintf("%s|%d|%d|%d|%s",
		cfg.EmbeddingModel,
		cfg.EmbeddingDimension,
		cfg.IngestMaxChunkSize,
		cfg.IngestChunkOverlap,
		pipelineFeatureVersion,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:8])
}

// sentinelPath returns the OS-temp-dir path for the version sentinel file for
// the given collection. Using the temp dir keeps it ephemeral per container
// lifetime, which is acceptable: a missing file is treated as "first run" and
// simply writes the current version without warning.
func sentinelPath(collection string) string {
	sum := sha256.Sum256([]byte(collection))
	return filepath.Join(os.TempDir(), "ks-pipeline-"+hex.EncodeToString(sum[:8])+".ver")
}
