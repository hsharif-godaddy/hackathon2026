FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

# Install pnpm and necessary packages
RUN apk add --no-cache openssl && \
    npm install -g pnpm

# Set working directory
WORKDIR /app

# Create SSL directory and generate self-signed certificate
RUN mkdir -p /app/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /app/ssl/server.key \
    -out /app/ssl/server.crt \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Copy package files
COPY --chown=node:node package.json pnpm-lock.yaml* ./

# Install all dependencies (including dev dependencies for building)
RUN pnpm install --frozen-lockfile

# Copy source code and configuration
COPY --chown=node:node src/ ./src/
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node setup-certs.sh ./

# Build TypeScript
RUN pnpm run build

# Make setup script executable
RUN chmod +x setup-certs.sh

# Change ownership of the app directory  
RUN chown -R node:node /app

# Expose port
EXPOSE 8888

# Switch to non-root user
USER node

# Start the application with certificate setup
CMD ["sh", "-c", "./setup-certs.sh && pnpm start"]