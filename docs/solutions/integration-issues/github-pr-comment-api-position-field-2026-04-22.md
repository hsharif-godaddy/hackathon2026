---
title: GitHub PR comment API rejects line/start_line/subject_type fields
date: 2026-04-22
category: integration-issues
module: github-api
problem_type: integration_issue
component: tooling
symptoms:
  - "gh api repos/.../pulls/.../comments returns 'subject_type is not a permitted key'"
  - "line and start_line rejected as 'not permitted keys' on some API versions"
  - "No subschema in oneOf matched error from GitHub REST API"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [github-api, pr-comments, inline-comments, position-field]
---

# GitHub PR comment API rejects line/start_line/subject_type fields

## Problem

Posting inline PR review comments via `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments` fails when using `line`, `start_line`, and `subject_type` fields. The API returns "not permitted keys" or "No subschema in oneOf matched."

## Symptoms

- `gh api` exits with HTTP 422 Validation Failed
- Error: `"subject_type" is not a permitted key`
- Error: `"line", "start_line" are not permitted keys`

## What Didn't Work

- Using `-F line=42 -f subject_type="line" -f side="RIGHT"` per newer GitHub docs. Some API versions/endpoints reject these fields entirely.
- Using `-F start_line=42 -F line=50` for multi-line ranges. Same rejection.

## Solution

Use the `position` parameter instead. `position` is the 1-based line number within the file's unified diff hunk (as returned by `gh pr diff`).

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  -f body="Comment text" \
  -f path="path/to/file.ts" \
  -f commit_id="COMMIT_SHA" \
  -F position=8
```

To compute `position` from `gh pr diff` output:
1. Find the diff section for the target file (starts with `diff --git a/... b/...`)
2. Count lines from the first `@@` hunk header. The `@@` line itself is position 1.
3. Count down to the target line. Context, added, and removed lines all count. Only `diff --git`, `---`, and `+++` header lines do not count.

Programmatic computation with awk:

```bash
gh pr diff {PR} | awk '
  /^diff --git/{file=$0; pos=0; in_file=0}
  /^diff --git.*TARGET_FILE/{in_file=1}
  in_file && /^@@/{pos=1; next}
  in_file && pos>0{
    if ($0 ~ /TARGET_PATTERN/) {print pos; exit}
    pos++
  }'
```

If the target line is not part of the diff, fall back to a general PR comment:

```bash
gh api repos/{owner}/{repo}/issues/{pr_number}/comments -f body="Comment text"
```

## Why This Works

The `position` field is the original/legacy GitHub API for PR review comments and works across all API versions. The `line`/`start_line`/`subject_type` fields are part of a newer API schema that not all endpoints accept consistently. The `position` approach is universal.

## Prevention

- Always use `position` (unified diff offset) for inline PR comments in skills and automation
- Shell escaping: use double quotes for `-f body=` values, escape backticks inside. Avoid single-quote wrapping if the comment text contains apostrophes.

## Related Issues

- Applied in `/kb-pr-review-comments` skill
