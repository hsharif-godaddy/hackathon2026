package docker

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestEnsureImagesSerializes verifies that concurrent ensureImages() calls
// never run their build step simultaneously. Regression guard for the
// fan-out provisioning race: N goroutines each calling Up()->ensureImages()
// would otherwise fire N concurrent `buildx build --load` of the same tag,
// which race and fail with "exit status 1".
func TestEnsureImagesSerializes(t *testing.T) {
	m := NewManager()

	var concurrent int32
	var maxConcurrent int32

	m.buildFn = func() error {
		n := atomic.AddInt32(&concurrent, 1)
		for {
			old := atomic.LoadInt32(&maxConcurrent)
			if n <= old || atomic.CompareAndSwapInt32(&maxConcurrent, old, n) {
				break
			}
		}
		// Hold the "build" long enough that any unserialized caller would
		// overlap and bump maxConcurrent above 1.
		time.Sleep(5 * time.Millisecond)
		atomic.AddInt32(&concurrent, -1)
		return nil
	}

	const goroutines = 10
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			if err := m.ensureImages(); err != nil {
				t.Errorf("ensureImages() error: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&maxConcurrent); got != 1 {
		t.Errorf("ensureImages() ran %d builds concurrently; want serialized (1)", got)
	}
}
