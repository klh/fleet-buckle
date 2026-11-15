# the hermetic OIDC IdP stub image — wiring only; the keypair is
# generated at boot, approval rides the /_approve test face.
FROM oven/bun:1.4.4-debian
WORKDIR /app
COPY oidcstub.main.ts ./oidcstub.main.ts
EXPOSE 8080
CMD ["bun", "oidcstub.main.ts"]
