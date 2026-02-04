package main

import (
	"errors"
	"net"
	"time"

	httpproxy "github.com/airo-ai-builder/dev-supervisor/internal/proxy/http"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

type processController struct {
	pm *ProcessManager
}

func newProcessController(pm *ProcessManager) httpproxy.ProcessController {
	return &processController{pm: pm}
}

func (p *processController) GetStartRequest() *validation.ProcessStartRequest {
	return p.pm.GetStartRequest()
}

func (p *processController) Start(req validation.ProcessStartRequest) error {
	err := p.pm.Start(req)
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrAlreadyStarting) {
		return httpproxy.ErrAlreadyStarting
	}
	if errors.Is(err, ErrAlreadyRunning) {
		return httpproxy.ErrAlreadyRunning
	}
	return err
}

func (p *processController) GetStatus() httpproxy.ProcessStatus {
	status := p.pm.GetStatus()
	return httpproxy.ProcessStatus{
		PID:   status.PID,
		State: httpproxy.ProcessState(status.State),
		Error: status.Error,
	}
}

func (p *processController) UpdateActivity() {
	p.pm.UpdateActivity()
}

func (p *processController) IsStartOnRequestEnabled() bool {
	return p.pm.IsStartOnRequestEnabled()
}

func (p *processController) TrackRequest() {
	p.pm.TrackRequest()
}

func (p *processController) UntrackRequest() {
	p.pm.UntrackRequest()
}

func (p *processController) EnableStartOnRequest(idleTimeout, checkInterval time.Duration) {
	p.pm.EnableStartOnRequest(idleTimeout, checkInterval)
}

func (p *processController) WasHealthyBeforeIdle() bool {
	return p.pm.WasHealthyBeforeIdle()
}

func (p *processController) RegisterWebSocket(conn net.Conn) {
	p.pm.RegisterWebSocket(conn)
}

func (p *processController) UnregisterWebSocket(conn net.Conn) {
	p.pm.UnregisterWebSocket(conn)
}
