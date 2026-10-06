#!/bin/sh
# Task 14 — restore the committed fixture dump on first DB boot so a fresh
# `docker compose up` is search-ready with ZERO network calls (spec success
# criterion 4; Task 22 offline CI and Task 25 prod consume the same file).
#
# Runs from /docker-entrypoint-initdb.d (alphabetically after 01-extensions)
# exactly once, when the pgdata volume is first initialised.  Must be
# EXECUTABLE: the postgres entrypoint executes *.sh files and *sources*
# non-executable ones — a sourced `exit` would kill the entrypoint.
#
# The dump is `pg_dump --data-only` (ruling), so it carries no DDL: this
# script creates the two seeded tables first.  `IF NOT EXISTS` keeps it
# idempotent and compatible with apps/api's init_db, which reflects before
# creating (Tile/Telemetry models in apps/api/app/models.py are the source
# of truth; this DDL mirrors them).
#
# Env overrides (the restore test uses SEED_DB):
#   SEED_DB   target database (default $POSTGRES_DB, i.e. geo)
#   SEED_SQL  path to the dump (default /fixtures/seed.sql.gz, the
#             ./fixtures bind mount added in docker-compose.yml)
set -eu

SEED_DB="${SEED_DB:-${POSTGRES_DB:-geo}}"
SEED_SQL="${SEED_SQL:-/fixtures/seed.sql.gz}"

if [ ! -f "$SEED_SQL" ]; then
  echo "02-seed: $SEED_SQL not found — skipping fixture restore" >&2
  exit 0
fi

psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "$SEED_DB" <<'DDL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS tiles (
    id uuid PRIMARY KEY,
    bbox geometry(Polygon, 4326) NOT NULL,
    embedding vector(512) NOT NULL,
    thumb_path varchar(512) NOT NULL,
    captured_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tiles_bbox ON tiles USING GIST (bbox);
CREATE TABLE IF NOT EXISTS telemetry (
    buoy_id varchar(32) NOT NULL,
    ts timestamptz NOT NULL,
    value double precision NOT NULL,
    unit varchar(16) NOT NULL,
    PRIMARY KEY (buoy_id, ts)
);
DDL

gunzip -c "$SEED_SQL" | psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "$SEED_DB"

echo "02-seed: restored $SEED_SQL into $SEED_DB"
