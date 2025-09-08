ARG UPSTREAM_VERSION=22

FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine

USER root

# Install python and build tools
RUN apk add --no-cache python3 py3-setuptools make g++ curl git

# Install pnpm
RUN npm install -g pnpm

# create the group and user
RUN addgroup -S agent && adduser -S -G agent agent

RUN mkdir -p /management-scripts && chown -R agent:agent /management-scripts

# copy all except nomad_setup_and_serve.sh to /app
COPY --chown=agent:agent . /app

RUN rm -rf /app/*.sh

# copy nomad_setup_and_serve.sh to /management-scripts
COPY --chown=agent:agent nomad_setup_and_serve.sh /management-scripts/nomad_setup_and_serve.sh

RUN chmod +x /management-scripts/nomad_setup_and_serve.sh

RUN chown -R agent:agent /management-scripts/nomad_setup_and_serve.sh

WORKDIR /app

RUN pnpm install --registry=https://registry.npmjs.org/

# Make sure the agent user owns the app directory
RUN chown -R agent:agent /app

# Switch to the agent user so we are not running as root
USER agent

# Set development environment variables
ENV NODE_ENV=development
ENV VITE_HMR_HOST=0.0.0.0
ENV RUNNING_IN_DOCKER=true

# Start development server (runs both frontend Vite and backend Hono)
CMD ["/bin/sh", "/management-scripts/nomad_setup_and_serve.sh"]
