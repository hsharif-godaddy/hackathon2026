package pipeline

import (
	"testing"

	"github.com/airo-ai-builder/release-manager/internal/config"
)

// TestExportImportStateRoundTrip is the crux of the two-phase headless split:
// the prod process must rebuild the test process's stages so the single Slack
// message keeps its TEST section. This verifies stages, values, and snapshot
// survive a JSON round-trip and that BuildStages("prod") then appends cleanly.
func TestExportImportStateRoundTrip(t *testing.T) {
	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{
					{ID: "deploy-app", Name: "Deploy App", Group: "deploy"},
					{ID: "build-images", Name: "Build Images", Group: "deploy"},
				}},
				"prod": {Stages: []config.Stage{
					{ID: "promote", Name: "Promote"},
				}},
			},
		},
	}

	src := New(cfg, nil, false, "main", nil)
	if err := src.BuildStages("test"); err != nil {
		t.Fatalf("BuildStages(test): %v", err)
	}
	// Simulate a completed test phase.
	src.succeedStage(0)
	src.stages[0].Outputs["artifact_id"] = "12345"
	src.succeedStage(1)
	src.stages[1].Outputs["agent_image_tag"] = "pi-aaa-ext-bbb"
	src.SetValue("commit", "abc123def456")
	src.Snapshot = RollbackSnapshot{ArtifactID: "999", AgentImageTag: "pi-old-ext-zzz"}

	data, err := src.ExportState()
	if err != nil {
		t.Fatalf("ExportState: %v", err)
	}

	// Fresh prod-phase pipeline imports the state, then appends prod stages.
	dst := New(cfg, nil, false, "main", nil)
	if err := dst.ImportState(data); err != nil {
		t.Fatalf("ImportState: %v", err)
	}

	if got := dst.Values()["commit"]; got != "abc123def456" {
		t.Errorf("commit value = %q, want abc123def456", got)
	}
	if got := dst.Values()["artifact_id"]; got != "" {
		_ = got // artifact_id lives under the namespaced key only if set as a value; here it's a stage output
	}
	stages := dst.Stages()
	if len(stages) != 2 {
		t.Fatalf("imported stages = %d, want 2", len(stages))
	}
	if stages[0].State != StateSuccess || stages[0].Outputs["artifact_id"] != "12345" {
		t.Errorf("stage[0] not restored: state=%v outputs=%v", stages[0].State, stages[0].Outputs)
	}
	if stages[1].Outputs["agent_image_tag"] != "pi-aaa-ext-bbb" {
		t.Errorf("stage[1] output not restored: %v", stages[1].Outputs)
	}
	if dst.Snapshot.ArtifactID != "999" || dst.Snapshot.AgentImageTag != "pi-old-ext-zzz" {
		t.Errorf("snapshot not restored: %+v", dst.Snapshot)
	}

	// Appending prod must index correctly into the combined slice.
	if err := dst.BuildStages("prod"); err != nil {
		t.Fatalf("BuildStages(prod): %v", err)
	}
	if got := len(dst.Stages()); got != 3 {
		t.Fatalf("after appending prod, stages = %d, want 3", got)
	}
	prodGroups := dst.StageGroups("prod")
	if len(prodGroups) != 1 || len(prodGroups[0]) != 1 || prodGroups[0][0] != 2 {
		t.Errorf("StageGroups(prod) = %v, want [[2]] (index into combined slice)", prodGroups)
	}
	// The test groups still index into 0/1.
	testGroups := dst.StageGroups("test")
	if len(testGroups) != 1 || len(testGroups[0]) != 2 {
		t.Errorf("StageGroups(test) = %v, want one group of 2", testGroups)
	}
}
