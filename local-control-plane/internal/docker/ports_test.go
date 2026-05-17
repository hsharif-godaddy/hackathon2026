package docker

import (
	"testing"
)

func TestAllocate(t *testing.T) {
	pa := NewPortAllocator()

	preview, publish, supervisor, publishSupervisor, err := pa.Allocate()
	if err != nil {
		t.Fatalf("Allocate: %v", err)
	}

	if preview == 0 || publish == 0 || supervisor == 0 || publishSupervisor == 0 {
		t.Fatalf("expected all non-zero ports, got preview=%d publish=%d supervisor=%d publishSupervisor=%d",
			preview, publish, supervisor, publishSupervisor)
	}

	// All four ports should be distinct
	ports := map[int]bool{preview: true, publish: true, supervisor: true, publishSupervisor: true}
	if len(ports) != 4 {
		t.Fatalf("expected 4 distinct ports, got %d", len(ports))
	}
}

func TestAllocatePortRanges(t *testing.T) {
	pa := NewPortAllocator()

	preview, publish, supervisor, publishSupervisor, err := pa.Allocate()
	if err != nil {
		t.Fatalf("Allocate: %v", err)
	}

	if preview < 5000 || preview >= 5500 {
		t.Errorf("preview port %d outside expected range 5000-5499", preview)
	}
	if publish < 5500 || publish >= 6000 {
		t.Errorf("publish port %d outside expected range 5500-5999", publish)
	}
	if supervisor < 8877 {
		t.Errorf("supervisor port %d below expected minimum 8877", supervisor)
	}
	if publishSupervisor < 9000 {
		t.Errorf("publishSupervisor port %d below expected minimum 9000", publishSupervisor)
	}
}

func TestAllocateMultipleNoCollisions(t *testing.T) {
	pa := NewPortAllocator()

	allPorts := make(map[int]bool)

	for i := 0; i < 5; i++ {
		preview, publish, supervisor, publishSupervisor, err := pa.Allocate()
		if err != nil {
			t.Fatalf("Allocate call %d: %v", i, err)
		}

		for _, p := range []int{preview, publish, supervisor, publishSupervisor} {
			if allPorts[p] {
				t.Fatalf("collision on port %d at allocation %d", p, i)
			}
			allPorts[p] = true
		}
	}
}

func TestAllocateSkipsChromiumUnsafePorts(t *testing.T) {
	t.Run("preview skips 5060/5061", func(t *testing.T) {
		pa := NewPortAllocator()
		// Start directly at an unsafe port so the skip logic must fire
		pa.nextPreview = 5060

		preview, _, _, _, err := pa.Allocate()
		if err != nil {
			t.Fatalf("Allocate: %v", err)
		}

		if _, unsafe := chromiumUnsafePorts[preview]; unsafe {
			t.Errorf("allocated Chromium-unsafe port %d for preview", preview)
		}
		if preview < 5062 {
			t.Errorf("expected port >= 5062 (skipping 5060/5061), got %d", preview)
		}
	})

	t.Run("publish skips 6000", func(t *testing.T) {
		pa := NewPortAllocator()
		// Position publish allocator so 6000 is the next candidate
		pa.nextPublish = 5999

		_, publish, _, _, err := pa.Allocate()
		if err != nil {
			t.Fatalf("Allocate: %v", err)
		}

		if publish == 6000 {
			t.Errorf("allocated Chromium-unsafe port 6000 for publish")
		}
	})
}

func TestAllocateSequentialIncrement(t *testing.T) {
	pa := NewPortAllocator()

	p1, pub1, s1, ps1, _ := pa.Allocate()
	p2, pub2, s2, ps2, _ := pa.Allocate()

	// Second allocation should use higher ports (assuming no ports are in use)
	if p2 <= p1 {
		t.Errorf("expected second preview port %d > first %d", p2, p1)
	}
	if pub2 <= pub1 {
		t.Errorf("expected second publish port %d > first %d", pub2, pub1)
	}
	if s2 <= s1 {
		t.Errorf("expected second supervisor port %d > first %d", s2, s1)
	}
	if ps2 <= ps1 {
		t.Errorf("expected second publishSupervisor port %d > first %d", ps2, ps1)
	}
}
