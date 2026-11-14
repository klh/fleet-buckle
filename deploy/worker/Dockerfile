# the DURABLE WORKER — a long-running agent lane riding the b3
# buckle launch lane (/w/b3-repoagent-v1-calculon). It tends a GitHub repo (issues in,
# PRs out) and spawns MICROWORKERS (small containers) over the
# mounted docker socket. State is a JSON volume; compose restart is
# its durability.
FROM oven/bun:1.4.4-debian
WORKDIR /app
COPY worker.*.ts ./
CMD ["bun", "worker.main.ts"]
