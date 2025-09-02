FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine:3.22

USER root
# Install gettext for envsubst command and openssl for generating certificates
RUN apk add --no-cache gettext openssl nginx

# Remove default nginx configuration
RUN rm /etc/nginx/nginx.conf

# Create SSL directory
RUN mkdir -p /etc/nginx/ssl

# Generate self-signed SSL certificate
RUN openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/nginx.key \
    -out /etc/nginx/ssl/nginx.crt \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Copy our nginx configuration template
COPY nginx.conf /etc/nginx/nginx.conf.template

# Copy startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /etc/nginx

RUN chown -R nginx:nginx /etc/nginx

EXPOSE 8888

# Use our custom entrypoint
ENTRYPOINT ["/docker-entrypoint.sh"]

USER nginx
# Default command
CMD ["nginx", "-g", "daemon off;"]
