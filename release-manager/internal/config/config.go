package config

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Pipeline PipelineConfig `yaml:"pipeline"`
	Slack    SlackConfig    `yaml:"slack"`
	Lock     LockConfig     `yaml:"lock"`
	Release  ReleaseConfig  `yaml:"release"`
	// OrchestratorWorkflows are GHA workflows that are NOT pipeline stages but
	// whose in-flight runs must still block a manual TUI release — namely the
	// headless GHA release pipeline (release.yml). The TUI's active-run preflight
	// scans these in addition to the stage-derived deploy workflows.
	OrchestratorWorkflows []OrchestratorWorkflow `yaml:"orchestrator_workflows"`
}

// OrchestratorWorkflow is a repo+workflow whose active runs block a manual
// release (the YAML-tagged config counterpart of DeployWorkflow).
type OrchestratorWorkflow struct {
	Repo            string `yaml:"repo"`
	Workflow        string `yaml:"workflow"`
	ActiveRunFilter string `yaml:"active_run_filter"`
}

type SlackConfig struct {
	SecretName string `yaml:"secret_name"`
	AWSProfile string `yaml:"aws_profile"`
}

type LockConfig struct {
	SSMParameter string `yaml:"ssm_parameter"`
	AWSProfile   string `yaml:"aws_profile"`
}

type ReleaseConfig struct {
	Repo    string `yaml:"repo"`
	Enabled bool   `yaml:"enabled"`
}

// DeployWorkflow represents a unique repo+workflow pair for active-run checking.
type DeployWorkflow struct {
	Repo            string
	Workflow        string
	ActiveRunFilter string
}

type PipelineConfig struct {
	Environments map[string]*EnvironmentConfig `yaml:"environments"`
	DryRun       DryRunConfig                  `yaml:"dry_run"`
	Rollback     RollbackConfig                `yaml:"rollback"`
}

type EnvironmentConfig struct {
	Requires string  `yaml:"requires"`
	Stages   []Stage `yaml:"stages"`
}

type Stage struct {
	ID              string            `yaml:"id"`
	Name            string            `yaml:"name"`
	Group           string            `yaml:"group"`
	Type            string            `yaml:"type"`
	Repo            string            `yaml:"repo"`
	Workflow        string            `yaml:"workflow"`
	Ref             string            `yaml:"ref"`
	ActiveRunCheck  *bool             `yaml:"active_run_check"`
	ActiveRunFilter string            `yaml:"active_run_filter"`
	Inputs          map[string]string `yaml:"inputs"`
	Outputs         map[string]Output `yaml:"outputs"`
	Matrix          []MatrixEntry     `yaml:"matrix"`
	Items           []string          `yaml:"items"`
	URL             string            `yaml:"url"`
	ExpectVersion   string            `yaml:"expect_version"`
}

type Output struct {
	From     string `yaml:"from"`
	JobMatch string `yaml:"job_match"`
	Pattern  string `yaml:"pattern"`

	compiledPattern  *regexp.Regexp
	compiledJobMatch *regexp.Regexp
}

type MatrixEntry struct {
	Inputs map[string]string `yaml:"inputs"`
}

type DryRunConfig struct{}

type RollbackConfig struct {
	Sources RollbackSources `yaml:"sources"`
	Steps   []Stage         `yaml:"steps"`
}

type RollbackSources struct {
	ArtifactID RollbackSource    `yaml:"artifact_id"`
	ImageTags  RollbackImageTags `yaml:"image_tags"`
}

type RollbackSource struct {
	Repo           string `yaml:"repo"`
	Workflow       string `yaml:"workflow"`
	Filter         string `yaml:"filter"`
	ExtractPattern string `yaml:"extract_pattern"`
}

type RollbackImageTags struct {
	Repo        string            `yaml:"repo"`
	Workflow    string            `yaml:"workflow"`
	Filter      string            `yaml:"filter"`
	ExtractFrom string            `yaml:"extract_from"`
	JobMatch    string            `yaml:"job_match"`
	Patterns    map[string]string `yaml:"patterns"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file %s: %w", path, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config file: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return &cfg, nil
}

func (c *Config) validate() error {
	if len(c.Pipeline.Environments) == 0 {
		return fmt.Errorf("at least one environment must be defined")
	}

	for envName, env := range c.Pipeline.Environments {
		if len(env.Stages) == 0 {
			return fmt.Errorf("environment %q: at least one stage is required", envName)
		}

		if env.Requires != "" {
			if _, ok := c.Pipeline.Environments[env.Requires]; !ok {
				return fmt.Errorf("environment %q requires %q which does not exist", envName, env.Requires)
			}
		}

		ids := make(map[string]bool)
		for i, s := range env.Stages {
			if s.ID == "" {
				return fmt.Errorf("environment %q stage[%d]: id is required", envName, i)
			}
			if ids[s.ID] {
				return fmt.Errorf("environment %q stage[%d]: duplicate id %q", envName, i, s.ID)
			}
			ids[s.ID] = true

			if s.Name == "" {
				return fmt.Errorf("environment %q stage %q: name is required", envName, s.ID)
			}

			if s.Type == "checklist" {
				if len(s.Items) == 0 {
					return fmt.Errorf("environment %q stage %q: checklist requires items", envName, s.ID)
				}
				continue
			}

			if s.Type == "health-check" {
				if s.URL == "" {
					return fmt.Errorf("environment %q stage %q: health-check requires url", envName, s.ID)
				}
				continue
			}

			if s.Workflow == "" {
				return fmt.Errorf("environment %q stage %q: workflow is required", envName, s.ID)
			}
			if s.Repo == "" {
				return fmt.Errorf("environment %q stage %q: repo is required", envName, s.ID)
			}

			for outputName, output := range s.Outputs {
				if err := output.compile(); err != nil {
					return fmt.Errorf("environment %q stage %q output %q: %w", envName, s.ID, outputName, err)
				}
				env.Stages[i].Outputs[outputName] = output
			}
		}
	}

	return nil
}

func (o *Output) compile() error {
	if o.Pattern != "" {
		compiled, err := regexp.Compile(o.Pattern)
		if err != nil {
			return fmt.Errorf("invalid pattern %q: %w", o.Pattern, err)
		}
		o.compiledPattern = compiled
	}
	if o.JobMatch != "" {
		compiled, err := regexp.Compile(o.JobMatch)
		if err != nil {
			return fmt.Errorf("invalid job_match %q: %w", o.JobMatch, err)
		}
		o.compiledJobMatch = compiled
	}
	return nil
}

func (o *Output) MatchesJob(jobName string) bool {
	if o.compiledJobMatch == nil {
		return true
	}
	return o.compiledJobMatch.MatchString(jobName)
}

func (o *Output) Extract(line string) string {
	if o.compiledPattern == nil {
		return ""
	}
	matches := o.compiledPattern.FindStringSubmatch(line)
	if len(matches) < 2 {
		return ""
	}
	return matches[1]
}

// Repos returns deduplicated list of all repos referenced in the config.
func (c *Config) Repos() []string {
	seen := make(map[string]bool)
	var repos []string

	for _, env := range c.Pipeline.Environments {
		for _, s := range env.Stages {
			if s.Repo != "" && !seen[s.Repo] {
				seen[s.Repo] = true
				repos = append(repos, s.Repo)
			}
		}
	}

	if r := c.Pipeline.Rollback.Sources.ArtifactID.Repo; r != "" && !seen[r] {
		seen[r] = true
		repos = append(repos, r)
	}
	if r := c.Pipeline.Rollback.Sources.ImageTags.Repo; r != "" && !seen[r] {
		seen[r] = true
		repos = append(repos, r)
	}

	for _, s := range c.Pipeline.Rollback.Steps {
		if s.Repo != "" && !seen[s.Repo] {
			seen[s.Repo] = true
			repos = append(repos, s.Repo)
		}
	}

	if r := c.Release.Repo; r != "" && c.Release.Enabled && !seen[r] {
		seen[r] = true
		repos = append(repos, r)
	}

	return repos
}

// DeployWorkflows returns deduplicated {repo, workflow, activeRunFilter} entries
// from all environments and rollback steps, excluding only those that
// explicitly disable active-run checks.
func (c *Config) DeployWorkflows() []DeployWorkflow {
	type key struct{ repo, workflow string }
	seen := make(map[key]bool)
	var result []DeployWorkflow

	add := func(s Stage) {
		if s.Type == "checklist" || s.Type == "health-check" || s.Workflow == "" || s.Repo == "" {
			return
		}
		if s.ActiveRunCheck != nil && !*s.ActiveRunCheck {
			return
		}
		k := key{s.Repo, s.Workflow}
		if seen[k] {
			return
		}
		seen[k] = true
		result = append(result, DeployWorkflow{
			Repo:            s.Repo,
			Workflow:        s.Workflow,
			ActiveRunFilter: s.ActiveRunFilter,
		})
	}

	for _, env := range c.Pipeline.Environments {
		for _, s := range env.Stages {
			add(s)
		}
	}
	for _, s := range c.Pipeline.Rollback.Steps {
		add(s)
	}

	return result
}

// ActiveRunWorkflows returns the workflows whose in-flight runs should block a
// manual release: the stage-derived deploy workflows (DeployWorkflows) plus the
// configured orchestrator workflow(s) (the GHA release pipeline). Deduplicated
// by repo+workflow, so an orchestrator that also appears as a stage isn't
// listed twice.
func (c *Config) ActiveRunWorkflows() []DeployWorkflow {
	result := c.DeployWorkflows()

	type key struct{ repo, workflow string }
	seen := make(map[key]bool, len(result))
	for _, w := range result {
		seen[key{w.Repo, w.Workflow}] = true
	}

	for _, o := range c.OrchestratorWorkflows {
		if o.Repo == "" || o.Workflow == "" {
			continue
		}
		k := key{o.Repo, o.Workflow}
		if seen[k] {
			continue
		}
		seen[k] = true
		// Identical fields, so a direct conversion is cleaner than a struct
		// literal (and satisfies staticcheck S1016).
		result = append(result, DeployWorkflow(o))
	}

	return result
}

// ResolveTemplate replaces {{key}} placeholders in a string with values from the provided map.
func ResolveTemplate(s string, values map[string]string) string {
	result := s
	for k, v := range values {
		result = strings.ReplaceAll(result, "{{"+k+"}}", v)
	}
	return result
}

// ResolveInputs resolves all template placeholders in a stage's inputs.
func ResolveInputs(inputs map[string]string, values map[string]string) map[string]string {
	resolved := make(map[string]string, len(inputs))
	for k, v := range inputs {
		resolved[k] = ResolveTemplate(v, values)
	}
	return resolved
}

// EnvironmentOrder returns environments in dependency order (required envs first).
// Map keys are sorted alphabetically to ensure deterministic ordering.
func (c *Config) EnvironmentOrder() []string {
	names := make([]string, 0, len(c.Pipeline.Environments))
	for k := range c.Pipeline.Environments {
		names = append(names, k)
	}
	sort.Strings(names)

	var order []string
	visited := make(map[string]bool)

	var visit func(name string)
	visit = func(name string) {
		if visited[name] {
			return
		}
		visited[name] = true
		if env := c.Pipeline.Environments[name]; env.Requires != "" {
			visit(env.Requires)
		}
		order = append(order, name)
	}

	for _, name := range names {
		visit(name)
	}

	return order
}
