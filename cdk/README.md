# Airo Builder CDK

AWS CDK (v2, TypeScript) app that provisions the infrastructure for Airo Builder across `dev`, `test`, and `prod` accounts.

## Stacks

Defined in `app/main.ts` and registered in the `STACK_NAME` input of `.github/workflows/cdk.yml`:

| Stack                    | Purpose                                                             | Environments    |
| ------------------------ | ------------------------------------------------------------------- | --------------- |
| `AiroBuilderStack`       | IAM role granting GoCode access (trust policy + execute-api:Invoke) | dev, test, prod |
| `MySQLV2Stack`           | Aurora MySQL cluster                                                | dev, test, prod |
| `PostgresStack`          | Aurora PostgreSQL cluster                                           | dev, test, prod |
| `AiroJWTKeyStack`        | JWT signing keys (Secrets Manager) with scheduled rotation          | dev, test, prod |
| `AiroStripeServiceStack` | DynamoDB + RSA KMS + Secrets Manager entries for stripe-service     | dev             |
| `GocaasSpendLambdaStack` | Lambda that syncs GoCode spend logs to ESSP                         | dev, prod       |
| `EvalSnapshotsStack`     | S3 bucket + IAM for eval snapshots                                  | dev, prod       |
| `OfflineMLDataS3Stack`   | S3 bucket + IAM for offline ML datasets and artifacts               | dev, test, prod |
| `FeedbackS3Stack`        | S3 bucket + IAM for user feedback                                   | dev, prod       |
| `EventsS3Stack`          | S3 bucket + IAM for airo builder events (`airo_builder_events_cln`) | dev, test, prod |
| `QdrantEcrStack`         | ECR repo for the Qdrant image                                       | dev, prod       |
| `QdrantVectorDbStack`    | 3-node Qdrant cluster on Fargate (see `docs/stacks/qdrant.md`)      | dev, prod       |
| `ImageSearchStack`       | IAM + Secrets Manager for image-search-service                      | dev             |
| `MonitoringStack`        | CloudWatch alarms and alert integrations                            | dev, test, prod |

Per-stack documentation lives under `docs/stacks/` when it exists. Add a new file using the template in `docs/stacks/README.md` when deploying a new stack.

## Environment selection

`ENV_NAME` picks the config block from `lib/config.ts` and the target AWS account/region:

| ENV_NAME | Account        | Region    |
| -------- | -------------- | --------- |
| `dev`    | `694282668781` | us-west-2 |
| `test`   | `269423819739` | us-west-2 |
| `prod`   | `644094189644` | us-west-2 |

## Prerequisites

- Node.js (version pinned by the monorepo, see root `.nvmrc` / `packageManager` in `package.json`).
- `pnpm install` at the monorepo root (CDK lives inside the workspace).
- AWS CLI with an SSO profile for the target account. Examples:
  - dev: `airobuild-dev-private-sso` (account `694282668781`, permission set `PowerUser`).
  - test/prod: see team runbook.
- `gh` CLI authenticated to `gdcorp-partners/airo-app-builder` (for the GitHub Actions path).

Before any local command: `aws sso login --profile <profile>`.

## Deploy

### Option A: GitHub Actions (recommended)

The `cdk.yml` workflow handles Artifactory authentication automatically and runs on self-hosted CI runners. Always run `diff` first and review the CloudFormation change set before `deploy`.

```bash
# Diff against current state
gh workflow run cdk.yml \
  -f ENV_NAME=dev \
  -f STACK_NAME=AiroBuilderStack \
  -f DEFAULT_ACTION=diff

# Deploy once diff looks right
gh workflow run cdk.yml \
  -f ENV_NAME=dev \
  -f STACK_NAME=AiroBuilderStack \
  -f DEFAULT_ACTION=deploy

# Watch progress
gh run watch
```

Valid inputs:

- `ENV_NAME`: `dev`, `test`, `prod`
- `STACK_NAME`: any stack from the table above, or `--all` for every stack
- `DEFAULT_ACTION`: `diff` or `deploy`

### Option B: Local deploy

Local deploys need Artifactory auth because CDK synthesizes all stacks during every command, and `GocaasSpendLambdaStack` uses Docker bundling that pulls `@godaddy/*` packages.

```bash
cd cdk

# 1. Get an Artifactory token (ask a teammate or use JFrog CLI).
# 2. Create an .npmrc for the lambda that needs it:
cat > lambda/gocode-spend-essp-exporter/.npmrc <<EOF
always-auth=true
@godaddy:registry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/
//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=YOUR_TOKEN_HERE
EOF

# 3. Build TypeScript
pnpm run build

# 4. Diff then deploy. ENV_NAME selects the config block.
AWS_PROFILE=airobuild-dev-private-sso ENV_NAME=dev npx cdk diff AiroBuilderStack
AWS_PROFILE=airobuild-dev-private-sso ENV_NAME=dev npx cdk deploy AiroBuilderStack
```

Do not commit the generated `.npmrc` - it's per-developer and contains a personal token.

## Useful commands

```bash
pnpm run build           # tsc
pnpm run watch           # tsc -w
ENV_NAME=dev npx cdk ls  # list stack names resolved by the current config
ENV_NAME=dev npx cdk synth AiroBuilderStack   # emit CloudFormation template
```

## Editing config

`lib/config.ts` is the single source of truth for environment-specific values. Changes there require a `diff`/`deploy` cycle to take effect in AWS. Never hard-code env values in stack files.

## Troubleshooting

- **`npm ERR! code E401` during `cdk synth`/`deploy`** - Artifactory token missing or expired. Recreate the `.npmrc` (see local deploy above) or use the GitHub Actions path.
- **`Unable to resolve AWS account to use`** - run `aws sso login --profile <profile>` and pass `AWS_PROFILE=<profile>` to the cdk command.
- **Trust-policy update didn't take effect** - confirm the deploy succeeded against the expected account (`aws sts get-caller-identity`) and that the role's `AssumeRolePolicyDocument` in the AWS console matches the new ARN.
