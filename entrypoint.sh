#!/bin/sh
set -e

export PYTHONPATH=/app

echo "Running migrations..."
alembic upgrade head

echo "Seeding database..."
python -m app.db.seed

echo "Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
