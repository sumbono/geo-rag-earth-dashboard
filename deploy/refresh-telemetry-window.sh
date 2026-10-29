#!/usr/bin/env bash
# Re-slide the synthetic telemetry window so the 168 h chart never goes empty.
# Verified against seed_telemetry.py (2026-10-28): DSN flag is --database-url
# (argparse at :275-278); app/models.py imports geoalchemy2 + pgvector at
# module load, so both must be installed; the Coolify postgres publishes NO
# host port, so the container must join the compose network instead of --network host.
#
# CWD-proof (final-review fix): cron runs with $HOME as CWD, so the repo is
# resolved from this script's own location — never from $PWD.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${GEO_DATABASE_URL:?set GEO_DATABASE_URL to the live postgres DSN}"
NET="${GEO_DOCKER_NETWORK:-geo-rag_default}"
docker run --rm --network "$NET" -v "$ROOT":/w -w /w python:3.12-slim \
  sh -c "pip -q install sqlalchemy psycopg geoalchemy2 pgvector && python etl/seed_telemetry.py --database-url \"$DB_URL\""

# Re-confirm the DSN form (postgresql+psycopg://… vs postgresql://…) against
# seed_telemetry.py's parser before the first production run — adjust this
# invocation, not the script. Weekly crontab: 17 4 * * 1
# (documented in docs/ops/topology-2026-10-28.md §6).
