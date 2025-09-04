FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

# Install openssl for generating certificates
RUN apk add --no-cache openssl

# Set working directory
WORKDIR /app

# Create SSL directory and generate self-signed certificate
RUN mkdir -p /app/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /app/ssl/server.key \
    -out /app/ssl/server.crt \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Copy package files
COPY --chown=node:node package.json ./

# Install dependencies
RUN npm install --only=production

# Copy application code
COPY --chown=node:node server.js ./

# Change ownership of the app directory  
RUN chown -R node:node /app

# Expose port
EXPOSE 8888

# Switch to non-root user
USER node

# Start the application
CMD ["npm", "start"]