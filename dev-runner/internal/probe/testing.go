package probe

// SetStateForTest sets the runner state directly. Intended for cross-package
// tests that need to simulate state transitions without starting a subprocess.
func (r *Runner) SetStateForTest(s State) {
	r.mu.Lock()
	r.state = s
	r.mu.Unlock()
}
