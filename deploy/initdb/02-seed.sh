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
# Failure modes are loud, never silent (review round 1):
#   * missing SEED_SQL         → ERROR + exit 1: an unseeded stack is not a
#                                success.  Exit 0 skip ONLY when the explicit
#                                override SEED_SKIP=1 is set (warns on stderr
#                                that the stack boots UNSEEDED),
#   * corrupt / non-gzip dump  → `gunzip -t` gate → ERROR naming the file +
#                                exit 1 BEFORE any psql.  POSIX sh has no
#                                `pipefail`, so without the gate a failed
#                                `gunzip -c` would feed psql empty stdin
#                                (psql exits 0) and the final "restored" line
#                                would announce success over an empty DB —
#                                a silent failure of spec criterion 4.
#
# Env overrides (the restore test uses SEED_DB / SEED_SQL / SEED_SKIP):
#   SEED_DB    target database (default $POSTGRES_DB, i.e. geo)
#   SEED_SQL   path to the dump (default /fixtures/seed.sql.gz, the
#              ./fixtures bind mount added in docker-compose.yml)
#   SEED_SKIP  =1 → deliberately skip the restore (boot unseeded)
set -eu

SEED_DB="${SEED_DB:-${POSTGRES_DB:-geo}}"
SEED_SQL_DEFAULT="/fixtures/seed.sql.gz"
SEED_SQL="${SEED_SQL:-$SEED_SQL_DEFAULT}"

if [ "${SEED_SKIP:-}" = "1" ]; then
  echo "02-seed: SEED_SKIP=1 — skipping fixture restore (stack boots UNSEEDED)" >&2
  exit 0
fi

if [ ! -f "$SEED_SQL" ]; then
  echo "02-seed: ERROR: fixture dump '$SEED_SQL' not found — refusing to boot an unseeded/unsearchable stack (restore it, or set SEED_SKIP=1 to skip deliberately)" >&2
  exit 1
fi

# Integrity gate: reject a non-gzip / corrupt dump before the pipe (see the
# header — without this, gunzip's failure is masked by psql's exit 0).
if ! gunzip -t "$SEED_SQL"; then
  echo "02-seed: ERROR: '$SEED_SQL' is not a valid gzip stream (git-lfs pointer? truncated checkout? corrupted file?) — refusing to restore" >&2
  exit 1
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

# Slide the telemetry window so it ends at restore time. The fixture dump's
# timestamps are frozen at generation; without this, the default 24h query
# shrinks as wall-clock time passes and fresh clones start with an empty
# chart. tiles.captured_at is deliberately left alone — satellite capture
# dates are historical fact.
psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "$SEED_DB" \
  -c "UPDATE telemetry SET ts = ts + (SELECT now() - max(ts) FROM telemetry);"

echo "02-seed: restored $SEED_SQL into $SEED_DB"
