# the azure hub's minimal GUI — static shell + /api seam onto the
# buckle admin faces. ONE page, zero build step: Bun serves the
# files, the browser runs the vendored Lit component, the api proxy
# rides the GUI principal key (a 0600 file read per request — never
# baked into the image).
FROM oven/bun:1.4.4-debian
WORKDIR /app
COPY gui.main.ts gui.oidc.ts gui.session.ts ./
COPY www/ ./www/
EXPOSE 8080
CMD ["bun", "gui.main.ts"]
