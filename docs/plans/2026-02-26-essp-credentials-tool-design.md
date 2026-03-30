---
status: implemented
---

# ESSP Credentials Tool

## Problem

When debugging apps deployed to katana (app dir, image-search-service, debug-console), logs live in an Elasticsearch cluster. Credentials are in AWS Secrets Manager (`essp_deployment_credentials`). Currently there's no convenient way to fetch these credentials and query ES without exposing them as CLI args.

## Design

### 1. Extend AWS SSO setup with prod profile

Add `airobuild-prod-sso` profile to `setup/src/aws-sso.ts`:

- Account ID: `644094189644`
- Role: `Ops`
- Same SSO session (`airo-sso`) and start URL as dev

Both profiles are configured sequentially during setup.

### 2. New script: `scripts/essp-creds.sh`

Bash script that:

- Takes environment arg: `dev` (default) or `prod`
- Maps to AWS profile: `airobuild-dev-private-sso` / `airobuild-prod-sso`
- Fetches `essp_deployment_credentials` from Secrets Manager
- Writes `/tmp/essp-creds-{env}.env` (mode 600) with: `ES_ENDPOINT`, `ES_USER`, `ES_PASSWORD`
- Creates `/tmp/essp-query-{env}.sh` wrapper that reads creds from env file and passes to curl

### Credential fields

From the secret JSON (matching existing lambda pattern):

- `ingestion_url` -> `ES_ENDPOINT`
- `ingestion_user` -> `ES_USER`
- `ingestion_user_password` -> `ES_PASSWORD`

### Usage

```bash
# Fetch credentials
./scripts/essp-creds.sh dev
./scripts/essp-creds.sh prod

# Query ES (credentials never in ps output)
/tmp/essp-query-dev.sh '/_cat/indices?v'
/tmp/essp-query-dev.sh '/llm_spend_model_daily/_search' -d '{"query":{"match_all":{}}}'
```
