package docker

import (
	"fmt"
	"net"
	"sync"
)

// chromiumUnsafePorts lists ports that Chromium-based browsers refuse to
// navigate to (net::ERR_UNSAFE_PORT). Derived from Chromium source
// net/base/port_util.cc. Only ports reachable by our allocation ranges are
// included. Ports 6566, 6665-6669, 6697 are also Chromium-blocked but
// unreachable given supervisor ranges start at 8877+.
var chromiumUnsafePorts = map[int]struct{}{
	5060:  {}, // SIP
	5061:  {}, // SIP-TLS
	6000:  {}, // X11
	10080: {}, // Amanda
}

// PortAllocator manages port allocation for app containers.
// Matches TypeScript PortManager ranges:
//   - Preview HTTP: 5000-5499
//   - Publish HTTP: 5500-5999
//   - Preview supervisor TCP: 8877+
//   - Publish supervisor TCP: 9000+
type PortAllocator struct {
	mu               sync.Mutex
	nextPreview      int
	nextPublish      int
	nextSuper        int
	nextPublishSuper int
}

func NewPortAllocator() *PortAllocator {
	return &PortAllocator{
		nextPreview:      5000,
		nextPublish:      5500,
		nextSuper:        8877,
		nextPublishSuper: 9000,
	}
}

// Allocate returns four available ports: preview, publish, supervisor, publishSupervisor.
func (p *PortAllocator) Allocate() (preview, publish, supervisor, publishSupervisor int, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	preview, err = p.findAvailable(p.nextPreview)
	if err != nil {
		return 0, 0, 0, 0, fmt.Errorf("preview port: %w", err)
	}
	p.nextPreview = preview + 1

	publish, err = p.findAvailable(p.nextPublish)
	if err != nil {
		return 0, 0, 0, 0, fmt.Errorf("publish port: %w", err)
	}
	p.nextPublish = publish + 1

	supervisor, err = p.findAvailable(p.nextSuper)
	if err != nil {
		return 0, 0, 0, 0, fmt.Errorf("supervisor port: %w", err)
	}
	p.nextSuper = supervisor + 1

	publishSupervisor, err = p.findAvailable(p.nextPublishSuper)
	if err != nil {
		return 0, 0, 0, 0, fmt.Errorf("publish supervisor port: %w", err)
	}
	p.nextPublishSuper = publishSupervisor + 1

	return preview, publish, supervisor, publishSupervisor, nil
}

func (p *PortAllocator) findAvailable(start int) (int, error) {
	for port := start; port < start+100; port++ {
		if _, unsafe := chromiumUnsafePorts[port]; unsafe {
			continue
		}
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err == nil {
			_ = ln.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no available port in range %d-%d", start, start+100)
}
