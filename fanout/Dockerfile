# syntax=docker/dockerfile:1.6
#
# Lambda container image for Airo Builder feedback fan-out runner.
#
# Triggered by S3 ObjectCreated events on the feedback parquet bucket. Reads
# the parquet row, fans out to Slack/CRM/Jira, and persists per-app
# state to S3. No long-lived secrets live in the image — CRM cert + Slack
# webhook + Switchboard token are read from Secrets Manager at invoke time.
#
# Base image: private ECR mirror of public.ecr.aws/lambda/nodejs:<tag>
#
# LAMBDA_BASE_REPO and LAMBDA_BASE_TAG are set by CDK buildArgs to the private
# ECR mirror (<account>.dkr.ecr.us-west-2.amazonaws.com/lambda-nodejs:<tag>).
# Populate the mirror with .github/workflows/docker-mirror-lambda-base.yml
# before deploying FeedbackFanoutStack. Defaults support local builds.
ARG LAMBDA_BASE_REPO=public.ecr.aws/lambda/nodejs
ARG LAMBDA_BASE_TAG=22
# nosemgrep: godaddy.docker.audit.golden-container-images.use-of-gci-for-container-images -- CDK buildArgs override LAMBDA_BASE_REPO to the GCI-compliant mirror at <account>.dkr.ecr.us-west-2.amazonaws.com/lambda-nodejs (see cdk/lib/feedback-fanout-stack.ts and cdk/lib/lambda-base-ecr-stack.ts). The public.ecr.aws default is a local-build fallback only — production deploys never use it.
FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG}

# Handler
WORKDIR ${LAMBDA_TASK_ROOT}
COPY package.json ./
# Fan-out Lambda has no private-registry dependencies (only AWS SDK and
# parquetjs from public npm), so unlike investigator/Dockerfile this build
# does not need an .npmrc bind-mount for Artifactory auth.
RUN npm install --omit=dev --no-audit --no-fund
COPY handler.mjs cert-loader.mjs crm-client.mjs crm-token.mjs \
     jira-client.mjs jira-mapping.mjs jira-eligibility.mjs logger.mjs \
     parquet-reader.mjs secret-cache.mjs slack.mjs slack-builders.mjs \
     slack-format.mjs state.mjs ./

# Lambda invokes the image as its own least-privileged runtime user, not
# necessarily the user Docker used during local tests. Make startup/runtime
# files explicitly readable/executable for that sandbox user so ECR mirror or
# base-image permission quirks cannot surface as Runtime.InvalidEntrypoint.
RUN chmod a+rx /lambda-entrypoint.sh /var/runtime/bootstrap \
  && chmod -R a+rX "${LAMBDA_TASK_ROOT}"

# Belt-and-suspenders for Lambda container startup: the base entrypoint normally
# derives _HANDLER from CMD, but setting it explicitly prevents blank-handler
# starts when CMD propagation is lost by an image/config layer.
ENV _HANDLER=handler.handler

# Run as a non-root UID to satisfy container scanning policy. Keep this after
# chmod so Lambda's base entrypoint, bootstrap, and /var/task remain
# readable/executable by the runtime user.
USER 1001

# nosemgrep: dockerfile.security.missing-user.missing-user -- USER 1001 above is the final runtime user before CMD.
CMD ["handler.handler"]
