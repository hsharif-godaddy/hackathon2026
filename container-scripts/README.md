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
    └── coming-soon.js                 # Fallback server for publish containers
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

## Script Descriptions

### Preview Scripts

- **nomad_setup.sh**: Initializes the preview workspace by syncing template files and package.json additions. Used for mode-based conditional startup (deferred setup).
- **dev-supervisor-healthcheck.sh**: Health check script that queries the dev-supervisor API to verify the container is healthy.
- **sync-package-additions.js**: Node.js utility that merges package.json additions from the base template into the customer's package.json.
- **sync-template-files.js**: Node.js utility that syncs template files to the workspace using rsync with proper exclusions.

### Publish Scripts

- **run-app.sh**: Main entrypoint for publish containers. Handles tarball extraction, npm installation, and application startup.
- **coming-soon.js**: Fallback Express server that displays a "Coming Soon" page when the application is not yet ready.

## Container Paths

Scripts are copied to these locations inside containers:

**Preview containers:**
- `/management-scripts/nomad_setup.sh`
- `/management-scripts/sync-package-additions.js`
- `/management-scripts/sync-template-files.js`
- `/usr/local/bin/dev-supervisor-healthcheck.sh`

**Publish containers:**
- `/publish/run-app.sh`
- `/publish/coming-soon.js`

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
