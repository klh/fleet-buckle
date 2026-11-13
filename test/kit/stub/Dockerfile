# the provider stub image — wiring only; fixture rides a mount.
FROM oven/bun:1.4.4-debian
WORKDIR /app
COPY stub.main.ts ./stub.main.ts
EXPOSE 8080
CMD ["bun", "stub.main.ts"]
