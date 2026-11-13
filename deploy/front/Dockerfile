# the per-unit front proxy — the rolling-deploy seam. Which buckle
# version serves is a state file (mounted), re-read per request.
FROM oven/bun:1.4.4-debian
WORKDIR /app
COPY front.main.ts ./
EXPOSE 4113
CMD ["bun", "front.main.ts"]
