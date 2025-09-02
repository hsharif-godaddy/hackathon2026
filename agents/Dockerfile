FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

RUN apk add --no-cache python3 py3-setuptools make g++

WORKDIR /app

RUN npm install -g pnpm

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

RUN mkdir -p /app/data && chown -R node:node /app/

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

USER node

# Start the application directly - no runtime npm access needed
CMD ["node", "dist/server/app.js"]