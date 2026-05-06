Graduate a scenario from `capability` to `regression`.

Runs the graduation stability check and, if promoted, updates the
scenario file automatically.

## Usage

```
/graduate <name> [--stability low|medium|high] [--suite] [--commit]
```

- `<name>`: scenario name (or suite name with `--suite`)
- `--stability`: override stability level (low=1, medium=5, high=10
  trials). Defaults to the scenario's own level or medium.
- `--suite`: treat `<name>` as a suite, graduating all its scenarios
- `--commit`: commit the category change after promotion

## Instructions

The user wants to graduate: $ARGUMENTS

### 1. Parse arguments

Extract from `$ARGUMENTS`:

- **target**: the first positional argument (required)
- **--stability**: low, medium, or high (optional)
- **--suite**: flag, treat target as suite name (optional)
- **--commit**: flag, auto-commit after promotion (optional)

If no target is provided, print the Usage block above and stop.

### 2. Locate scenario file(s)

Find which `.ts` files define the target scenario(s) under
`src/scenarios/`:

**Single scenario mode (default):**

```bash
grep -rl "name: '<target>'" src/scenarios/ --include='*.ts'
```

**Suite mode (`--suite`):**

```bash
grep -rl "suite: '<target>'" src/scenarios/ --include='*.ts'
```

If no files match, report an error and stop.

### 3. Check current category

Read each matched file. Look for the `category:` field.

- If `category: 'regression'` already, report the scenario is
  already graduated and skip it.
- If `category: 'capability'`, it is eligible for graduation.

If all matched scenarios are already graduated, stop with a summary.

### 4. Run graduation

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

### 5. Check the result

- **Exit code 0**: promoted. Proceed to step 6.
- **Non-zero exit code**: not promoted. Display the failure output
  showing per-evaluator pass rates. Do NOT edit any files. Stop here.

For suite mode, identify which scenarios were promoted by looking for
`Scenario "<name>" promoted` in the output. Only update those.

### 6. Update scenario file(s)

For each promoted scenario, use the Edit tool to change:

```
category: 'capability'
```

to:

```
category: 'regression'
```

Only change the `category` line. Do not modify anything else.

Report each file updated.

### 7. Run tests

Run `npx vitest run` to confirm the edit is safe.

If tests fail, revert the category change and report the failure.

### 8. Commit (if requested)

**If `--commit` was passed:** stage the changed scenario file(s) and
commit:

```
graduate: promote <name> to regression

Stability: <level> (<N> trials)
Min pass rate: <X>%
```

**If `--commit` was NOT passed**, remind the user to commit manually.

### Output

Summarize the result:

**Promoted:**

```
Graduated <name>:
  Stability: <level> (<N> trials)
  Min pass rate: <X>% (threshold: 90%)
  Updated: <filepath> -> category: 'regression'
```

**Not promoted:**

```
<name> not promoted:
  Stability: <level> (<N> trials)
  Per-evaluator pass rates shown above.
  No files changed.
```

**Already graduated:**

```
<name> is already category: 'regression'. Nothing to do.
```
