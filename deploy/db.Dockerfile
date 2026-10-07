# was: postgis/postgis:16-master (rolling tag pinned by digest for reproducible builds)
FROM postgis/postgis@sha256:ee1de0e104cc09e0ff762375fb898e583c12270638579de43aaef4cc6656d219
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
