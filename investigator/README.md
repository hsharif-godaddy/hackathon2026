# airo-investigator

Lambda container that runs the repo-owned `airo-log-investigate` skill via
Claude CLI. The skill calls the console-owned evidence endpoint for one appId
and stores bounded raw log pages plus compact per-source indexes under `/tmp`
before Claude reads the indexes.

## Components

- `Dockerfile` — Lambda container image (private ECR mirror of AWS Lambda Node 22 base, Claude CLI, repo-owned skill copied into `/opt/skills/airo-log-investigate`)
- `handler.mjs` — cold-start bootstrap, spawns `claude -p`, heartbeats S3 state, uploads report
- `skills/airo-log-investigate/` — owned log investigation skill and console evidence fetcher/indexer.
- `docker/claude-template/` — read-only Claude config template baked into `/opt/`; rehydrated into `/tmp/.claude` at cold start because Lambda's root FS is read-only.

## Invocation contract

Invoked async by the debug-console with this payload:

```json
{
  "investigationId": "inv-<uuid>",
  "appId": "...",
  "customerId": "...",
  "feedback": "...",
  "fullstoryUrl": null,
  "timeWindow": "24h",
  "stateKey": "active/<customerId>/<appId>/state.json",
  "historyPrefix": "history/<customerId>/<appId>/",
  "resultKey": "active/<customerId>/<appId>/result.md",
  "tracePrefix": "active/<customerId>/<appId>/"
}
```

Lambda env required:

| Var                   | Purpose                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATE_BUCKET`        | S3 bucket for state, trace, and report artifacts                                                                                                                 |
| `AWS_REGION`          | region (default us-west-2)                                                                                                                                       |
| `CONSOLE_BASE`        | debug-console base URL used by the skill's console API search scripts                                                                                            |
| `GOCODE_USE_S2S_AUTH` | `true` → mint IAM JWT per invocation from the Lambda's own execution role (must be GoCode-S2S-registered); `false` → fall back to `gocodeApiKey` in the payload. |
| `ANTHROPIC_BASE_URL`  | GoCode S2S endpoint (`api.gocode.caas.*-gdcorp.tools`) when S2S is on; legacy Anthropic proxy (`caas-gocode-*.onkatana.net`) when off.                           |
| `SSO_HOST`            | SSO host fed to `gd-auth-client` when minting JWT. Ignored when S2S is off.                                                                                      |

The Lambda execution role `${env}-airo-investigator-role` must be
registered with GoCode S2S before flipping `GOCODE_USE_S2S_AUTH=true`.
Open a "Register or Update S2S Access" issue in `gdcorp-dna/gocode` with
the role ARN as the auth identity. See the
[GoCode JWT Authentication Guide](https://godaddy-corp.atlassian.net/wiki/spaces/BI/pages/3903691501)
and [Guide for GoCode Service to Service API Calling for
Dummies](https://godaddy-corp.atlassian.net/wiki/spaces/SECRES/pages/4328456910).

### Rollback

To **restore service** when GoCode S2S is broken, use the **Proper** path
below. The **Fast** path only stops the Lambda from spending 14 minutes
on doomed invocations — it does not put users back in business.

**Fast (mute failures, no deploy, ~30s)** — flip the env var on the
Lambda so the next invocation short-circuits the S2S path. Investigate
clicks then return `"gocodeApiKey required"` immediately (the UI no
longer collects an API key, so this is purely a fail-fast). Use this
while you prepare the proper rollback:

1. AWS console → Lambda → `airo-investigator-<env>` → Configuration →
   Environment variables → edit `GOCODE_USE_S2S_AUTH` from `true` to
   `false` → Save.
2. Next `cdk deploy` will flip this back to `true`; revert the CDK
   change in code before redeploying.

**Proper (restore service via CDK + UI revert)** — required for users
to be able to investigate again:

1. Revert the `GOCODE_USE_S2S_AUTH: 'true'` line in
   `cdk/lib/investigator-stack.ts` (or the whole PR) and redeploy
   `AiroInvestigatorStack`.
2. Re-enable the GoCode API-key UI in
   `debug-console/src/components/InvestigatePanel.tsx` and BFF
   validation in `debug-console/src/app/api/investigate/route.ts`.

No other CDK stacks are touched either way.

## Local build

```
cd investigator
npm install
docker build \
  --build-arg LAMBDA_BASE_TAG=22 \
  -t airo-investigator:dev .
```

Test without AWS:

```
docker run --rm \
  -e STATE_BUCKET=local-bucket \
  -e ANTHROPIC_BASE_URL=https://caas-gocode-prod.caas-prod.prod.onkatana.net \
  -e ANTHROPIC_AUTH_TOKEN=<token> \
  -v /tmp/investigator-out:/tmp \
  airo-investigator:dev \
  handler.handler '{"investigationId":"inv-test","appId":"abc","stateKey":"x","resultKey":"y"}'
```

## Deploy (dev)

1. Deploy `LambdaBaseEcrStack` if the `lambda-nodejs` repo does not exist.
2. Run `.github/workflows/docker-mirror-lambda-base.yml` for the target
   environment and Node tag (currently `22`).
3. Deploy `AiroInvestigatorStack` (see `cdk/lib/investigator-stack.ts`).

## Runtime search strategy

The Lambda runs with more memory so Claude Code gets more proportional CPU:
dev-private uses 4 GiB (~2 vCPU class), prod uses 8 GiB (~4 vCPU class). Both
use a 4 GiB `/tmp` workspace.

The skill uses a coverage-first retrieval strategy for huge log sources:

- scope every query to `appId`, a bounded source list, and a bounded time window,
- call the console `/api/investigate-evidence` endpoint so Loki/ES credentials stay in debug-console,
- write source-specific raw pages and indexes to `/tmp/airo-log-investigate/{appId}/`,
- preserve compact index metadata with status/level counts, top signatures, rare errors, and raw refs,
- have Claude read the index first and drill into only cited raw refs.

The searcher uses a source registry. Registered sources map to console source
ids: `airo-app`, `control_plane`, `airo-agents`, `airo-preview`, and
`airo-publish`. Future sources should be added as registry entries while
preserving the same fetch/index/drilldown contract.

## Runtime user

The Dockerfile ends with `USER 1001` to satisfy container scanning policy.
Keep the preceding `chmod a+rx /lambda-entrypoint.sh /var/runtime/bootstrap`
and recursive `a+rX` permission hardening in place. Lambda starts the AWS base
entrypoint before invoking `handler.handler`, and the non-root runtime user must
be able to read and execute `/var/task`, `/opt/skills`, and `/opt/claude-template`.

If `USER` changes, validate the image on `linux/amd64` before deploying:

```
docker run --rm --platform linux/amd64 airo-investigator:dev handler.handler
```

## Skill updates

The skill lives in this repo under `skills/airo-log-investigate/`; rebuild
the Lambda image to ship changes. No sibling repository token or upstream skill
clone is required for this frontend-only investigator.
