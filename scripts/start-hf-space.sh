#!/bin/sh
set -eu

cd /app/backend
mkdir -p data uploads

python -m uvicorn app.main:app \
  --app-dir python_analytics \
  --host 127.0.0.1 \
  --port "${PYTHON_ANALYTICS_PORT:-8001}" &

AI_PID=$!

cleanup() {
  kill "$AI_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

node dist/server.js
