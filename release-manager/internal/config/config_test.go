package config

import (
	"os"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestReleaseConfigApprovalMentions(t *testing.T) {
	var rc ReleaseConfig
	data := []byte("repo: o/r\nenabled: true\napproval_mentions:\n  - jeichorn\n  - ask-airo-sre\n")
	if err := yaml.Unmarshal(data, &rc); err != nil {
		t.Fatal(err)
	}
	if len(rc.ApprovalMentions) != 2 || rc.ApprovalMentions[0] != "jeichorn" || rc.ApprovalMentions[1] != "ask-airo-sre" {
		t.Errorf("approval_mentions parsed as %v, want [jeichorn ask-airo-sre]", rc.ApprovalMentions)
	}
}

func TestResolveTemplate(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		values map[string]string
		want   string
	}{
		{
			name:   "single placeholder",
			input:  "deploy to {{env}}",
			values: map[string]string{"env": "prod"},
			want:   "deploy to prod",
		},
		{
			name:   "multiple placeholders",
			input:  "{{action}} {{component}} to {{env}}",
			values: map[string]string{"action": "deploy", "component": "app", "env": "test"},
			want:   "deploy app to test",
		},
		{
			name:   "no placeholders",
			input:  "plain string",
			values: map[string]string{"env": "prod"},
			want:   "plain string",
		},
		{
			name:   "unresolved placeholder",
			input:  "{{missing}} stays",
			values: map[string]string{"other": "value"},
			want:   "{{missing}} stays",
		},
		{
			name:   "empty values map",
			input:  "{{env}}",
			values: map[string]string{},
			want:   "{{env}}",
		},
		{
			name:   "nested-style key",
			input:  "{{test.deploy-app.artifact_id}}",
			values: map[string]string{"test.deploy-app.artifact_id": "12345"},
			want:   "12345",
		},
		{
			name:   "repeated placeholder",
			input:  "{{tag}} and {{tag}}",
			values: map[string]string{"tag": "v1"},
			want:   "v1 and v1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveTemplate(tt.input, tt.values); got != tt.want {
				t.Errorf("ResolveTemplate() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolveInputs(t *testing.T) {
	inputs := map[string]string{
		"artifact_id": "{{test.deploy-app.artifact_id}}",
		"environment": "prod",
		"image_tag":   "{{test.build-images.agent_image_tag}}",
	}
	values := map[string]string{
		"test.deploy-app.artifact_id":       "12345",
		"test.build-images.agent_image_tag": "pi-abc123-ext-def456",
	}

	got := ResolveInputs(inputs, values)

	if got["artifact_id"] != "12345" {
		t.Errorf("artifact_id = %q, want %q", got["artifact_id"], "12345")
	}
	if got["environment"] != "prod" {
		t.Errorf("environment = %q, want %q", got["environment"], "prod")
	}
	if got["image_tag"] != "pi-abc123-ext-def456" {
		t.Errorf("image_tag = %q, want %q", got["image_tag"], "pi-abc123-ext-def456")
	}
	if len(got) != len(inputs) {
		t.Errorf("got %d keys, want %d", len(got), len(inputs))
	}
}

func TestResolveInputsDoesNotMutateOriginal(t *testing.T) {
	inputs := map[string]string{"key": "{{branch}}"}
	values := map[string]string{"branch": "main"}

	resolved := ResolveInputs(inputs, values)

	if inputs["key"] != "{{branch}}" {
		t.Errorf("original inputs mutated: key = %q", inputs["key"])
	}
	if resolved["key"] != "main" {
		t.Errorf("resolved key = %q, want %q", resolved["key"], "main")
	}
}

func TestOutputMatchesJob(t *testing.T) {
	tests := []struct {
		name     string
		jobMatch string
		jobName  string
		want     bool
	}{
		{
			name:     "nil pattern matches everything",
			jobMatch: "",
			jobName:  "any-job-name",
			want:     true,
		},
		{
			name:     "exact match",
			jobMatch: "build-agent",
			jobName:  "build-agent",
			want:     true,
		},
		{
			name:     "regex match",
			jobMatch: "build-airo-app-builder-agent.*Send Notifications",
			jobName:  "build-airo-app-builder-agent / Send Notifications",
			want:     true,
		},
		{
			name:     "no match",
			jobMatch: "build-airo-app-builder-preview",
			jobName:  "build-airo-app-builder-agent / Send Notifications",
			want:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := &Output{JobMatch: tt.jobMatch}
			if tt.jobMatch != "" {
				if err := o.compile(); err != nil {
					t.Fatalf("compile() error: %v", err)
				}
			}
			if got := o.MatchesJob(tt.jobName); got != tt.want {
				t.Errorf("MatchesJob(%q) = %v, want %v", tt.jobName, got, tt.want)
			}
		})
	}
}

func TestOutputExtract(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		line    string
		want    string
	}{
		{
			name:    "extracts capture group",
			pattern: `Artifact ID: (\d+)`,
			line:    "Artifact ID: 12345",
			want:    "12345",
		},
		{
			name:    "image tag pattern",
			pattern: `MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=(pi-[a-f0-9]+-ext-[a-f0-9]+)`,
			line:    "MOST_SPECIFIC_IMMUTABLE_TAG_SUFFIX=pi-e2420b0-ext-4ba7665",
			want:    "pi-e2420b0-ext-4ba7665",
		},
		{
			name:    "no match returns empty",
			pattern: `Artifact ID: (\d+)`,
			line:    "no artifact here",
			want:    "",
		},
		{
			name:    "nil pattern returns empty",
			pattern: "",
			line:    "anything",
			want:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := &Output{Pattern: tt.pattern}
			if tt.pattern != "" {
				if err := o.compile(); err != nil {
					t.Fatalf("compile() error: %v", err)
				}
			}
			if got := o.Extract(tt.line); got != tt.want {
				t.Errorf("Extract(%q) = %q, want %q", tt.line, got, tt.want)
			}
		})
	}
}

func TestRepos(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {
					Stages: []Stage{
						{ID: "a", Name: "A", Repo: "org/repo-one", Workflow: "a.yml"},
						{ID: "b", Name: "B", Repo: "org/repo-two", Workflow: "b.yml"},
						{ID: "c", Name: "C", Repo: "org/repo-one", Workflow: "c.yml"},
					},
				},
			},
			Rollback: RollbackConfig{
				Sources: RollbackSources{
					ArtifactID: RollbackSource{Repo: "org/repo-one"},
					ImageTags:  RollbackImageTags{Repo: "org/repo-three"},
				},
				Steps: []Stage{
					{ID: "rb", Name: "Rollback", Repo: "org/repo-two", Workflow: "rb.yml"},
				},
			},
		},
	}

	repos := cfg.Repos()

	want := map[string]bool{
		"org/repo-one":   true,
		"org/repo-two":   true,
		"org/repo-three": true,
	}
	if len(repos) != len(want) {
		t.Fatalf("got %d repos, want %d: %v", len(repos), len(want), repos)
	}
	for _, r := range repos {
		if !want[r] {
			t.Errorf("unexpected repo %q", r)
		}
	}
}

func TestEnvironmentOrder(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"prod":    {Requires: "test", Stages: []Stage{{ID: "a", Name: "A", Repo: "r", Workflow: "w"}}},
				"test":    {Stages: []Stage{{ID: "b", Name: "B", Repo: "r", Workflow: "w"}}},
				"staging": {Requires: "prod", Stages: []Stage{{ID: "c", Name: "C", Repo: "r", Workflow: "w"}}},
			},
		},
	}

	order := cfg.EnvironmentOrder()

	testIdx, prodIdx, stagingIdx := -1, -1, -1
	for i, env := range order {
		switch env {
		case "test":
			testIdx = i
		case "prod":
			prodIdx = i
		case "staging":
			stagingIdx = i
		}
	}

	if testIdx >= prodIdx {
		t.Errorf("test (idx=%d) should come before prod (idx=%d)", testIdx, prodIdx)
	}
	if prodIdx >= stagingIdx {
		t.Errorf("prod (idx=%d) should come before staging (idx=%d)", prodIdx, stagingIdx)
	}
	if len(order) != 3 {
		t.Errorf("got %d environments, want 3", len(order))
	}
}

func TestEnvironmentOrderSingleEnv(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"dev": {Stages: []Stage{{ID: "a", Name: "A", Repo: "r", Workflow: "w"}}},
			},
		},
	}

	order := cfg.EnvironmentOrder()
	if len(order) != 1 || order[0] != "dev" {
		t.Errorf("got %v, want [dev]", order)
	}
}

func TestLoadValidConfig(t *testing.T) {
	yaml := `
pipeline:
  environments:
    test:
      stages:
        - id: deploy
          name: Deploy
          repo: org/repo
          workflow: deploy.yml
          inputs:
            env: test
          outputs:
            artifact_id:
              from: run-log
              pattern: "Artifact ID: (\\d+)"
    prod:
      requires: test
      stages:
        - id: promote
          name: Promote
          repo: org/repo
          workflow: promote.yml
          inputs:
            artifact_id: "{{test.deploy.artifact_id}}"
  rollback:
    sources:
      artifact_id:
        repo: org/repo
        workflow: promote.yml
`

	dir := t.TempDir()
	path := filepath.Join(dir, "config.yml")
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatalf("writing test config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if len(cfg.Pipeline.Environments) != 2 {
		t.Errorf("got %d environments, want 2", len(cfg.Pipeline.Environments))
	}
	if cfg.Pipeline.Environments["prod"].Requires != "test" {
		t.Errorf("prod.requires = %q, want %q", cfg.Pipeline.Environments["prod"].Requires, "test")
	}
}

func TestLoadMissingFile(t *testing.T) {
	_, err := Load("/nonexistent/path/config.yml")
	if err == nil {
		t.Fatal("Load() expected error for missing file, got nil")
	}
}

func TestLoadInvalidYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.yml")
	if err := os.WriteFile(path, []byte("not: valid: yaml: ["), 0o644); err != nil {
		t.Fatalf("writing test file: %v", err)
	}

	_, err := Load(path)
	if err == nil {
		t.Fatal("Load() expected error for invalid YAML, got nil")
	}
}

func TestValidateNoEnvironments(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for no environments")
	}
}

func TestValidateNoStages(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for no stages")
	}
}

func TestValidateMissingID(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{Name: "Deploy", Repo: "r", Workflow: "w"}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for missing id")
	}
}

func TestValidateDuplicateID(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{
					{ID: "deploy", Name: "Deploy 1", Repo: "r", Workflow: "w"},
					{ID: "deploy", Name: "Deploy 2", Repo: "r", Workflow: "w"},
				}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for duplicate id")
	}
}

func TestValidateMissingName(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{ID: "deploy", Repo: "r", Workflow: "w"}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for missing name")
	}
}

func TestValidateMissingWorkflow(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{ID: "deploy", Name: "Deploy", Repo: "r"}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for missing workflow")
	}
}

func TestValidateMissingRepo(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{ID: "deploy", Name: "Deploy", Workflow: "w"}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for missing repo")
	}
}

func TestValidateChecklistNoItems(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{ID: "check", Name: "Checklist", Type: "checklist"}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for checklist with no items")
	}
}

func TestValidateChecklistWithItems(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{
					ID:    "check",
					Name:  "Checklist",
					Type:  "checklist",
					Items: []string{"verify this", "check that"},
				}}},
			},
		},
	}
	if err := cfg.validate(); err != nil {
		t.Fatalf("validate() unexpected error: %v", err)
	}
}

func TestValidateHealthCheckNoURL(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{ID: "hc", Name: "Health Check", Type: "health-check"}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for health-check with no url")
	}
}

func TestValidateHealthCheckWithURL(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{
					ID:            "hc",
					Name:          "Health Check",
					Type:          "health-check",
					URL:           "https://example.com/api/health",
					ExpectVersion: "{{commit}}",
				}}},
			},
		},
	}
	if err := cfg.validate(); err != nil {
		t.Fatalf("validate() unexpected error: %v", err)
	}
}

func TestValidateBadRequires(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"prod": {
					Requires: "nonexistent",
					Stages:   []Stage{{ID: "a", Name: "A", Repo: "r", Workflow: "w"}},
				},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for bad requires")
	}
}

func TestValidateInvalidOutputPattern(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{
					ID:       "deploy",
					Name:     "Deploy",
					Repo:     "r",
					Workflow: "w",
					Outputs: map[string]Output{
						"bad": {Pattern: "[invalid"},
					},
				}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for invalid output pattern")
	}
}

func TestValidateInvalidJobMatchPattern(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{{
					ID:       "deploy",
					Name:     "Deploy",
					Repo:     "r",
					Workflow: "w",
					Outputs: map[string]Output{
						"bad": {JobMatch: "[invalid"},
					},
				}}},
			},
		},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() expected error for invalid job_match pattern")
	}
}

func TestDeployWorkflows(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {
					Stages: []Stage{
						{ID: "deploy", Name: "Deploy", Repo: "org/app", Workflow: "deploy.yml"},
						{ID: "build", Name: "Build", Repo: "org/infra", Workflow: "build.yml"},
						{ID: "e2e", Name: "E2E", Repo: "org/app", Workflow: "playwright-e2e.yml", ActiveRunCheck: ptr(false)},
						{ID: "explicit", Name: "Explicit Check", Repo: "org/app", Workflow: "explicit.yml", ActiveRunCheck: ptr(true)},
						{ID: "playwright-deploy", Name: "Playwright Deploy", Repo: "org/app", Workflow: "playwright-deploy.yml"},
						{ID: "check", Name: "Checklist", Type: "checklist", Items: []string{"ok"}},
					},
				},
				"prod": {
					Stages: []Stage{
						{ID: "promote", Name: "Promote", Repo: "org/infra", Workflow: "promote.yml", ActiveRunFilter: "airo"},
						{ID: "deploy-prod", Name: "Deploy Prod", Repo: "org/app", Workflow: "deploy.yml"},
					},
				},
			},
			Rollback: RollbackConfig{
				Steps: []Stage{
					{ID: "rb", Name: "Rollback", Repo: "org/app", Workflow: "deploy.yml"},
				},
			},
		},
	}

	workflows := cfg.DeployWorkflows()

	got := make(map[string]string)
	for _, w := range workflows {
		got[w.Repo+"/"+w.Workflow] = w.ActiveRunFilter
	}

	if _, ok := got["org/app/deploy.yml"]; !ok {
		t.Error("expected org/app/deploy.yml")
	}
	if _, ok := got["org/infra/build.yml"]; !ok {
		t.Error("expected org/infra/build.yml")
	}
	if _, ok := got["org/infra/promote.yml"]; !ok {
		t.Error("expected org/infra/promote.yml")
	}
	if _, ok := got["org/app/playwright-deploy.yml"]; !ok {
		t.Error("expected org/app/playwright-deploy.yml")
	}
	if _, ok := got["org/app/explicit.yml"]; !ok {
		t.Error("expected org/app/explicit.yml")
	}
	if got["org/infra/promote.yml"] != "airo" {
		t.Errorf("promote.yml filter = %q, want %q", got["org/infra/promote.yml"], "airo")
	}
	if _, ok := got["org/app/playwright-e2e.yml"]; ok {
		t.Error("e2e workflow should be excluded by active_run_check")
	}
	if len(workflows) != 5 {
		t.Errorf("got %d workflows, want 5: %v", len(workflows), workflows)
	}
}

func TestActiveRunWorkflows(t *testing.T) {
	cfg := &Config{
		Pipeline: PipelineConfig{
			Environments: map[string]*EnvironmentConfig{
				"test": {Stages: []Stage{
					{ID: "deploy", Name: "Deploy", Repo: "org/app", Workflow: "deploy.yml"},
				}},
			},
		},
		OrchestratorWorkflows: []OrchestratorWorkflow{
			{Repo: "gdcorp-partners/airo-app-builder", Workflow: "release.yml"},
			{Repo: "org/app", Workflow: "deploy.yml"}, // also a stage → must dedupe
			{Repo: "", Workflow: "skip.yml"},          // empty repo → skipped
		},
	}

	wfs := cfg.ActiveRunWorkflows()
	counts := map[string]int{}
	for _, w := range wfs {
		counts[w.Repo+"/"+w.Workflow]++
	}

	if counts["gdcorp-partners/airo-app-builder/release.yml"] != 1 {
		t.Errorf("orchestrator release.yml count = %d, want 1", counts["gdcorp-partners/airo-app-builder/release.yml"])
	}
	if counts["org/app/deploy.yml"] != 1 {
		t.Errorf("deploy.yml count = %d, want 1 (deduped against stage)", counts["org/app/deploy.yml"])
	}
	if counts["/skip.yml"] != 0 {
		t.Error("orchestrator entry with empty repo should be skipped")
	}
}

func ptr(value bool) *bool {
	return &value
}

func TestDeployWorkflowsActualConfig(t *testing.T) {
	cfg, err := Load("../../release-manager.yml")
	if err != nil {
		t.Skipf("skipping actual config test: %v", err)
	}

	workflows := cfg.DeployWorkflows()
	if len(workflows) < 3 {
		t.Errorf("expected at least 3 deploy workflows, got %d", len(workflows))
	}

	for _, w := range workflows {
		if w.Workflow == "playwright-e2e.yml" || w.Workflow == "simulation_evaluation.yml" {
			t.Errorf("%s should be excluded by active_run_check", w.Workflow)
		}
	}

	hasPromoteFilter := false
	for _, w := range workflows {
		if w.Workflow == "docker-promote.yml" && w.ActiveRunFilter == "airo-builder" {
			hasPromoteFilter = true
		}
	}
	if !hasPromoteFilter {
		t.Error("docker-promote.yml should have active_run_filter 'airo-builder'")
	}
}

// TestActiveRunWorkflowsActualConfig guards the coordination safety property:
// the real config must register BOTH GHA orchestrator workflows so a manual TUI
// release is blocked while either a forward release or a rollback is running.
// If someone drops an orchestrator entry, this fails.
func TestActiveRunWorkflowsActualConfig(t *testing.T) {
	cfg, err := Load("../../release-manager.yml")
	if err != nil {
		t.Skipf("skipping actual config test: %v", err)
	}

	got := map[string]bool{}
	for _, w := range cfg.ActiveRunWorkflows() {
		got[w.Workflow] = true
	}
	for _, want := range []string{"release.yml", "rollback.yml"} {
		if !got[want] {
			t.Errorf("ActiveRunWorkflows() must include orchestrator %q (TUI↔GHA collision guard)", want)
		}
	}
}

// TestValidateStagesAdvisoryActualConfig guards that the validate stages stay
// advisory (non-blocking) and the deploy stages stay blocking — so a flaky
// e2e/sim-eval doesn't hard-fail a release, while a deploy/build failure still
// does. Test-phase validate failures are surfaced for the reviewer at the prod
// gate; prod-phase validate failures are surfaced too but (prod already being
// live) do not withhold cutting the GitHub release tag. Mirrors the original
// GHA advisory design.
func TestValidateStagesAdvisoryActualConfig(t *testing.T) {
	cfg, err := Load("../../release-manager.yml")
	if err != nil {
		t.Skipf("skipping actual config test: %v", err)
	}

	advisory := map[string]bool{}
	for _, env := range cfg.Pipeline.Environments {
		for _, s := range env.Stages {
			advisory[s.ID] = s.Advisory
		}
	}

	advisoryStages := []string{
		// test phase
		"e2e-test", "regression-test", "health-check-test", "simulation-eval-test",
		// prod phase
		"e2e-prod", "regression-prod", "health-check-prod",
		// prod-dark phase (opt-in via run_dark) — surfaced in Slack, must NOT gate the promote
		"dark-create-rg", "dark-e2e", "dark-regression",
	}
	for _, id := range advisoryStages {
		if _, ok := advisory[id]; !ok {
			t.Errorf("advisory stage %q not found in config (removed or renamed?)", id)
			continue
		}
		if !advisory[id] {
			t.Errorf("validate stage %q must be advisory (non-blocking)", id)
		}
	}

	blockingStages := []string{
		// test phase
		"deploy-app", "build-images",
		// prod-dark phase — a failed dark deploy/promote must halt the release
		// (dark-promote-images must finish before the bind, so it can't be advisory)
		"dark-deploy-app", "dark-promote-images",
		// prod phase
		"promote-images", "promote-app", "upsert-reload-preprov",
	}
	for _, id := range blockingStages {
		if _, ok := advisory[id]; !ok {
			t.Errorf("blocking stage %q not found in config (removed or renamed?)", id)
			continue
		}
		if advisory[id] {
			t.Errorf("deploy stage %q must be blocking, not advisory", id)
		}
	}
}

func TestHostPaasStageActualConfig(t *testing.T) {
	cfg, err := Load("../../release-manager.yml")
	if err != nil {
		t.Skipf("skipping actual config test: %v", err)
	}

	hostPaas := map[string]bool{}
	for _, env := range cfg.Pipeline.Environments {
		for _, s := range env.Stages {
			hostPaas[s.ID] = s.HostPaas
		}
	}

	// Only the test-phase e2e stage fans out host-paas e2e, so only it splits the
	// Slack report into peer "AAB e2e" + "PaaS e2e" lines.
	if !hostPaas["e2e-test"] {
		t.Error("e2e-test must set host_paas:true (it dispatches run_host_paas_e2e)")
	}
	for _, id := range []string{"regression-test", "e2e-prod", "regression-prod"} {
		if hostPaas[id] {
			t.Errorf("%q must NOT set host_paas (it does not run the host-paas suite)", id)
		}
	}
}

func TestLoadActualConfig(t *testing.T) {
	cfg, err := Load("../../release-manager.yml")
	if err != nil {
		t.Skipf("skipping actual config test: %v", err)
	}

	repos := cfg.Repos()
	if len(repos) < 2 {
		t.Errorf("expected at least 2 repos, got %d", len(repos))
	}

	order := cfg.EnvironmentOrder()
	if len(order) < 2 {
		t.Errorf("expected at least 2 environments, got %d", len(order))
	}

	testSeen := false
	for _, env := range order {
		if env == "test" {
			testSeen = true
		}
		if env == "prod" && !testSeen {
			t.Error("prod appeared before test in environment order")
		}
	}
}
