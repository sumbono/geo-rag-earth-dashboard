FROM postgis/postgis:16-master
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
