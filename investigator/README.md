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

| Var                  | Purpose                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATE_BUCKET`       | S3 bucket for state, trace, and report artifacts                                                                                                   |
| `AWS_REGION`         | region (default us-west-2)                                                                                                                         |
| `CONSOLE_BASE`       | debug-console base URL used by the skill's console API search scripts                                                                              |
| `ANTHROPIC_BASE_URL` | GoCode proxy URL; the per-user GoCode API key is forwarded per invocation as `gocodeApiKey` and loaded into `ANTHROPIC_AUTH_TOKEN` only at runtime |

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
