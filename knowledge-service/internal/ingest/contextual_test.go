package ingest

import (
	"testing"
)

func TestShouldSkipEnrichment_SameHashWithContext(t *testing.T) {
	if !ShouldSkipEnrichment("abc123", "abc123", "def456") {
		t.Error("expected true: same content hash + existing contextual hash")
	}
}

func TestShouldSkipEnrichment_SameHashNoContext(t *testing.T) {
	if ShouldSkipEnrichment("abc123", "abc123", "") {
		t.Error("expected false: same content hash but no contextual hash")
	}
}

func TestShouldSkipEnrichment_DifferentHash(t *testing.T) {
	if ShouldSkipEnrichment("abc123", "xyz789", "def456") {
		t.Error("expected false: different content hash")
	}
}

func TestShouldSkipEnrichment_AllEmpty(t *testing.T) {
	if ShouldSkipEnrichment("", "", "") {
		t.Error("expected false: empty contextual hash means not enriched yet")
	}
}
