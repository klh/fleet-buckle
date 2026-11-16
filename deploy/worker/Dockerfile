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
# the SEED DIR — persona.md (character) + template.md (the incoming
# per-launch brief, the pi-durable template pattern) + .prefer (the
# model ladder) bake in at /etc/worker; a compose mount over that
# path overwrites any or all of them per deployment.
COPY seed/ /etc/worker/
CMD ["bun", "worker.main.ts"]
