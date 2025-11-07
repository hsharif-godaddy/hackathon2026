# SSL Certificates for Local HTTPS Development

This directory contains SSL certificates for running the preview server over HTTPS.

## Setup

The SSL certificates are automatically generated during template setup using `mkcert`. The certificates are stored in this directory and are excluded from version control.

### Generating Certificates

If you need to regenerate the certificates:

```bash
# Install mkcert (macOS)
brew install mkcert

# Install the local CA
mkcert -install

# Generate certificates for localhost
cd app-templates/v8/.ssl
mkcert localhost 127.0.0.1 ::1

# Rename certificates
mv localhost+2.pem cert.pem
mv localhost+2-key.pem key.pem
```

## How It Works

1. **Vite Configuration**: The `vite.config.ts` file automatically detects the presence of SSL certificates in `.ssl/` and enables HTTPS when they exist.

2. **Docker Support**: When running in Docker, the `.ssl/` directory is mounted along with the rest of the `/app` directory, making certificates available to the containerized Vite server.

3. **Fallback**: If certificates don't exist, Vite falls back to HTTP mode automatically.

## Security Note

These certificates are self-signed and only valid for local development. They should never be used in production environments.

The certificates are valid for:

- `localhost`
- `127.0.0.1`
- `::1` (IPv6 localhost)

Certificate expiration: ~3 years from generation date.
