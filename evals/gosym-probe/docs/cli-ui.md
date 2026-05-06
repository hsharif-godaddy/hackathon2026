# Interactive CLI UI

Launch with:

```bash
pnpm start
```

On startup, a gradient ASCII art banner is displayed once. The compact
`🤖 gosym-probe` header then appears at the top of every menu redraw.
Navigation is single-keypress — no Enter needed. Press `Ctrl+C` to
exit at any time.

---

## Menu Map

```
[1] Run Evals
    [1] Run all scenarios
    [2] Pick scenario          (tab autocomplete on scenario name)
    [3] Custom run             prompts for scenario, trials, env
    [b] Back

[2] List Scenarios             table: name / category / trials /
                               execution mode / evaluator count

[3] Config
    [1] View .env values       sensitive keys (API keys) masked
    [2] Edit a value           inline prompt, writes back to .env
    [3] Switch environment     local.dev | local.test | local.prod
    [4] View resolved config   live values from loadConfig()
    [b] Back

[4] Results
    <list of past runs>        select a run to drill in
        [1] View summary       run ID, timestamp, git SHA, scenarios
        [2] View evaluator scores
                               pass@K, passing trials, mean score
        [b] Back

[5] Baselines
    [1] View current baselines table: scenario / baseline run / date
    [2] Save baseline from run  prompts for run ID, runs:
                               pnpm run save-baseline <run-id>
    [3] Graduate scenario      confirmation prompt, then:
                               pnpm run eval --graduate <name>
    [b] Back

[h] Help
[q] Quit
```

---

## Run Evals

### Run all scenarios

Runs `pnpm run eval` with no flags — executes every registered
scenario with default trial counts.

### Pick scenario

Presents a numbered list of registered scenarios. Selecting one runs:

```
pnpm run eval --scenario <name>
```

### Custom run

Prompts for three optional overrides (press Enter to skip each):

| Prompt | Flag applied |
|---|---|
| Scenario name (tab autocomplete) | `--scenario <name>` |
| Trials override | `--trials <n>` |
| Environment | `--env <env>` |

---

## Config

`.env` values are read from and written back to the `.env` file in the
project root.

**Edit a value** — prompts for a new value and updates the file
in-place, preserving all other entries and comments.

**Switch environment** — sets `GD_ENV` in `.env` to one of
`local.dev`, `local.test`, or `local.prod`.

**View resolved config** — calls `loadConfig()` and renders the
resolved runtime values (including defaults), useful for confirming
which endpoint and model will be used on the next eval run.

---

## Results

Reads from `results/` (gitignored). Displays a list of past runs
sorted by timestamp. For each run:

- **Summary**: run ID, timestamp, git SHA, scenario list
- **Evaluator scores**: per-evaluator pass@K, passing trials / total,
  mean score across trials

---

## Baselines

Baseline snapshots live in `baselines/` and are committed to the repo.

**Save baseline from run** — prompts for a run ID and runs
`pnpm run save-baseline <run-id>`, promoting the run's aggregated results
to versioned baseline files under `baselines/<name>/`.

**Graduate scenario** — runs the pass-rate check
(`pnpm run eval --graduate <name>`) after a confirmation prompt.
See [Graduating a Scenario](../README.md#graduating-a-scenario-capability--regression)
in the README for full details.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `1`–`9` | Select numbered menu item |
| `b` | Back (where available) |
| `h` | Help |
| `q` | Quit |
| `Ctrl+C` | Exit at any time |
| `Tab` | Autocomplete (scenario/env name prompts) |

---

## Relationship to Headless Mode

`pnpm start` (interactive) and `pnpm run eval` (headless) share the
same scenario registry and eval runner. The interactive UI is a
convenience wrapper; the headless flags are documented in
[README.md — CLI Reference](../README.md#cli-reference).
