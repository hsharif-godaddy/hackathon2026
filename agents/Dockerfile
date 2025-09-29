ARG UPSTREAM_VERSION=22

FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine

ARG ARTIFACTORY_NPM_TOKEN

USER root

# Install python and build tools
RUN apk add --no-cache python3 py3-setuptools make g++ git

# Install pnpm
RUN npm install -g pnpm
ENV CI=true
# create the group and user
# hardcoded the GID of the agent group to 790, UID of the agent user to 790 for now
RUN addgroup -S -g 790 agent
RUN adduser -S -G agent -u 790 agent

COPY --chown=agent:agent ./agents /app

RUN mkdir -p /packages/ && chown -R agent:agent /packages/

COPY --chown=agent:agent ./packages/ai-lib /packages/ai-lib

RUN ls -l /app && ls -l /packages/ai-lib

RUN rm -f /app/management-scripts/*.sh

# create the management-scripts directory and set ownership
RUN mkdir -p /management-scripts
RUN chown agent:agent /management-scripts

# copy management-scripts/ to /management-scripts
COPY --chown=agent:agent /agents/management-scripts/* /management-scripts/

RUN chmod +x /management-scripts/*.sh

WORKDIR /app

ENV ARTIFACTORY_NPM_TOKEN=${ARTIFACTORY_NPM_TOKEN}

# Install dependencies with Artifactory authentication
RUN echo "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=${ARTIFACTORY_NPM_TOKEN}" >> ~/.npmrc && \
    echo "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:always-auth=true" >> ~/.npmrc && \
    cd /packages/ai-lib && pnpm install && pnpm build && \
    cd /app && pnpm install

# Build the application
RUN pnpm build

# Copy prompts directory to dist (TypeScript doesn't copy .md files)
RUN cp -r src/prompts dist/

# copy utils/lucide-icons-map.js to dist (TypeScript doesn't copy .js files)
RUN cp -r src/utils/lucide-icons-map.js dist/utils/lucide-icons-map.js

# Clean up build tools and artifactory credentials
RUN apk del python3 py3-setuptools make g++ && \
    npm cache clean --force && \
    rm -f ~/.npmrc

# Create shared data directory
RUN mkdir -p /app/data

# Make sure the agent user owns the app directory
RUN chown -R agent:agent /app

USER agent

# Expose the port that the agents server runs on
ENV NODE_ENV=production

# Start the application
ENTRYPOINT ["/management-scripts/nomad_setup_and_serve.sh"]
CMD ["node", "/app/dist/server/app.js"]
