# Go Agent

Research project — not used in production. Experimental Go rewrite of the TypeScript agents service. Contains the **prompt optimization harness** used for A/B testing initial agent prompt variants.

## Harness

Config-driven test harness that runs the initial agent against a suite of user prompts, evaluates output quality with an LLM judge, and tracks cost/latency/scores across prompt configurations.

### Quick Reference

```bash
cd go-agent

# Run a single experiment
go run ./cmd/harness configs/harness/baseline.yaml

# A/B test: run two configs sequentially
go run ./cmd/harness configs/harness/v2.0.yaml configs/harness/v3.0.yaml

# Run specific test case only
go run ./cmd/harness -case bakery-brief configs/harness/v2.0.yaml

# Control parallelism
go run ./cmd/harness -concurrency 5 configs/harness/baseline.yaml

# Override runs per case (for variance testing)
go run ./cmd/harness -runs 3 configs/harness/baseline.yaml
```

### Reviewing Results

```bash
# Compare two experiments (the main analysis tool)
go run ./cmd/harness-review -compare results/harness/v2.0 results/harness/v3.0

# Show judge reasoning for ALL score changes (not just outliers)
go run ./cmd/harness-review -compare -outlier 0 results/harness/v2.0 results/harness/v3.0

# Detailed view of a single result
go run ./cmd/harness-review results/harness/v2.0/bakery-brief/1.json

# Brief one-line-per-result summary
go run ./cmd/harness-review -brief results/harness/v2.0

# View all results for a config
go run ./cmd/harness-review results/harness/v2.0/
```

The `-compare` mode produces:

1. **Delta table** — per-test-case score changes across all criteria with `·` (unchanged), `+1`/`-1`, `▲`/`▼` outlier markers
2. **Summary stats** — unchanged/improved/regressed counts, cost and latency averages
3. **Outlier drill-down** — judge reasoning from both runs for scores that moved more than the `-outlier` threshold

### Config Format

Configs live in `configs/harness/`. Each YAML file defines one experiment:

```yaml
name: v3.0
description: Modular initial agent prompts

model: claude-sonnet-4-6
temperature: 0.5
max_output_tokens: 8000
max_steps: 10
effort: "" # optional: "low", "medium"

prompt_files: # concatenated in order to form system prompt
  - ../../../agents/src/prompts/initial/3.0/identity.md
  - ../../../agents/src/prompts/initial/3.0/questioning.md
  # ... more files
  - ../../../agents/src/prompts/shared/communication.md
  - ../../../agents/src/prompts/shared/security.md

prompt_overrides: # swap individual files without editing the list
  ../../../agents/src/prompts/initial/3.0/questioning.md: prompts/questioning-visual.md

responder:
  model: claude-sonnet-4-6 # simulates user answers to askQuestion

judge:
  model: claude-sonnet-4-6
  criteria_file: criteria/standard.yaml # load criteria from shared file (like test_cases_file)
  # criteria:                            # or define inline (merged with criteria_file if both set)
  #   - name: custom_criterion
  #     description: "..."
  #     scale: "1-5"

runs_per_case: 1
test_cases_file: scenarios/standard.yaml
```

**Testing a prompt variant:** Either create a new config with different `prompt_files`, or use `prompt_overrides` to swap a single module:

```yaml
# Swap just the questioning strategy
prompt_overrides:
  ../../../agents/src/prompts/initial/3.0/questioning.md: prompts/questioning-10-rounds.md
```

### Test Cases

Defined in `configs/harness/scenarios/standard.yaml`. Each test case has:

```yaml
- id: bakery-brief
  persona: "You are a small bakery owner..."
  user_message: "website for my bakery"
```

29 cases covering: brief inputs, detailed briefs, domain purchases, dashboards, games, portfolios, e-commerce, one-word prompts, and more.

### Judge Criteria

Seven scoring dimensions (1-5 scale):

| Criterion              | What It Measures                                                    |
| ---------------------- | ------------------------------------------------------------------- |
| `project_name_quality` | Specific, relevant, 1-3 words                                       |
| `handoff_completeness` | All required sections present in handoff                            |
| `design_specificity`   | Distinctive direction vs. vague "modern and clean"                  |
| `anti_cliche`          | Explicitly avoids AI design patterns (icon grids, purple gradients) |
| `design_fit_and_vibe`  | Unified emotional personality matching the business                 |
| `visual_impact`        | "Wow factor" on first load                                          |
| `actionability`        | Developer can build from handoff alone without guessing             |

### Results Structure

Results are saved to `results/harness/{config_name}/{test_case_id}/{run_number}.json`. Each JSON file contains:

- Model/temperature/effort used
- Turn count, latency, token usage, cost breakdown (agent + responder + judge)
- Per-turn timing with tools called
- Project name, questions asked, todo list, handoff prompt
- Judge scores with reasoning per criterion
- Complete/fail status

### Existing Configs

| Config               | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `baseline.yaml`      | Production v1.0 prompts (core + attributes + guidelines + examples) |
| `v1.0.yaml`          | Same as baseline, explicit version label                            |
| `v2.0.yaml`          | Simplified askQuestion, no attributes.md                            |
| `v3.0.yaml`          | Modular prompts — 8 independent swappable files                     |
| `simple-ask.yaml`    | Core override with simplified ask logic                             |
| `no-attributes.yaml` | Baseline minus attributes.md                                        |
| `partial-info.yaml`  | Partial information variant                                         |

### Prompt Versions (agents/src/prompts/initial/)

| Version | Structure                                                                                                                                                                  | Notes                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1.0     | `core.md` + `attributes.md` + `guidelines.md` + `examples.md`                                                                                                              | Original, production default                          |
| 2.0     | `core.md` + `guidelines.md` + `examples.md`                                                                                                                                | Simplified ask, no attributes. 10% cheaper, 4s faster |
| 3.0     | 8 modular files: `identity.md`, `questioning.md`, `project-name.md`, `design-direction.md`, `design-reference.md`, `feature-list.md`, `handoff-template.md`, `examples.md` | Each file independently swappable for A/B testing     |

### Code Structure

```
go-agent/
├── cmd/
│   ├── harness/              # Harness runner CLI
│   │   └── main.go
│   └── harness-review/       # Result viewer/comparison CLI
│       └── main.go
├── configs/harness/
│   ├── scenarios/            # Test case definitions
│   │   └── standard.yaml
│   ├── prompts/              # Override prompt files for experiments
│   │   └── core-simple-ask.md
│   ├── baseline.yaml         # Config files
│   ├── v1.0.yaml
│   ├── v2.0.yaml
│   ├── v3.0.yaml
│   └── ...
├── internal/harness/
│   ├── config.go             # Config loading and validation
│   ├── runner.go             # Conversation loop orchestrator
│   ├── judge.go              # LLM-as-judge evaluator
│   ├── report.go             # Result saving and summary tables
│   ├── cost.go               # Token cost calculation
│   └── tools.go              # Agent tool schemas
└── results/harness/          # Saved results (gitignored except .gitkeep)
```
