# Orphaned App Cleanup

Each scenario provisions a real app (Docker containers, workspace
directory, MySQL database) via the local control plane. Teardown
deletes the app automatically, but orphans can accumulate if the
harness crashes, is killed, or if `deleteApp` fails mid-cleanup.

## How orphans happen

The teardown in `simulation.ts` runs in a `finally` block, calling
`ctrlPlane.deleteApp(appId)`. This hits the local control plane's
DELETE endpoint, which performs four steps in sequence:

1. `docker compose down --volumes --remove-orphans`
2. `docker.DropDatabase(appId)` (MySQL)
3. `os.RemoveAll(/tmp/airo-app-builder/{appId}/)`
4. `db.DeleteApp(appId)` (SQLite row)

If any step fails, subsequent steps may still run, but the
resources from the failed step persist. If the process is killed
before the `finally` block executes, everything persists.

There is no periodic garbage collection or reconciliation to catch
leaked resources across runs.

## Symptoms

- Docker containers named `preview-<id>` / `publish-<id>` running
  for days
- Growing `/tmp/airo-app-builder/` directory
- Each app consumes ~20 MB on disk plus ~1.1 GB of container image
  footprint (preview + publish)

## Check for orphans

```bash
# List leftover workspace directories
ls /tmp/airo-app-builder/

# List running AAB containers
docker ps --filter "name=preview-" --filter "name=publish-"

# Measure disk usage
du -sh /tmp/airo-app-builder/
```

## Clean up all orphaned apps

```bash
for id in $(ls /tmp/airo-app-builder/ 2>/dev/null); do
  docker compose \
    --project-name "airo-app-$id" \
    down --volumes --remove-orphans 2>/dev/null
  docker stop "preview-${id}-1" "publish-${id}-1" \
    2>/dev/null
  docker rm "preview-${id}-1" "publish-${id}-1" \
    2>/dev/null
  rm -rf "/tmp/airo-app-builder/$id"
done
```
