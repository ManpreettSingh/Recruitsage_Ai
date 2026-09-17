#!/usr/bin/env bash

# RecruitSage Backend Launcher
cd "$(dirname "$0")"

echo "=================================================="
echo "⚡ Starting RecruitSage Backend (FastAPI)"
echo "   Endpoint: http://localhost:8000"
echo "   Docs URL: http://localhost:8000/docs"
echo "=================================================="

PYTHONPATH=backend ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
