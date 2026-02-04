//nolint:testpackage // Tests use unexported helpers.
package httpproxy

import (
	"net"
	"sync"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

type fakeProcessController struct {
	mu sync.RWMutex

	status                 ProcessStatus
	startRequest           *validation.ProcessStartRequest
	startErr               error
	startCalls             int
	updateCalls            int
	trackCalls             int
	untrackCalls           int
	lastActivity           time.Time
	startOnRequestEnabled  bool
	wasHealthyBeforeIdle   bool
	registerWebSocketCalls int
}

func (f *fakeProcessController) GetStartRequest() *validation.ProcessStartRequest {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.startRequest
}

func (f *fakeProcessController) Start(req validation.ProcessStartRequest) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.startCalls++
	if f.startErr != nil {
		return f.startErr
	}
	if f.startRequest == nil {
		f.startRequest = &req
	}
	f.status.State = ProcessStateRunning
	if f.status.PID == 0 {
		f.status.PID = 1234
	}
	return nil
}

func (f *fakeProcessController) GetStatus() ProcessStatus {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.status
}

func (f *fakeProcessController) UpdateActivity() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updateCalls++
	f.lastActivity = time.Now()
}

func (f *fakeProcessController) IsStartOnRequestEnabled() bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.startOnRequestEnabled
}

func (f *fakeProcessController) TrackRequest() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.trackCalls++
}

func (f *fakeProcessController) UntrackRequest() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.untrackCalls++
	f.lastActivity = time.Now()
}

func (f *fakeProcessController) EnableStartOnRequest(_ time.Duration, _ time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.startOnRequestEnabled = true
}

func (f *fakeProcessController) WasHealthyBeforeIdle() bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.wasHealthyBeforeIdle
}

func (f *fakeProcessController) RegisterWebSocket(_ net.Conn) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.registerWebSocketCalls++
}

func (f *fakeProcessController) UnregisterWebSocket(_ net.Conn) {}
