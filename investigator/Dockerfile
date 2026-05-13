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
FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG}

# System deps needed by the frontend log skill.
# Weak-dep suppression was tried via --setopt=install_weak_deps but the
# dnf build shipped in the Lambda base rejects both `False` and `false`.
RUN dnf install -y \
      python3 \
      jq \
      bc \
      tar \
      gzip \
  && dnf clean all \
  && rm -rf /var/cache/dnf

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
RUN npm install --omit=dev --no-audit --no-fund
COPY handler.mjs prompt.mjs events.mjs ./

# Lambda invokes the image as its own least-privileged runtime user, not
# necessarily the user Docker used during local tests. Make startup/runtime
# files explicitly readable/executable for that sandbox user so ECR mirror or
# base-image permission quirks cannot surface as Runtime.InvalidEntrypoint.
RUN chmod a+rx /lambda-entrypoint.sh /var/runtime/bootstrap \
  && chmod -R a+rX "${LAMBDA_TASK_ROOT}" /opt/skills /opt/claude-template

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
