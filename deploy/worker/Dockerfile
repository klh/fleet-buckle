# the DURABLE WORKER — a long-running agent lane riding the b3
# buckle launch lane (/w/b3-repoagent-v1-calculon). It tends a GitHub repo (issues in,
# PRs out) and spawns MICROWORKERS (small containers) over the
# mounted docker socket. Durability is pi-durable's SQLite journal
# (/state/worker.sqlite, a compose volume): the sweep loop is a
# durable task graph; compose restart resumes mid-phase.
FROM oven/bun:1.4.4-debian
WORKDIR /app
COPY package.json ./
RUN bun install
COPY worker.*.ts ./
CMD ["bun", "worker.main.ts"]
