# notification-service

Node.js service that consumes events from an Amazon Kinesis stream and sends templated email notifications via the GoDaddy messaging API.

## What it does

For each Kinesis event:
1. Extract `eid`, `customerId`, and `appId` — skip if any are missing
2. Look up the email template config for the `eid` via Switchboard
3. Resolve substitution values (`app_name`, `recipient_email`) from mgmt-airo and PIE APIs
4. Skip if either `app_name` or `recipient_email` cannot be resolved
5. Send the email via `POST /v1/messaging/customers/{customerId}/messages`

## Architecture

```
Kinesis Stream
  └─ consumer/kinesis.ts       per-shard poll loops (GetShardIterator → GetRecords)
       └─ processor/event.ts   full pipeline per event
            ├─ extractor/      extract + validate eid / customerId / appId
            ├─ clients/switchboard.ts   template config lookup
            ├─ clients/mgmt.ts          app name + transfer list
            ├─ clients/pie.ts           recipient email from targetCustomerId
            └─ clients/messaging.ts     send email
```

## Auth layers

| Client         | Auth              | Credentials                          |
|----------------|-------------------|--------------------------------------|
| `mgmt.ts`      | Cert SSO JWT      | `MGMT_CERT` + `MGMT_KEY` env vars    |
| `pie.ts`       | Cert SSO JWT      | `MGMT_CERT` + `MGMT_KEY` env vars    |
| `switchboard.ts` | IAM S2S JWT     | AWS credentials via standard chain   |
| `messaging.ts` | IAM S2S JWT       | AWS credentials via standard chain   |

## Commands

```bash
pnpm --filter @airo/notification-service dev          # Local dev with hot reload
pnpm --filter @airo/notification-service build        # Compile TypeScript
pnpm --filter @airo/notification-service typecheck    # Type check only
pnpm --filter @airo/notification-service lint         # Lint
```

## Environment

Copy `.env.example` to `.env` and fill in the values. Required vars at startup:

- `KINESIS_STREAM_NAME`
- `MGMT_AIRO_BASE_URL`, `MGMT_CERT`, `MGMT_KEY`, `SSO_LOGIN_URL`
- `MESSAGING_BASE_URL`
- `APP_BASE_URL` (default: `https://airo-builder.godaddy.com`) — used in email links; set to the environment-specific URL in dev/test
- `SWITCHBOARD_ENV` (default: `test`), `SWITCHBOARD_APP` (default: `airo-app-builder`)
- `AWS_REGION` (Switchboard IAM endpoint resolved automatically via credential chain — no `SWITCHBOARD_BASE_URL` needed)
