---
name: addressing-review
description: Run this loop immediately after opening or pushing to a PR — don't hand the PR off and wait. Poll for reviews, fetch comments, grade each finding on merit, fix the legit ones, commit with a structured message, reply inline, resolve the thread, re-request the reviewer, and repeat until the PR is clean or the round cap is hit. Use after every `gh pr create` or `git push` to an open PR; also use reactively when Copilot, a security scanner, or a human reviewer posts new comments. Driving the PR to mergeable state is the agent's job, not the human's. Pairs with `requesting-review` (pre-flight) and `review` (the ruleset).
license: Proprietary
metadata:
  author: airo-components
  version: "1.0.0"
  category: developer-tools
---

# Addressing Review — the post-push loop

**Opening or pushing to a PR is not the end of the task — it's the
start of this loop.** Automated reviewers (Copilot, security scanners)
post findings within minutes, and driving the PR to mergeable state is
the agent's job, not the human's. If you open a PR and hand it off
without running this loop, you've forced the human to manage the
back-and-forth — which is exactly the bottleneck this repo's review
pipeline is built to eliminate.

Reviews arrive as batches. Each batch has N findings of varying merit.
Your job is to close the PR on **mergeable** in as few round-trips as
possible, without performative agreement and without ignoring real
bugs. This skill tells you exactly how to run the loop so you don't
freestyle and miss steps.

This is the companion to [`requesting-review`](../requesting-review/SKILL.md).
`requesting-review` is the pre-flight before the PR is opened.
`addressing-review` is the follow-through after the PR is open.

## When to use

DO use — proactively — after:

- **Every `gh pr create`.** Opening a PR triggers Copilot Code Review
  within a few minutes. Start polling immediately (step 9 pattern);
  don't wait for a human to ping you.
- **Every `git push` to an open PR.** A new HEAD invalidates previous
  reviews; Copilot will re-review, and you own the response.
- **Every time a new review or comment lands** on the PR — Copilot
  re-request, security scanner, human reviewer.

DO NOT use for:

- The pre-flight before opening a PR — use `requesting-review`.
- Reviewing someone else's PR — use the `review` skill directly.
- Resolving merge conflicts — that's `git rebase`, not review.

## Guardrails before you start

1. **Cap the loop at 5 rounds.** If you're still getting substantive
   findings in round 6, stop and escalate. Either the PR is too big,
   the reviewer is tuned wrong for this change, or you're missing
   context. Five rounds is the point of diminishing returns in
   practice — beyond it you're accumulating drift risk (every fix can
   introduce a new finding).
2. **One reviewer's batch per round.** Don't mix "respond to Copilot"
   and "respond to the human teammate" in a single commit — makes the
   diff harder to read and harder to revert one batch if needed.
3. **Never amend.** Always new commits, per-round. Reviewers need to
   see the fix history to trust the loop.
4. **Evidence before claims.** Don't reply "fixed" without having run
   the verification pipeline and pushed. The reviewer will notice, and
   now you've spent your trust.

## Workflow

### 1. Fetch the latest review + unresolved threads

Every loop iteration starts fresh. Don't rely on what you remember
from the previous round. Fetch through GraphQL — review *threads*,
not review *comments* — because you need the `threadId` later to
resolve them, and you need `isResolved` now to skip threads you've
already closed out.

```bash
PR=5   # set to your PR number
OWNER=gdcorp-ux
REPO=airo-components

# Latest Copilot review on this PR (sanity check it's for current HEAD)
gh api "repos/${OWNER}/${REPO}/pulls/${PR}/reviews" --paginate \
  | jq '[.[] | select(.user.login == "copilot-pull-request-reviewer[bot]")]
        | sort_by(.submitted_at) | last // empty
        | {id, state, submitted_at, commit_id}'

# Unresolved review threads (each has a threadId + its comments)
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) {
          nodes {
            id
            isResolved
            isOutdated
            comments(first:10) {
              nodes { databaseId author { login } path line body }
            }
          }
        }
      }
    }
  }' -F owner=$OWNER -F repo=$REPO -F pr=$PR \
  | jq '.data.repository.pullRequest.reviewThreads.nodes
        | map(select(.isResolved == false))
        | .[] | {threadId: .id, isOutdated,
                 comment: .comments.nodes[0]
                 | {databaseId, author: .author.login, path, line, body}}'
```

Capture `threadId` alongside the comment content — you'll need it in
step 7 to resolve the thread once the fix lands.

If the review is for a commit SHA older than your current HEAD, the
reviewer saw a stale state. Push any uncommitted work first, then
re-request (step 8) without making changes, and re-enter this step
when the new review lands.

### 2. Grade each finding on merit

For every finding, classify before you touch code:

| Grade | Meaning | What to do |
|---|---|---|
| **true-bug** | Would cause an incident, wrong behaviour, security/perf issue, runtime failure, or enforcement hole. | Fix immediately. |
| **polish** | Code is correct but the proposed change is cleaner, more robust, or better-documented. | Fix if the change is small; defer only if it would expand PR scope unreasonably. |
| **defensive** | Finding is technically a false positive (the failure mode doesn't apply in this context), but the proposed change is still safer. | Fix if cheap; push back in the reply if the cost is real. |
| **invalid** | Finding is based on misreading the code or a rule that doesn't apply here. | Reply with evidence. Do NOT change code to satisfy a wrong rule. |

Write a one-line grade next to each finding in your working notes
before you start editing. This forces you to think about the finding
on its merits, not as a todo to silence.

### 3. Fix the legit ones

For each true-bug / polish / cheap-defensive:

1. Make the change.
2. If the reviewer suggested a specific patch, treat it as a *signal
   about intent*, not a mandate. Often a structurally better fix
   covers the concern in one place (e.g. a shared helper instead of
   per-site patching).
3. When a fix changes behaviour that tests assert on, update the
   tests in the same commit. New test cases for the specific scenario
   the reviewer flagged are ideal.
4. If the fix changes external impact, update the PR's `.changeset/*.md`
   file in the same round so the release note still matches the code.

### 4. Run the full verification pipeline

Do not skip this. Every round.

```bash
npm run lint            # biome, auto-fixes formatting
npm run tsc             # no-emit type check
npm test                # full vitest with coverage
npm run check:changeset -- --since origin/main
npm run check:codeowners
npm run check:codeowners:test
```

If any step fails, stop and fix. Do not commit partial green.

### 5. Commit with a structured message

One commit per round. Title pattern:

```
Address <reviewer> round <N>: <one-line summary>
```

Body: numbered list, one paragraph per finding, explaining:

- What the finding was (short).
- Why it was legit (or legit-enough) to fix.
- What changed, mechanistically. Include file names.
- Any trade-off you deliberately made.

Example:

```
Address Copilot round 3: front matter, rename coverage, fork detection

1. `.agents/skills/review/SKILL.md` front matter was malformed — an
   opening `---` followed by `## name: review` (a heading, not a YAML
   key) and no closing `---`. Any skill loader that parses the header
   would fail to recognise the file as the canonical `review` skill.
   Rewrote to match the sibling skills' format.

2. ...
```

This serves three readers:

- The reviewer: can scan the message and trust the loop is tracking.
- Future you: can grep for "Address Copilot round 2" if a regression
  lands that looks like an older bug coming back.
- The pre-merge human: can read the loop history as one story.

### 6. Push

```bash
git push
```

Do not skip ahead to re-request before the push completes. GitHub will
re-review whatever it sees on `HEAD`, which needs to be the just-fixed
state.

### 7. Reply inline, then resolve the thread

Every finding gets a threaded reply **and** — if you acted on it — an
explicit thread resolve. Replying alone isn't enough: unresolved
threads keep the PR's "unresolved conversations" counter non-zero,
which blocks auto-merge under standard branch protection and signals
"still pending" to every human looking at the PR.

For each finding:

```bash
HEAD=$(git rev-parse HEAD)
COMMENT_ID=<databaseId from step 1>
THREAD_ID=<threadId from step 1>

# 7a — Reply.
# For a fixed finding (true-bug / polish / defensive you fixed):
gh api "repos/${OWNER}/${REPO}/pulls/${PR}/comments/${COMMENT_ID}/replies" \
  -X POST -f body="Fixed in ${HEAD}. <1–3 sentence explanation of the fix>."

# For an invalid finding (you pushed back, did not change code):
gh api "repos/${OWNER}/${REPO}/pulls/${PR}/comments/${COMMENT_ID}/replies" \
  -X POST -f body="Not fixing. <evidence why the rule doesn't apply here>."

# 7b — Resolve the thread if (and only if) you acted on the finding.
gh api graphql -f query='
  mutation($threadId:ID!) {
    resolveReviewThread(input:{threadId:$threadId}) {
      thread { id isResolved }
    }
  }' -F threadId=$THREAD_ID
```

Rules for when to resolve:

| Grade | Reply? | Resolve? |
|---|---|---|
| true-bug (fixed) | Yes — cite SHA + specifics. | **Yes** — fix is in `HEAD`. |
| polish (fixed) | Yes — one line is fine. | **Yes.** |
| defensive (fixed) | Yes — note the trade-off. | **Yes.** |
| defensive (declined) | Yes — explain cost/benefit. | **No** — let the reviewer concede or push back. |
| invalid | Yes — cite evidence. | **No** — you're disagreeing; a human/bot should arbitrate. |
| outdated (`isOutdated: true`) | Optional — usually not worth it. | **Yes** if the code the comment anchored to is gone. |

Never resolve a thread whose finding you didn't actually address.
Self-resolving an invalid finding to make the counter go down looks
identical to silently ignoring a real bug — reviewers will catch it,
and they'll be right to be irritated.

Reply requirements:

- Cite the commit SHA so the reviewer can jump to the diff.
- Be specific about *what* you changed, not just that you changed
  something. "Swapped `headRepositoryOwner { login }` for
  `headRepository { nameWithOwner isFork }`" beats "fixed the fork
  check".
- For invalid findings, include a minimal piece of evidence (a code
  path, a link to a spec, a reason the threat model doesn't apply).
  Never say "disagree" alone — that's just performative pushback.

### 8. Re-request the reviewer

For Copilot specifically:

```bash
gh api -X POST "repos/${OWNER_REPO}/pulls/${PR}/requested_reviewers" \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

The `[bot]` suffix is load-bearing — without it GitHub returns 422
"not a collaborator". Response should include
`"requested_reviewers": [{"login": "Copilot", ...}]`.

For a human reviewer, use the GitHub UI's "re-request review" button
or `gh pr ready` equivalents. Don't ping in a comment as a substitute
— the formal re-request is what produces the notification and the
review-expected badge.

### 9. Wait for the next review

Copilot typically posts the next review within 5–15 minutes. Poll
rather than assuming it's done:

```bash
# Is Copilot still in the requested-reviewers set?
gh api "repos/${OWNER_REPO}/pulls/${PR}/requested_reviewers" \
  | jq '.users[].login'
# Empty array means the review has landed — go to step 1.
```

Don't stop the loop while Copilot is still in the requested set.
That's you quitting mid-round.

### 10. Exit condition

Stop when **any** of these holds:

1. **No new findings and no unresolved threads** at the same HEAD.
   Verify both — a round can return "no new findings" while older
   threads are still open because you forgot step 7b. Run the
   unresolved-threads query from step 1 once more; if the list is
   empty and the latest review state is `APPROVED` or has no new
   comments, the PR is clean. Merge (or hand off to auto-merge).
2. **Round cap reached** (default 5, never more than 7). Escalate:
   - Summarise the remaining findings in a PR comment.
   - Tag a human reviewer.
   - Explain what you've tried and why the loop isn't converging.
3. **Diminishing returns** — round N produced only one polish-grade
   finding, round N-1 produced only defensive findings. Call it done
   and merge.
4. **Disagreement deadlock** — a reviewer re-flags the same finding
   you marked invalid, with no new evidence. Escalate to human; don't
   loop on the same argument.

## Reply templates

Copy-paste starting points. Edit to fit.

### Fixed a true-bug

```
Fixed in <HEAD>. <Before-state one sentence>. <After-state one
sentence: what the fix actually does, which file, which function>.
<Optional: why the simpler alternative you'd expect doesn't work.>
```

### Fixed a polish finding

```
Fixed in <HEAD>. Agreed — <cleaner-approach one sentence>. Updated
<file> accordingly; no behaviour change.
```

### Fixed a defensive finding

```
Fixed in <HEAD>. The failure mode is unlikely in this repo because
<reason>, but the proposed change is strictly safer so applied it.
See <file>.
```

### Pushed back on an invalid finding

```
Not fixing. <Evidence>. <Optional: if you can cite the code path or
spec that explains why the rule doesn't apply.> If you want to revisit
as a follow-up we can track it as <issue / TODO comment>.
```

## Red flags — stop and rethink

These mean you're running the loop wrong:

| Thought | Reality |
|---|---|
| "I'll just fix it to silence the bot" | Performative agreement. Future readers get a worse codebase. Grade first, then act. |
| "Skip the verification pipeline, it's a one-line fix" | One-line fixes are where you introduce one-line regressions. Run the pipeline. |
| "I'll amend the round-N commit and force-push" | Reviewers lose the history. Always new commits. |
| "Reply to just the important ones" | Unreplied threads read as unacknowledged. Reply to every finding, even invalid ones. |
| "I'll re-request without pushing" | The reviewer sees the same HEAD and the same comments come back. Push first. |
| "I opened the PR, the human takes it from here" | No. Opening the PR is step zero of this loop, not the end of the task. Poll for the first review and address it. |
| "I'll reply 'fixed' before running tests" | You don't know yet. Verify, then claim. |
| "I replied, that's enough" | Replies without resolves leave the unresolved-conversations counter non-zero, which blocks auto-merge and reads as "still pending" to humans. Resolve every thread you actually addressed. |
| "I'll resolve the invalid finding to clear the count" | That's silently ignoring a finding you publicly disagreed with. Reviewers will re-flag, correctly. Only the reviewer or a human arbiter should close a disputed thread. |
| "This is round 6, but it's fine" | Five is the practical cap. If you're on 6, the PR is probably too big or the scope drifted. Escalate. |

## Integration with other skills

- **`requesting-review`** — what you ran before the PR was opened.
  The cleaner that pass, the shorter this loop.
- **`review`** — the ruleset. When a Copilot finding cites a rule, the
  authoritative text lives in
  [`.agents/skills/review/SKILL.md`](../review/SKILL.md). Disagreeing
  with a rule is valid; changing the rule is a separate PR against
  that file.
- **`receiving-code-review`** (global skill) — the judgment-focused
  companion. When a finding feels unclear or wrong, `receiving-code-review`
  covers *how to evaluate* it. This skill covers *the mechanics* of
  running the loop.
