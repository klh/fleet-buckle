# fleet-buckle image — Bun runs it; the unit is buckle + litellm engine +
# fleet-health sidecar, composed (see deploy/compose.test.yaml).
# NOTE: containers cannot git+ssh — @fleet/health rides a VENDORED tarball
# (deploy/vendor) from commit 3, when the server first imports it. Until
# then the image needs zod only.
FROM oven/bun:1.4.4-debian
WORKDIR /app
RUN bun add zod@4.6.7
COPY src ./src
EXPOSE 4111
CMD ["bun", "src/server/buckle.server.main.ts"]
