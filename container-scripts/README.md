# Container Scripts

This directory contains all scripts used by the preview and publish Docker containers. These scripts are infrastructure utilities and are not part of the customer app template.

## Directory Structure

```
container-scripts/
├── preview/              # Scripts for preview containers (development mode)
│   ├── nomad_setup.sh                 # Setup script for preview workspace initialization
│   ├── dev-supervisor-healthcheck.sh  # Health check script for dev-supervisor
│   ├── sync-package-additions.js      # Syncs package.json additions from template
│   └── sync-template-files.js         # Syncs template files to workspace
│
└── publish/              # Scripts for publish containers (production mode)
    ├── run-app.sh                     # Main startup script for publish container
    ├── build-and-run.sh               # Fallback: build from source when no pre-built artifacts
    ├── common.sh                      # Shared utility functions (logging, env file creation)
    └── entrypoint.sh                  # Dev-supervisor wrapper entrypoint (used by pioneer-infra)
```

## Usage

These scripts are provided to Docker builds via the `--build-context container-scripts` flag:

**Preview Image (Dockerfile.dev):**

```bash
docker build \
  --build-context container-scripts=container-scripts \
  -f app-templates/v8/Dockerfile.dev \
  app-templates/v8/
```

**Publish Image (app-publish/Dockerfile.dev):**

```bash
docker build \
  --build-context container-scripts=container-scripts \
  -f app-publish/Dockerfile.dev \
  app-publish/
```

**Pioneer-infra Publish Dockerfile:**
The production Dockerfile in `pioneer-infra/docker/airo-app-builder-publish/` copies scripts from `app/container-scripts/publish/` — this repo is the single source of truth.

## Script Descriptions

### Preview Scripts

- **nomad_setup.sh**: Initializes the preview workspace by syncing template files and package.json additions. Used for mode-based conditional startup (deferred setup).
- **dev-supervisor-healthcheck.sh**: Health check script that queries the dev-supervisor API to verify the container is healthy.
- **sync-package-additions.js**: Node.js utility that merges package.json additions from the base template into the customer's package.json.
- **sync-template-files.js**: Node.js utility that syncs template files to the workspace using rsync with proper exclusions.

### Publish Scripts

- **run-app.sh**: Main startup script for publish containers. Extracts pre-built tarballs, handles Nomad configuration (no-op locally), and starts the application. Falls back to `build-and-run.sh` when no pre-built artifacts are found.
- **build-and-run.sh**: Fallback build script for non-pre-built archives. Detects the package manager (npm or pnpm), installs dependencies, runs the build, applies database migrations, and starts the app.
- **common.sh**: Shared utility functions used by `run-app.sh` and `build-and-run.sh`. Provides logging helpers (`log`, `log_warn`, `error_exit`), environment file creation, and default configuration.
- **entrypoint.sh**: One-liner wrapper that starts dev-supervisor with `run-app.sh` as the managed process. Used as the Docker ENTRYPOINT in the pioneer-infra production Dockerfile. In local dev, `Dockerfile.dev` uses dev-supervisor directly as ENTRYPOINT instead.

The "Coming Soon" / "Site Suspended" pages previously served by a Node `status-page.js` process are now served directly by dev-supervisor's HTTP proxy from an embedded HTML template. `SUSPENDED=true` causes dev-supervisor to skip launching `run-app.sh` entirely, and `STATUS_PAGE_TITLE` / `STATUS_PAGE_MESSAGE` env var overrides are read at startup.

## Container Paths

Scripts are copied to these locations inside containers:

**Preview containers:**

- `/management-scripts/nomad_setup.sh`
- `/management-scripts/sync-package-additions.js`
- `/management-scripts/sync-template-files.js`
- `/usr/local/bin/dev-supervisor-healthcheck.sh`

**Publish containers:**

- `/publish/run-app.sh`
- `/publish/build-and-run.sh`
- `/publish/common.sh`
- `/publish/entrypoint.sh`

## Development

When modifying these scripts:

1. Update the script in the appropriate `preview/` or `publish/` directory
2. Test locally with Docker build
3. Verify in CI that the Docker build succeeds
4. Test end-to-end with actual container startup

## References

- Preview Dockerfile: `app-templates/v8/Dockerfile.dev`
- Publish Dockerfile: `app-publish/Dockerfile.dev`
- Docker Compose Generator: `app/src/lib/dev-environment/services/docker-compose-generator.ts`
- CI Workflow: `.github/workflows/docker-build-v8-template.yml`
