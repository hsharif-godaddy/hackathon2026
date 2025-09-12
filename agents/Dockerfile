ARG UPSTREAM_VERSION=22

FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine

ARG ARTIFACTORY_NPM_TOKEN

USER root

# Install python and build tools
RUN apk add --no-cache python3 py3-setuptools make g++ git

# Install pnpm
RUN npm install -g pnpm

# create the group and user
RUN addgroup -S agent && adduser -S -G agent agent

COPY --chown=agent:agent . /app
WORKDIR /app

ENV ARTIFACTORY_NPM_TOKEN=${ARTIFACTORY_NPM_TOKEN}

# Install dependencies with Artifactory authentication
RUN echo "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=${ARTIFACTORY_NPM_TOKEN}" >> ~/.npmrc && \
    echo "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:always-auth=true" >> ~/.npmrc && \
    pnpm install --frozen-lockfile

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

# Switch to the agent user so we are not running as root
USER agent

# Expose the port that the agents server runs on
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/server/app.js"]
