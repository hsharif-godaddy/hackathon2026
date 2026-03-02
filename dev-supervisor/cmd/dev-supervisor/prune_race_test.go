//go:build !race

// Prune race condition tests - validates Fix #5 (concurrent prune serialization)
// These tests intentionally create concurrent prune scenarios to verify the mutex works.

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRaceCondition_ConcurrentPrunes tests Fix #5:
// Multiple concurrent prunes are serialized via pruneMu to prevent
// stale symlink snapshots from deleting the active version
func TestRaceCondition_ConcurrentPrunes(t *testing.T) {
	t.Parallel()

	// Create temporary directory for test
	tmpDir := t.TempDir()

	// Create test archive files
	for i := range 20 {
		archivePath := filepath.Join(tmpDir, fmt.Sprintf("v%d.tar.gz", i))
		require.NoError(t, os.WriteFile(archivePath, []byte("test"), 0644))
		time.Sleep(5 * time.Millisecond) // Ensure different mtimes
	}

	// Create symlink to latest version
	currentSymlink := filepath.Join(tmpDir, "current")
	require.NoError(t, os.Symlink("v19.tar.gz", currentSymlink))

	// Spawn 20 concurrent prune operations
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pruneOldArchives(tmpDir, 5)
		}()
	}

	wg.Wait()

	// Verify current symlink target still exists
	target, err := os.Readlink(currentSymlink)
	require.NoError(t, err, "symlink should still exist")

	targetPath := filepath.Join(tmpDir, target)
	_, err = os.Stat(targetPath)
	require.NoError(t, err, "symlink target should not be deleted by concurrent prunes")

	// Verify we kept approximately the right number of archives
	entries, err := os.ReadDir(tmpDir)
	require.NoError(t, err)

	archiveCount := 0
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".gz" {
			archiveCount++
		}
	}

	// Should have kept around 5 archives (may be 6 if current is counted)
	assert.LessOrEqual(t, archiveCount, 6,
		"should have pruned old archives (kept=%d)", archiveCount)
	assert.GreaterOrEqual(t, archiveCount, 5,
		"should have kept at least 5 archives (kept=%d)", archiveCount)
}

// TestRaceCondition_PruneWhileUpdatingSymlink tests the scenario where:
// 1. Prune operation reads symlink
// 2. Another publish updates symlink to new version
// 3. First prune deletes the new version (if not serialized)
func TestRaceCondition_PruneWhileUpdatingSymlink(t *testing.T) {
	t.Parallel()

	// Create temporary directory
	tmpDir := t.TempDir()

	// Create 10 archive files
	for i := range 10 {
		archivePath := filepath.Join(tmpDir, fmt.Sprintf("v%d.tar.gz", i))
		require.NoError(t, os.WriteFile(archivePath, []byte("test"), 0644))
		time.Sleep(5 * time.Millisecond)
	}

	// Create initial symlink
	currentSymlink := filepath.Join(tmpDir, "current")
	require.NoError(t, os.Symlink("v9.tar.gz", currentSymlink))

	// Goroutine 1: Prune old archives
	done := make(chan bool)
	go func() {
		pruneOldArchives(tmpDir, 3)
		done <- true
	}()

	// Goroutine 2: Update symlink to different version (simulate publish)
	go func() {
		time.Sleep(10 * time.Millisecond)
		os.Remove(currentSymlink)
		os.Symlink("v8.tar.gz", currentSymlink)
		done <- true
	}()

	// Wait for both
	<-done
	<-done

	// Verify the current symlink target exists
	target, err := os.Readlink(currentSymlink)
	require.NoError(t, err, "symlink should exist")

	targetPath := filepath.Join(tmpDir, target)
	_, err = os.Stat(targetPath)
	assert.NoError(t, err, "current version should not be deleted: %s", target)
}
