# notification-service

Node.js service that consumes events from an Amazon Kinesis stream and sends templated email notifications via the GoDaddy messaging API. Also manages deferred reminder and expiry notifications via two dedicated Kinesis streams.

## What it does

For each Kinesis event on the main stream:
1. Extract `eid`, `customerId`, and `appId` — skip if any are missing
2. Look up the email template config for the `eid` via Switchboard
3. Resolve substitution values (`app_name`, `recipient_email`) from mgmt-airo and PIE APIs
4. Skip if either `app_name` or `recipient_email` cannot be resolved
5. Send the email via `POST /v1/messaging/customers/{customerId}/messages`

For deferred reminder/expiry notifications, records are written to dedicated Kinesis streams and replayed by timer-based consumers (see Deferred Consumers below).

## Architecture

```
Main Kinesis Stream
  └─ consumer/kinesis.ts        per-shard poll loops (GetShardIterator → GetRecords)
       └─ processor/event.ts    full pipeline per event
            ├─ extractor/       extract + validate eid / customerId / appId
            ├─ clients/switchboard.ts   template config lookup
            ├─ clients/mgmt.ts          app name + transfer metadata
            ├─ clients/pie.ts           recipient email from targetCustomerId
            └─ clients/messaging.ts     send email

Reminder Kinesis Stream (72h retention)
  └─ consumer/deferred.ts       timer consumer — ticks every 5 min, seeks AT_TIMESTAMP(now − 48h)
       └─ processor/event.ts    same pipeline, filtered to REMINDER_EID only

Expiry Kinesis Stream (96h retention)
  └─ consumer/deferred.ts       timer consumer — ticks every 5 min, seeks AT_TIMESTAMP(now − 72h)
       └─ processor/event.ts    same pipeline, filtered to EXPIRY_EID only
```

### Deferred Consumers

Reminder and expiry emails use a Kinesis-native replay approach instead of EventBridge Scheduler:

- `clients/deferred-kinesis.ts` — writes records to the two dedicated streams when a transfer is initiated (`putReminderRecord`, `putExpiryRecord`). EIDs: `appbuilder.apps.transfer.reminder.24hr` and `appbuilder.apps.transfer.expiry.72hr`.
- `consumer/deferred.ts` — `startTimerConsumer` runs a loop that wakes every 5 minutes, seeks `AT_TIMESTAMP(now − seekMs)` on all open shards, and forwards matching records to `processEvent`. Live Switchboard guards (`transfer_initiated`, `transfer_initiated_or_expired`) skip transfers that have already been completed or cancelled.

### Supervisor loop

`index.ts` runs a supervisor that re-lists open shards every 60 s and starts a new `startShardConsumer` for any shard not yet tracked. This picks up child shards created by a Kinesis reshard without a redeploy.

### Health server

HTTPS server on port 8080 serving `GET /health → 200 { status: "ok" }`. TLS cert/key read from `certs/server.crt` and `certs/server.key` at startup.

## Auth layers

| Client           | Auth           | Credentials                        |
|------------------|----------------|------------------------------------|
| `mgmt.ts`        | Cert SSO JWT   | `MGMT_CERT` + `MGMT_KEY` env vars  |
| `pie.ts`         | Cert SSO JWT   | `MGMT_CERT` + `MGMT_KEY` env vars  |
| `switchboard.ts` | IAM S2S JWT    | AWS credentials via standard chain |
| `messaging.ts`   | IAM S2S JWT    | AWS credentials via standard chain |

## Commands

```bash
pnpm --filter @airo/notification-service dev          # Local dev with hot reload
pnpm --filter @airo/notification-service build        # Compile TypeScript
pnpm --filter @airo/notification-service typecheck    # Type check only
pnpm --filter @airo/notification-service lint         # Lint
```

## Environment

Required vars at startup:

| Variable                      | Default                                 | Notes |
|-------------------------------|-----------------------------------------|-------|
| `KINESIS_STREAM_NAME`         | —                                       | Main event stream |
| `REMINDER_KINESIS_STREAM_NAME`| —                                       | 72h-retention stream for reminder records |
| `EXPIRY_KINESIS_STREAM_NAME`  | —                                       | 96h-retention stream for expiry records |
| `MGMT_AIRO_BASE_URL`          | —                                       | |
| `MGMT_CERT`                   | —                                       | PEM cert for cert-SSO |
| `MGMT_KEY`                    | —                                       | PEM key for cert-SSO |
| `SSO_LOGIN_URL`               | `https://sso.test-godaddy.com/login`    | |
| `MESSAGING_BASE_URL`          | —                                       | |
| `APP_BASE_URL`                | `https://airo-builder.godaddy.com`      | Used in email links |
| `SWITCHBOARD_ENV`             | `test`                                  | `development`, `test`, or `production` |
| `SWITCHBOARD_APP`             | `default\|airo-app-builder`             | |
| `AWS_REGION`                  | `us-west-2`                             | |
