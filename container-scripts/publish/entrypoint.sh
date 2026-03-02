#!/bin/sh

# Entrypoint script that delegates all work to run-app.sh under dev-supervisor
exec /usr/local/bin/dev-supervisor /publish/run-app.sh "$@"
