package pipeline

import "encoding/json"

// exportedState is the serializable slice of pipeline state that must survive
// the GitHub Actions job boundary between the test phase and the prod phase.
// The two phases are separate processes (the GHA approval Environment sits
// between them, so the test process has already exited by the time prod runs).
// To keep the single in-place Slack message byte-identical across that gap,
// prod re-hydrates the test stages (so the message still renders the TEST
// section with its results) before appending and running the prod stages.
type exportedState struct {
	Stages   []*StageRun       `json:"stages"`
	Values   map[string]string `json:"values"`
	Snapshot RollbackSnapshot  `json:"snapshot"`
}

// ExportState serializes the current stages, template values, and rollback
// snapshot as JSON. Called at the end of the test phase; the bytes are written
// to a file the GHA workflow uploads as an artifact.
func (p *Pipeline) ExportState() ([]byte, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return json.MarshalIndent(exportedState{
		Stages:   p.stages,
		Values:   p.values,
		Snapshot: p.Snapshot,
	}, "", "  ")
}

// ImportState restores stages, values, and the rollback snapshot from bytes
// produced by ExportState. Existing values are preserved unless overwritten by
// an imported key. Called at the start of the prod phase before BuildStages
// appends the prod stages — so StageGroups("prod") indexes correctly into the
// combined slice and the renderer sees the full test+prod picture.
func (p *Pipeline) ImportState(data []byte) error {
	var es exportedState
	if err := json.Unmarshal(data, &es); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stages = es.Stages
	if p.values == nil {
		p.values = make(map[string]string, len(es.Values))
	}
	for k, v := range es.Values {
		p.values[k] = v
	}
	p.Snapshot = es.Snapshot
	return nil
}
