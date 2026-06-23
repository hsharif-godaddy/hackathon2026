# Skill Eval Validation

**When modifying any file under `agents/src/skills/<name>/`, check if a matching eval suite exists at `evals/gosym-probe/src/scenarios/skills/<name>/`.** If it does, run an A/B comparison before considering the change complete.

## A/B Comparison Workflow

1. Run evals with the change in place (current branch)
2. Swap the skill back to `main` version (`git show main:agents/src/skills/<name>/skill.md > agents/src/skills/<name>/skill.md`)
3. Run evals again (baseline)
4. Restore the changed version (`git checkout -- agents/src/skills/<name>/`)
5. Compare results across the two runs

```bash
cd evals/gosym-probe
pnpm run eval --suite <name> --trials 1 --skip-baseline
```

## Prerequisites

- AAB running locally: `SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock pnpm run dev`
- AWS SSO authenticated: `aws sso login --profile airobuild-dev-private-sso`

Evals take a few minutes per scenario.

## Recovery

Use `--resume <run-id>` to pick up an incomplete run after transient failures (timeouts, SSO expiry).

## No Suite Yet?

If the eval suite doesn't exist yet for a skill being modified, note it in the PR description — skill changes without eval coverage should be flagged for follow-up.
