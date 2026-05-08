package checks

import (
	"context"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// EvalProbeEnvCheck verifies that evals/gosym-probe/.env exists and contains
// the minimal required variables to run evals.
type EvalProbeEnvCheck struct{}

func (c *EvalProbeEnvCheck) Name() string     { return "Eval Probe .env" }
func (c *EvalProbeEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *EvalProbeEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	result, _ := checkEnvFile(projectRoot, "evals/gosym-probe/.env", []string{
		"GD_ENV",
		"OPENAI_BASE_URL",
		"OPENAI_MODEL",
		"AWS_PROFILE",
	}, c.Name(), c.Category())
	return result
}
