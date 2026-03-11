package supervisor

import (
	"errors"
	"fmt"
	"strings"
	"sync"
)

// ClientFactory creates and caches supervisor clients by address.
// It is safe for concurrent use.
type ClientFactory struct {
	mu      sync.RWMutex
	clients map[string]*Client
}

// NewClientFactory creates a new ClientFactory.
func NewClientFactory() *ClientFactory {
	return &ClientFactory{
		clients: make(map[string]*Client),
	}
}

// Get returns a cached Client for the given address, creating one if needed.
// Address format: "unix:/path/to/socket" or "http://host:port".
// Returns an error for empty or unrecognized address schemes.
func (f *ClientFactory) Get(addr string) (*Client, error) {
	if addr == "" {
		return nil, errors.New("supervisor address is empty")
	}
	if !strings.HasPrefix(addr, "unix:") && !strings.HasPrefix(addr, "http://") {
		return nil, fmt.Errorf("unsupported supervisor address scheme: %s", addr)
	}

	f.mu.RLock()
	if c, ok := f.clients[addr]; ok {
		f.mu.RUnlock()
		return c, nil
	}
	f.mu.RUnlock()

	f.mu.Lock()
	defer f.mu.Unlock()

	// Double-check after acquiring write lock.
	if c, ok := f.clients[addr]; ok {
		return c, nil
	}

	var c *Client
	if path, ok := strings.CutPrefix(addr, "unix:"); ok {
		c = NewClient(path)
	} else {
		// Strip http:// prefix for NewHTTPClient which expects host:port.
		host := strings.TrimPrefix(addr, "http://")
		c = NewHTTPClient(host)
	}

	f.clients[addr] = c
	return c, nil
}
