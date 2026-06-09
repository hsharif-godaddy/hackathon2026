# evals/calibration

Generate a calibration dataset (artifacts) for successful GoArena/Synthia simulations.

For each simulation, this tool fetches and writes:

- Langfuse trace + **observation-level** data (conversation history + observations)
- Synthia simulation record from DynamoDB (`synthia-simulations`)
- Synthia scenario record from DynamoDB (`synthia-scenarios`) to resolve `browserConfig.browserAuth` (login config)
- Synthia evaluation rows from DynamoDB (`synthia-evaluations` via `GSI1` on `simulationId`)
- Multi-viewport screenshots (tiles) for all pages discovered from the homepage of a `previewUrl`

Output layout:

```
evals/calibration/
  dataset/
    <simulation-id>/
      dataset.done
      meta.json
      langfuse/
        trace.json
        observations.json
      dynamodb/
        synthia-simulations.json
        synthia-scenario.json
        synthia-evaluations.json
      site/
        capture.json
        tiles/
          mobile/
            home/tile0.png
          laptop/
            home/tile0.png
```

## Prerequisites

### AWS credentials (DynamoDB)

This tool relies on your shell having valid AWS credentials. Per your requirement, authenticate with:

```bash
eval $(aws-okta-processor authenticate -e -o godaddy.okta.com -u ss01 -d 7200)
```

## Configuration

Create `evals/calibration/.env` with:

- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (optional)
- `DDB_REGION`
- `SYNTHIA_SCENARIOS_TABLE` (default `synthia-scenarios`)
- `SYNTHIA_SCENARIOS_PK_NAME` (default `scenarioId`)
- `SYNTHIA_SIMULATIONS_TABLE` (default `synthia-simulations`)
- `SYNTHIA_SIMULATIONS_PK_NAME` (default `taskId`)
- `SYNTHIA_EVALUATIONS_TABLE` (default `synthia-evaluations`)
- `SYNTHIA_EVALUATIONS_GSI1_NAME` (default `GSI1`)
- `SYNTHIA_EVALUATIONS_GSI1_PK_NAME` (default `simulationId`)
- `CAPTURE_MAX_ROUTES` (optional, default 20)
- `CAPTURE_IGNORE_HTTPS_ERRORS` (optional, `true|false`, default false)

## Input manifest

Create a manifest JSON file listing successful simulations (see `manifest.example.json`):

```json
{
  "simulations": [
    {
      "simulationId": "run-123",
      "langfuse": { "traceId": "trace_abc123" }
    }
  ]
}
```

**Note:** `previewUrl` is automatically read from `synthia-simulations[taskId=<simulationId>]`. Override by adding
`previewUrl` to the manifest entry. Manifest files matching `manifest.*.json` (except `manifest.example.json`)
are gitignored to avoid committing temporary test manifests.

## Run

From `evals/calibration/` (standalone install):

```bash
cd evals/calibration
npm install
npm run dataset -- --manifest ./manifest.json
```

### Resume mode (skip already generated)

If you pass `--resume`, the tool will skip simulations that already have a completion marker file:

- `dataset/<simulation-id>/dataset.done`

Example:

```bash
cd evals/calibration
npm run dataset -- --discover-limit 50 --resume
```

## Multi-judge + meta-judge auditing (LLM-as-Judge calibration)

This runs each target GoArena evaluator YAML through multiple independent judges from diverse model
families and uses a meta-judge to audit rubric adherence and compute a consensus score.

Required `.env`:

- `GOCAAS_BASE_URL`
- `GOCAAS_API_KEY`

Recommended model configuration:

- `JUDGE_MODELS` — Comma-separated list of diverse model families (e.g., `gpt-5.2,claude-sonnet-4-6,gemini-2.5-pro`)
- `JUDGE_META_MODEL` — Advisory meta-judge model from a different family than panel majority (e.g., `claude-opus-4-8`)

Legacy model overrides (deprecated, use `JUDGE_MODELS` instead):

- `JUDGE_MODEL_GPT` (default `gpt-5.2`)
- `JUDGE_MODEL_SONNET` (default `claude-sonnet-4-6`)

Run over all simulations in `dataset/`:

```bash
cd evals/calibration
npm run judge -- --resume
```

Run a single simulation:

```bash
npm run judge -- --simulation-id fcb25a6f-c83c-4f94-9790-a4f66cf70625 --resume
```

Outputs per evaluator:

- `dataset/<simulation-id>/judging/<evaluatorId>/judge-A.json`
- `dataset/<simulation-id>/judging/<evaluatorId>/judge-B.json`
- `dataset/<simulation-id>/judging/<evaluatorId>/judge-C.json`
- `dataset/<simulation-id>/judging/<evaluatorId>/meta.json`
- `dataset/<simulation-id>/judging/<evaluatorId>/consensus.json`

## Metrics (agreement / overrides / variance / confidence)

After running `judge`, you can aggregate metrics across the whole dataset:

```bash
cd evals/calibration
npm run metrics
```

This writes:

- `dataset/judging-metrics.json`

## Auto-discovery (no manifest)

If you want the tool to pick simulations automatically, it can scan `synthia-simulations`
and pick tasks where `status` is `completed` or `maxTurns`.

```bash
cd evals/calibration
npm run dataset -- --discover-limit 50
```

Override statuses (comma-separated):

```bash
npm run dataset -- --discover-limit 50 --discover-statuses completed,maxTurns
```

Filter to last N days (default: 5):

```bash
npm run dataset -- --discover-limit 50 --discover-since-days 5
```

