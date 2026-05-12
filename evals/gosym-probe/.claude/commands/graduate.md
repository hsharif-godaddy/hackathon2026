Graduate a scenario by running a stability check and saving a validated
baseline. Once a baseline exists the scenario gates future runs automatically.

## Usage

```
/graduate <name> [--stability low|medium|high] [--suite] [--commit]
```

- `<name>`: scenario name (or suite name with `--suite`)
- `--stability`: override stability level (low=1, medium=5, high=10
  trials). Defaults to the scenario's own level or medium.
- `--suite`: treat `<name>` as a suite, graduating all its scenarios
- `--commit`: commit the saved baseline JSON after promotion

## Instructions

The user wants to graduate: $ARGUMENTS

### 1. Parse arguments

Extract from `$ARGUMENTS`:

- **target**: the first positional argument (required)
- **--stability**: low, medium, or high (optional)
- **--suite**: flag, treat target as suite name (optional)
- **--commit**: flag, auto-commit after promotion (optional)

If no target is provided, print the Usage block above and stop.

### 2. Run graduation

Build the eval command:

**Single scenario:**

```bash
pnpm run eval --graduate <target> [--stability <level>]
```

**Suite:**

```bash
pnpm run eval --graduate-suite <target> [--stability <level>]
```

Run this command with a 10-minute timeout. Graduation involves
multiple trials against a live AAB instance and takes time.

Display the full output to the user.

### 3. Check the result

- **Exit code 0**: promoted. Proceed to step 4.
- **Non-zero exit code**: not promoted. Display the failure output
  showing per-evaluator pass rates. Do NOT commit anything. Stop here.

For suite mode, identify which scenarios were promoted by looking for
`Scenario "<name>" promoted` in the output. Only commit those.

### 4. Commit (if requested)

**If `--commit` was passed:** stage the new baseline JSON file(s) under
`baselines/` and commit:

```
graduate: save baseline for <name>

Stability: <level> (<N> trials)
Min pass rate: <X>%
```

For suite mode, include all promoted scenario names in the commit
message.

**If `--commit` was NOT passed**, remind the user to commit the baseline
file(s) manually.

### Output

Summarize the result:

**Promoted:**

```
Graduated <name>:
  Stability: <level> (<N> trials)
  Min pass rate: <X>% (threshold: 90%)
  Baseline saved to baselines/<name>/
```

**Not promoted:**

```
<name> not promoted:
  Stability: <level> (<N> trials)
  Per-evaluator pass rates shown above.
  No files changed.
```
