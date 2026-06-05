# syntax=docker/dockerfile:1.6
#
# Lambda container image for Airo Builder investigation runner.
#
# Runs Claude CLI against the repo-owned airo-log-investigate skill inside a Lambda
# invocation. Credentials and per-invocation parameters come from the invoke
# payload; no long-lived secrets or investigation state live in the image.
#
# Base image: private ECR mirror of public.ecr.aws/lambda/nodejs:<tag>
#
# LAMBDA_BASE_REPO and LAMBDA_BASE_TAG are set by CDK buildArgs to the private
# ECR mirror (<account>.dkr.ecr.us-west-2.amazonaws.com/lambda-nodejs:<tag>).
# Populate the mirror with .github/workflows/docker-mirror-lambda-base.yml before
# deploying AiroInvestigatorStack. Defaults support local builds.
ARG LAMBDA_BASE_REPO=public.ecr.aws/lambda/nodejs
ARG LAMBDA_BASE_TAG=22

# ---------------------------------------------------------------------------
# Stage 1 (pybuild): install the python code-review-graph (CRG) deps into a
# relocatable --target dir. Kept in a separate stage so the gcc/make/git build
# toolchain never ships in the runtime image — only the resolved
# /opt/py-packages tree is copied forward. The platform graph is no longer
# baked here; it is fetched from S3 at runtime (see Task 3.3 note below).
#
# Pinned by the Task 0.1 spike (docs/superpowers/notes/2026-06-02-
# investigate-pydeps-mcp-spike.md):
#   - python via dnf python3.11 + python3.11-pip.
#   - LD_LIBRARY_PATH=/usr/lib64 REQUIRED in BOTH stages (else python ssl/pip
#     resolve against Node's bundled libcrypto in /var/lang and break).
#   - `python3.11 -m pip install --target /opt/py-packages ...` works.
# ---------------------------------------------------------------------------
FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG} AS pybuild

# REQUIRED: prefer the system OpenSSL over Node's bundled libcrypto so python's
# ssl import (and therefore pip's TLS) resolves. See spike note above.
ENV LD_LIBRARY_PATH=/usr/lib64

RUN dnf install -y python3.11 python3.11-pip gcc gcc-c++ make git \
  && dnf clean all \
  && rm -rf /var/cache/dnf

# Resolve the CRG + drain3 deps into a relocatable target dir (spike 0.1).
RUN python3.11 -m pip install --target /opt/py-packages code-review-graph drain3

# NOTE: the platform code-review-graph is NO LONGER baked into the image
# (Task 3.3). It is rebuilt twice a day by .github/workflows/refresh-platform-
# graph.yml — which composes a source-only tree (agents/src + app/src +
# app-templates, node_modules/build excluded), runs an incremental
# `code-review-graph update` (full `build --skip-flows` on a cold cache), and
# uploads the resulting graph.db to S3 at `platform-graph/graph.db` only when
# its sha256 changed. The Lambda fetches it at invocation time
# (investigator/platform-graph.mjs, ETag-cached + soft-fail). This keeps the
# image small/fast to build, lets the graph cover the whole platform (not just
# the investigator tree the old `COPY .` context was limited to), and refreshes
# without a redeploy.

# ---------------------------------------------------------------------------
# Stage 2 (runtime): the actual Lambda image.
# ---------------------------------------------------------------------------
FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG}

# REQUIRED in the runtime stage too (spike 0.1): python3.11's ssl import and
# the CRG MCP server both need the system OpenSSL ahead of Node's libcrypto.
ENV LD_LIBRARY_PATH=/usr/lib64

# System deps:
#   - python3.11: runs the CRG MCP server + customer-graph build, and (via the
#     skill wrappers + PYTHONPATH=/opt/py-packages) gives the skill drain3.
#   - python3: kept so anything still resolving bare `python3` (stdlib-only)
#     keeps working; the skill wrappers now prefer python3.11 explicitly.
#   - git/unzip: git for CRG's tree walk; unzip for the customer app zip.
#   - jq/bc/tar/gzip: existing frontend log skill deps.
# Weak-dep suppression was tried via --setopt=install_weak_deps but the
# dnf build shipped in the Lambda base rejects both `False` and `false`.
RUN dnf install -y \
      python3.11 \
      python3 \
      git \
      unzip \
      jq \
      bc \
      tar \
      gzip \
  && dnf clean all \
  && rm -rf /var/cache/dnf

# CRG python deps from the build stage. The platform graph is fetched from S3
# at runtime (platform-graph.mjs), so nothing graph-related is copied here.
COPY --from=pybuild /opt/py-packages /opt/py-packages

# Make the CRG deps importable by python3.11 (MCP server + customer build) and
# by the skill wrappers (drain3 / urllib3 fallbacks are import-guarded).
ENV PYTHONPATH=/opt/py-packages

# Claude Code CLI — pin to a concrete version so two rebuilds of the same
# commit produce identical runtime behavior. `@latest` previously drifted
# between builds; that's how CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS had
# to be introduced mid-deploy (a CLI bump started sending
# `context_management` which the GoCode proxy rejects). Bump this ARG
# deliberately in PRs.
ARG CLAUDE_CLI_VERSION=2.1.131
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}

# Repo-owned Claude skill. This PR intentionally avoids the broad upstream
# feedback skill and limits the runtime to airo-app frontend log investigation.
COPY skills/ /opt/skills/

# Pre-seeded Claude state layout. Rehydrated into /tmp/.claude at cold
# start because Lambda's filesystem is read-only outside /tmp.
COPY docker/claude-template/ /opt/claude-template/

# Handler
WORKDIR ${LAMBDA_TASK_ROOT}
COPY package.json ./
# gd-auth-client lives in GoDaddy's private Artifactory registry. The CI
# pipeline writes `.npmrc` (with auth token) into this build context before
# calling `cdk deploy`. We bind-mount it for the install only — never
# COPYing it — so the token does not end up in any image layer.
#
# Local dev: drop a valid `.npmrc` (with Artifactory auth) into
# `investigator/` before running `docker build`. Without it BuildKit
# aborts with `could not find source path "/.npmrc"` because
# `type=bind` does not accept `required=false` (that flag only exists
# for `type=secret`, which would in turn require switching CI to
# `docker buildx build --secret id=npmrc,...` — out of scope).
RUN --mount=type=bind,source=.npmrc,target=/root/.npmrc \
    npm install --omit=dev --no-audit --no-fund
COPY handler.mjs auth.mjs prompt.mjs events.mjs \
     cert-loader.mjs crm-token.mjs crm-casenote.mjs \
     evidence-loader.mjs agent-jwt.mjs agent-fetch.mjs graph-setup.mjs \
     platform-graph.mjs verifier.mjs activity.mjs lessons.mjs ./

# Lambda invokes the image as its own least-privileged runtime user, not
# necessarily the user Docker used during local tests. Make startup/runtime
# files explicitly readable/executable for that sandbox user so ECR mirror or
# base-image permission quirks cannot surface as Runtime.InvalidEntrypoint.
RUN chmod a+rx /lambda-entrypoint.sh /var/runtime/bootstrap \
  && chmod -R a+rX "${LAMBDA_TASK_ROOT}" /opt/skills /opt/claude-template \
       /opt/py-packages

# Belt-and-suspenders for Lambda container startup: the base entrypoint normally
# derives _HANDLER from CMD, but setting it explicitly prevents blank-handler
# starts when CMD propagation is lost by an image/config layer.
ENV _HANDLER=handler.handler

# Run as a non-root UID to satisfy container scanning policy. Keep this after
# chmod so Lambda's base entrypoint, bootstrap, /var/task, and /opt skill files
# remain readable/executable by the runtime user.
USER 1001

# nosemgrep: dockerfile.security.missing-user.missing-user -- USER 1001 above is the final runtime user before CMD.
CMD ["handler.handler"]
