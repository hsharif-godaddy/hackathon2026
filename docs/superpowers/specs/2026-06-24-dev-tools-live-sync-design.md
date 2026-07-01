# Dev Tools Live Sync Design

## Goal

Reduce local development friction by automatically syncing repo edits to `app-templates/v8/dev-tools` and `app-templates/v8/source-mapper` into already-running local preview workspaces.

## Problem

Local preview containers mount each generated app workspace from `/tmp/airo-app-builder/<appId>/preview` as `/app`. The initial workspace is copied from `app-templates/v8`, and restart setup can rsync internal template tooling from the image's `/app-template`, but edits made in the repo after the preview is running do not reach `/app` automatically. Developers currently need to ask an agent to rsync files or rebuild/recreate the preview container.

## Scope

Sync only these internal tooling folders:

- `app-templates/v8/dev-tools`
- `app-templates/v8/source-mapper`

Do not sync broader customer-owned template files such as `src/**`, `index.html`, or `vite.config.ts`. Those files can be user-modified and already have separate template-sync/hash-gating behavior.

## Recommended Approach

Add an always-on local live sync loop to `local-control-plane`.

On local-control-plane startup, start a background watcher that:

1. Finds the source template folders from existing local-control-plane configuration:
   - `APP_TEMPLATE_DIR`, or
   - `PROJECT_ROOT/app-templates/v8`, falling back to the current default behavior.
2. Polls `dev-tools` and `source-mapper` for file modification changes.
3. Rsyncs each changed folder into every existing local preview workspace under `APPS_BASE_DIR`:
   - `/tmp/airo-app-builder/<appId>/preview/dev-tools`
   - `/tmp/airo-app-builder/<appId>/preview/source-mapper`

Use the existing host bind mount from preview workspace to container `/app`; Vite should observe the synced file changes normally.

## Behavior

- Run always in local development when local-control-plane runs.
- Poll about once per second.
- Sync all local preview workspaces found under `APPS_BASE_DIR`, not only the currently active app.
- Use `rsync -a --delete` so removed files are removed from preview workspaces too.
- Exclude generated/heavy folders:
  - `node_modules`
  - `dist`
  - `.turbo`
  - `.vite`
- Do not commit synced tooling changes in preview git repos.
- If there are no preview workspaces, do nothing.
- If a source folder does not exist, log and skip it.
- If `rsync` fails or is unavailable, log and continue running local-control-plane.

## Components

Add a small package under `local-control-plane/internal/templatesync` with one clear responsibility: live syncing internal template tooling into local preview workspaces.

Public surface:

```go
func Start(ctx context.Context, logger *slog.Logger)
```

`Start` returns immediately after launching the background loop. `cmd/server/main.go` starts it after Docker reconciliation and before serving HTTP. The loop exits when the server context is canceled.

## Logging

Use existing `slog` style. Suggested event names:

- `template.live_sync.start`
- `template.live_sync.changed`
- `template.live_sync.synced`
- `template.live_sync.skip`
- `template.live_sync.failed`

Include useful fields such as `source`, `destination`, `folder`, `app_id`, and `error`.

## Error Handling

Live sync is convenience infrastructure. It must not block local-control-plane startup or app creation. Recoverable failures are logged and retried on the next polling cycle.

## Alternatives Considered

### Bind-mount repo folders into preview containers

Mounting repo `dev-tools` and `source-mapper` directly into `/app` would be simple for newly created or recreated containers, but it does not help already-running containers. It also requires compose changes and container recreation to take effect.

### Manual sync command or dev-runner hotkey

A manual command would reduce command lookup friction, but it keeps the sync manual. The desired behavior is automatic propagation while editing.

### File watcher dependency

A dependency such as fsnotify would work, but it is unnecessary for two small source folders. Simple Go polling avoids dependency and platform-watch edge cases.

## Testing

Add focused Go unit tests for:

- path resolution from `APP_TEMPLATE_DIR`, `PROJECT_ROOT`, and `APPS_BASE_DIR` defaults;
- preview workspace discovery under temp directories;
- excluded folder handling;
- change detection triggering sync after mtimes change.

Do not add Docker integration tests for this feature.

## Acceptance Criteria

- Editing `app-templates/v8/dev-tools/**` locally updates `/tmp/airo-app-builder/<appId>/preview/dev-tools/**` for already-running local apps.
- Editing `app-templates/v8/source-mapper/**` locally updates `/tmp/airo-app-builder/<appId>/preview/source-mapper/**` for already-running local apps.
- Deleted files are removed from preview copies.
- Generated/heavy folders are not synced: package installs (`node_modules`), build output (`dist`), and tool caches (`.turbo`, `.vite`).
- local-control-plane stays up if sync fails.
