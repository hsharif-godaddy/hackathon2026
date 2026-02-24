# Image Search Service

Go service for image search with AI-powered analysis, Qdrant vector storage, and S3 backup.

## Features

- **Hybrid Search**: Semantic vector search + metadata filters via Qdrant
- **AI Analysis**: Claude Haiku vision for rich image metadata
- **Rate Limiting**: Built-in concurrency and RPS limits for external APIs
- **S3 Backup**: Durable storage for reindexing capability

## Quick Start

```bash
# Build
make build

# Run
make run

# Test
make test

# Lint
make lint
```

## Local Development Setup

1. **Copy environment template:**

   ```bash
   cp .env.example .env
   ```

2. **Set up AWS SSO access (for S3 analysis cache):**

   ```bash
   # From the repo root, run setup if you haven't already
   ./setup.sh

   # Login to AWS SSO
   aws sso login --profile airobuild-dev-private-sso
   ```

   This gives you access to the shared S3 bucket (`airo-image-analyses-dev`) where
   image analyses are cached. This avoids re-running expensive Haiku analysis for
   images that have already been processed.

3. **Fill in required API keys in `.env`:**

   - `ANTHROPIC_API_KEY` - For Haiku image analysis
   - `OPENAI_API_KEY` - For embeddings
   - `GETTY_APP_KEY` - For Getty Images API (optional for testing)

4. **Start Qdrant:**

   ```bash
   docker compose up -d
   ```

5. **Run the service:**

   ```bash
   # With .env file
   source .env && make run

   # Or with go directly
   go run ./cmd/server/main.go
   ```

6. **Verify it's running:**
   ```bash
   curl http://localhost:8080/api/v1/health
   ```

## Configuration

Environment variables:

| Variable               | Default                     | Description                          |
| ---------------------- | --------------------------- | ------------------------------------ |
| `PORT`                 | 8080                        | HTTP server port                     |
| `LOG_LEVEL`            | info                        | Log level (debug, info, warn, error) |
| `QDRANT_HOST`          | localhost                   | Qdrant server host                   |
| `QDRANT_PORT`          | 6334                        | Qdrant gRPC port                     |
| `QDRANT_COLLECTION`    | image_analyses              | Collection name                      |
| `QDRANT_API_KEY`       | -                           | Qdrant API key (optional)            |
| `QDRANT_USE_TLS`       | false                       | Enable TLS for Qdrant connection     |
| `GETTY_UPSTREAM`       | https://api.gettyimages.com | Getty API base URL                   |
| `GETTY_APP_KEY`        | -                           | Getty API key                        |
| `GETTY_RATE_LIMIT_RPS` | 50                          | Getty requests per second            |
| `GETTY_CONCURRENCY`    | 10                          | Max concurrent Getty requests        |
| `ANTHROPIC_API_URL`    | https://api.anthropic.com   | Anthropic API URL                    |
| `ANTHROPIC_API_KEY`    | -                           | Anthropic API key for Haiku          |
| `HAIKU_RATE_LIMIT_RPS` | 20                          | Haiku requests per second            |
| `HAIKU_CONCURRENCY`    | 5                           | Max concurrent Haiku requests        |
| `OPENAI_API_KEY`       | -                           | OpenAI API key for embeddings        |
| `OPENAI_BASE_URL`      | -                           | Custom OpenAI API URL (optional)     |
| `S3_BUCKET`            | -                           | S3 bucket for backup (optional)      |
| `S3_REGION`            | us-west-2                   | AWS region                           |

## API Endpoints

| Endpoint                   | Method | Description        |
| -------------------------- | ------ | ------------------ |
| `/api/v1/health`           | GET    | Health check       |
| `/api/v1/stats`            | GET    | Service statistics |
| `/api/v1/search`           | POST   | Search images      |
| `/api/v1/images/{gettyId}` | GET    | Get single image   |
| `/api/v1/images/batch`     | POST   | Batch lookup       |

## Development

```bash
# Format code
make fmt

# Clean build artifacts
make clean
```
