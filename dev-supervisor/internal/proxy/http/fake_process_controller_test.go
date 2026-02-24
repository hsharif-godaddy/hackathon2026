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

	status                    ProcessStatus
	startRequest              *validation.ProcessStartRequest
	startErr                  error
	startCalls                int
	updateCalls               int
	trackCalls                int
	untrackCalls              int
	lastActivity              time.Time
	startOnRequestEnabled     bool
	wasHealthyBeforeIdle      bool
	registerWebSocketCalls    int
	stateChangeCh             chan struct{} // Lazily initialized in GetStateChangeChan()
	hasDeferredSetup          bool
	deferredSetupExecutedErr  error
	deferredSetupExecutedOnce bool
}

func (f *fakeProcessController) GetStartRequest() *validation.ProcessStartRequest {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.startRequest
}

func (f *fakeProcessController) Start(req validation.ProcessStartRequest) error {
	f.mu.Lock()
	f.startCalls++
	if f.startErr != nil {
		f.mu.Unlock()
		return f.startErr
	}
	if f.startRequest == nil {
		f.startRequest = &req
	}
	f.status.State = ProcessStateRunning
	if f.status.PID == 0 {
		f.status.PID = 1234
	}
	f.mu.Unlock()

	// Broadcast state change to wake up any waiters
	f.broadcastStateChange()
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

func (f *fakeProcessController) TrackRequest() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.trackCalls++
	return true // Fake always accepts requests
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

func (f *fakeProcessController) GetStateChangeChan() <-chan struct{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Lazy initialization for test convenience (avoids requiring constructor usage)
	if f.stateChangeCh == nil {
		f.stateChangeCh = make(chan struct{})
	}
	return f.stateChangeCh
}

func (f *fakeProcessController) broadcastStateChange() {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Lazy initialization for test convenience (avoids requiring constructor usage)
	if f.stateChangeCh == nil {
		f.stateChangeCh = make(chan struct{})
		return // Nothing to broadcast on first call
	}
	close(f.stateChangeCh)
	f.stateChangeCh = make(chan struct{})
}

func (f *fakeProcessController) HasDeferredSetup() bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.hasDeferredSetup && !f.deferredSetupExecutedOnce
}

func (f *fakeProcessController) ExecuteDeferredSetup() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.deferredSetupExecutedOnce {
		return nil // Idempotent - already executed
	}
	f.deferredSetupExecutedOnce = true
	return f.deferredSetupExecutedErr
}
