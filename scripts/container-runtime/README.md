# Container runtime (sandbox parity)

Optional dev-environment affordance for running preview/publish containers on a
kernel that matches production (AlmaLinux 9.7, kernel 5.14, Landlock ABI v6).

Default developer experience is unchanged — Docker Desktop / Colima / Rancher
Desktop / native Linux docker all work as before. Use this only when you need
prod-kernel parity (typically: Landlock sandbox work, cgroup/seccomp behavior,
or reproducing a prod-only container issue).

## What it gives you

Two orthogonal toggles:

| Toggle                          | What it changes                                                                                                                                                            | How to flip                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Container runtime**           | The kernel preview/publish containers run on. Either your host docker (default) or an AlmaLinux 9.7 VM managed by [Lima](https://lima-vm.io).                              | `docker context use airo-sandbox` / `docker context use default` |
| **Dev-supervisor sandbox flag** | Whether `DEV_SUPERVISOR_SANDBOX_ENABLED=true` is in `.envrc.local`. Once the container pass-through lands on the enable-sandbox branch, this propagates to each container. | `pnpm run sandbox:on` / `pnpm run sandbox:off`                   |

The toggles are independent on purpose. You can run the AlmaLinux VM with
sandboxing off (kernel-parity only) or sandboxing on against Docker Desktop
(expected to fail loudly when landlock syscalls aren't available — useful for
testing error paths). See the table below for expected behavior.

| Context                                    | Sandbox flag | Result                                                                                 |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------------- |
| `default` (Docker Desktop / Colima / etc.) | off          | Normal dev. Same as today.                                                             |
| `default`                                  | on           | Sandbox code runs; landlock calls fail on LinuxKit kernel. Loud, explicit error.       |
| `airo-sandbox` (Lima VM)                   | off          | Containers run on AlmaLinux kernel without sandboxing. Kernel-parity baseline for A/B. |
| `airo-sandbox`                             | on           | Full prod-parity: AlmaLinux kernel + landlock enforcement.                             |

## One-time setup

```bash
pnpm run runtime:sandbox:setup
```

This will:

1. Install [Lima](https://lima-vm.io) via Homebrew if missing. **macOS only
   today** — `runtime:sandbox:*` commands hard-fail on other platforms. Linux
   hosts already run on a kernel compatible with production, so no VM is
   needed; use `pnpm run sandbox:on/off` directly. WSL support is a future
   addition.
2. Create and start the `airo-sandbox` Lima VM from
   [`lima/airo-sandbox.yaml`](lima/airo-sandbox.yaml) (~1–2 min, downloads an
   AlmaLinux 9 cloud image).
3. Register a `airo-sandbox` docker context that points at the VM's docker
   daemon via a forwarded unix socket.
4. Health-check by querying kernel version.

The VM is idempotent — re-running `setup` is safe. If the VM is stopped it
starts it; if everything is already running it confirms and exits.

## Daily use

```bash
# Enable full prod-parity for this repo
docker context use airo-sandbox
pnpm run sandbox:on
direnv reload                    # or open a new shell in the repo

pnpm run dev                     # normal dev flow; preflight shows context + kernel

# Revert
docker context use default
pnpm run sandbox:off
direnv reload
```

The dev-runner preflight reports both pieces of state:

```
Tools
  ✓ Docker       context=airo-sandbox, kernel=5.14.0-611.54.3.el9_7.aarch64
  ✓ Sandbox      DEV_SUPERVISOR_SANDBOX_ENABLED=true
```

(Press `v` in the preflight view to expand passing checks.)

## Teardown

```bash
pnpm run runtime:sandbox:teardown   # removes VM + docker context
pnpm run sandbox:off                # clears the env var
```

## Commands reference

| Command                             | What it does                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm run runtime:sandbox:setup`    | Install Lima, start the `airo-sandbox` VM, create the docker context, health-check. Idempotent. |
| `pnpm run runtime:sandbox:teardown` | Reverse of setup. Stops and deletes the VM, removes the docker context.                         |
| `pnpm run runtime:sandbox:status`   | Reports VM state, context presence, active context, and (if active and running) kernel.         |
| `pnpm run sandbox:on`               | Writes `export DEV_SUPERVISOR_SANDBOX_ENABLED=true` to `.envrc.local`.                          |
| `pnpm run sandbox:off`              | Removes that line.                                                                              |
| `pnpm run sandbox:status`           | Shows the current `.envrc.local` value and the current shell value (warns if they differ).      |

None of these run automatically as part of `pnpm run dev`. They are explicit
one-shots — the preflight only reports state, it does not change it.

## Troubleshooting

**`docker --context airo-sandbox info` fails with EOF or permission denied
immediately after setup.**
Lima's hostagent holds an SSH session open for socket forwarding that was
established before provisioning added the lima user to the `docker` group.
`manage.sh` stops and restarts the VM at the end of first-time creation to
force a fresh session; if you hit this on a VM created before that fix, run:

```bash
limactl stop airo-sandbox && limactl start airo-sandbox
```

**`.envrc.local` changes don't apply.** direnv only reloads when you `cd`
back into the repo or explicitly `direnv reload`. The `sandbox:on` script
reminds you.

**Bind mounts from `/tmp/airo-app-builder/...` aren't visible in the VM.**
The Lima config mounts that path via virtiofs. If you moved your app
workspace elsewhere, add it to the `mounts:` block in `airo-sandbox.yaml` and
re-run setup.

**Port forwarding from containers.** Lima auto-forwards ports bound on
`0.0.0.0` inside the VM. Containers binding `127.0.0.1` only inside the VM
aren't reachable from the host — bind to `0.0.0.0` or extend `portForwards:`
in the yaml.

**Apple Silicon running `linux/amd64` images.** Enabled via Rosetta (see
`vmOpts.vz.rosetta` in the yaml). Noticeably faster than qemu, marginally
slower than Docker Desktop's Rosetta integration. No extra steps needed.

## Files

| Path                                               | Purpose                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`lima/airo-sandbox.yaml`](lima/airo-sandbox.yaml) | Lima VM config (AlmaLinux 9.7, docker-ce, mounts, port forwards).               |
| [`lima/manage.sh`](lima/manage.sh)                 | `setup` / `teardown` / `status` subcommands.                                    |
| [`sandbox-flag.sh`](sandbox-flag.sh)               | `on` / `off` / `status` subcommands for the env flag.                           |
| `.envrc` (repo root)                               | Sources `.envrc.local` before other setup so the flag is visible to dev-runner. |
| `.gitignore` (repo root)                           | Ignores `.envrc.local`.                                                         |

## Related

- [`dev-supervisor/docs/SANDBOX.md`](../../dev-supervisor/docs/SANDBOX.md) —
  architecture of the sandbox itself and what the flag controls.
- Per-runtime implementations (future) will sit in sibling directories, e.g.
  `scripts/container-runtime/wsl/` for Windows + WSL, `scripts/container-runtime/colima/`
  if we replace Lima with Colima.
