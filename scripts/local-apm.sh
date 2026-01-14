#!/bin/bash
# Local APM Stack Management Script
# Usage: ./scripts/local-apm.sh [start|stop|status|logs|clean]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.apm.yml"

case "${1:-start}" in
  start)
    echo "Starting local Elastic APM stack..."
    # Remove any orphan containers with same names to avoid conflicts
    docker rm -f apm-elasticsearch apm-kibana apm-server 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
    echo ""
    echo "Waiting for Elasticsearch to be ready..."
    timeout 60 bash -c 'until curl -s http://localhost:9200 >/dev/null 2>&1; do sleep 2; done' || echo "Warning: Elasticsearch may not be ready yet"
    echo ""
    echo "Services:"
    echo "  - Elasticsearch: http://localhost:9200"
    echo "  - Kibana:        http://localhost:5601"
    echo "  - APM Server:    http://localhost:8200"
    echo ""
    echo "Add to agents/.env:"
    echo "  ELASTIC_APM_SERVER_URL=http://localhost:8200"
    echo "  ELASTIC_APM_SECRET_TOKEN=local-dev-token"
    ;;
  stop)
    echo "Stopping local Elastic APM stack..."
    docker compose -f "$COMPOSE_FILE" down --remove-orphans
    ;;
  status)
    if ! docker compose -f "$COMPOSE_FILE" ps --quiet 2>/dev/null | grep -q .; then
      echo "APM stack is not running."
      exit 1
    fi
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  logs)
    # Optional: specify service name (elasticsearch, kibana, apm-server)
    if [ -n "$2" ]; then
      docker compose -f "$COMPOSE_FILE" logs -f "$2"
    else
      docker compose -f "$COMPOSE_FILE" logs -f
    fi
    ;;
  clean)
    echo "Warning: This will permanently delete all APM data."
    echo "Stopping and removing APM stack data..."
    # Stop containers defined in the APM compose file
    docker compose -f "$COMPOSE_FILE" down
    # Remove APM containers explicitly (in case they exist outside compose)
    docker rm -f apm-elasticsearch apm-kibana apm-server 2>/dev/null || true
    # Remove only the APM elasticsearch volume
    docker volume rm airo-app-builder_elasticsearch-data 2>/dev/null || true
    echo "Done. APM stack and data have been removed."
    ;;
  *)
    echo "Usage: $0 [start|stop|status|logs|clean]"
    echo ""
    echo "Commands:"
    echo "  start  - Start the Elastic APM stack (default)"
    echo "  stop   - Stop the stack"
    echo "  status - Show container status"
    echo "  logs   - Follow logs (optional: specify service name)"
    echo "  clean  - Stop and remove all data"
    exit 1
    ;;
esac
