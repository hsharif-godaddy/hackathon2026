FROM node:18-alpine

# Build argument for NPM authentication
ARG NPM_AUTH_TOKEN

RUN apk add --no-cache python3 py3-setuptools make g++

WORKDIR /app

RUN npm install -g pnpm

# Create npm configuration for private registry using build arg
RUN echo "registry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/" > .npmrc && \
    echo "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=${NPM_AUTH_TOKEN}" >> .npmrc

COPY package*.json ./
COPY pnpm-lock.yaml ./

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm build

# Copy prompts directory to dist (TypeScript doesn't copy .md files)
RUN cp -r src/prompts dist/

RUN apk del python3 py3-setuptools make g++ && \
    npm cache clean --force && \
    rm -f .npmrc

RUN mkdir -p /app/data

EXPOSE 80

ENV NODE_ENV=production
ENV PORT=80

# HEALTHCHECK --interval=30s --timeout=10s \
#   CMD node -e "require('http').get('http://localhost:80/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"


# Start the application directly - no runtime npm access needed
CMD ["node", "dist/server/app.js"]