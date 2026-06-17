#!/usr/bin/env bash
# Start ML engine, API, and web for local schedule testing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cleanup() {
  trap - INT TERM EXIT
  [[ -n "${ML_PID:-}" ]] && kill "$ML_PID" 2>/dev/null || true
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Starting ML engine on :8000..."
(cd apps/ml-engine && uvicorn main:app --reload --port 8000) &
ML_PID=$!

echo "Starting API on :3001..."
npm run dev:api &
API_PID=$!

echo "Starting web on :5173..."
npm run dev:web &
WEB_PID=$!

echo ""
echo "Stack running:"
echo "  Web:        http://localhost:5173"
echo "  API:        http://localhost:3001"
echo "  ML engine:  http://localhost:8000"
echo "  Login:      employer@demo.com / password123"
echo ""
echo "Press Ctrl+C to stop all services."
wait
